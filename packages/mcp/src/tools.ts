/**
 * Tool definitions + handlers for the codingverse MCP server.
 *
 * Exposes 4 tools over the codingverse Engine:
 *   - search:    BM25 + co-location RRF search over the index
 *   - pack:      layered compression into a single LLM context
 *   - expand:    resolve a skeleton symbol id back to full source text
 *   - get_file:  read a file from the repo (path-traversal guarded)
 *
 * A per-projectPath Engine cache (Map) avoids re-opening the engine on every
 * call. Engine.open() is cheap (lazy IndexDb — V1-5), so the cache is mostly
 * convenience; no TTL / eviction (v1 simple).
 */
import path from "node:path";
import fs from "node:fs/promises";
import { Engine } from "@codingverse/core";
import type {
  Layer,
  OutputFormat,
  PackOptions,
  SearchHit,
} from "@codingverse/shared";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

type LayerStrategy = "auto" | "full" | "skeleton" | "outline";

/** Lazily-opened Engine cache, keyed by absolute projectPath. */
const engineCache = new Map<string, Engine>();

/** Return a cached Engine for projectPath, opening one on first use. */
async function getEngine(projectPath: string): Promise<Engine> {
  const absRoot = path.resolve(projectPath);
  let engine = engineCache.get(absRoot);
  if (!engine) {
    engine = await Engine.open(absRoot);
    engineCache.set(absRoot, engine);
  }
  return engine;
}

/** Build a successful text result. */
function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Build an error result (isError: true) — does not crash the server. */
function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Coerce an unknown arg to a string, treating undefined/null as "". */
function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** search tool: hybrid search over the index, returns SearchHit[] as JSON. */
async function handleSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  const query = asString(args.query);
  const projectPath = asString(args.projectPath);
  if (!query) return errorResult("Parameter 'query' is required.");
  if (!projectPath) return errorResult("Parameter 'projectPath' is required.");

  const topK = args.topK !== undefined ? Number(args.topK) : undefined;
  const engine = await getEngine(projectPath);
  const hits: SearchHit[] = await engine.search(
    query,
    topK !== undefined && Number.isFinite(topK) ? { topK } : {},
  );

  if (hits.length === 0) {
    return textResult(
      "No results. Run `cv index` first to build the index, or refine your query.",
    );
  }
  return textResult(JSON.stringify(hits, null, 2));
}

/** pack tool: layered compression, returns summary line + full pack content. */
async function handlePack(args: Record<string, unknown>): Promise<CallToolResult> {
  const projectPath = asString(args.projectPath);
  if (!projectPath) return errorResult("Parameter 'projectPath' is required.");

  const opts: PackOptions = {};
  if (args.tokenBudget !== undefined) {
    const budget = Number(args.tokenBudget);
    if (Number.isFinite(budget)) opts.tokenBudget = budget;
  }
  if (args.strategy !== undefined) {
    opts.layerStrategy = args.strategy as LayerStrategy;
  }
  if (args.format !== undefined) {
    opts.format = args.format as OutputFormat;
  }

  const engine = await getEngine(projectPath);
  const result = await engine.pack(opts);

  const counts: Record<Layer, number> = { full: 0, skeleton: 0, outline: 0, omit: 0 };
  for (const f of result.files) counts[f.layer]++;
  const expandable = Object.keys(result.expandMap).length;
  const summary =
    `[cv pack] ${result.fileCount} files, ${result.tokenCount} tokens — ` +
    `F:${counts.full} S:${counts.skeleton} O:${counts.outline} -:${counts.omit}` +
    (expandable ? `, ${expandable} expandable` : "");

  return textResult(`${summary}\n\n${result.content}`);
}

/** expand tool: resolve a skeleton symbol id to its full source text. */
async function handleExpand(args: Record<string, unknown>): Promise<CallToolResult> {
  const rawId = asString(args.id);
  const projectPath = asString(args.projectPath);
  if (!rawId) return errorResult("Parameter 'id' is required.");
  if (!projectPath) return errorResult("Parameter 'projectPath' is required.");

  // Accept the id with or without the `cv:` prefix (matches `cv expand` CLI).
  const id = rawId.startsWith("cv:") ? rawId.slice(3) : rawId;

  const engine = await getEngine(projectPath);
  const body = await engine.expand(id);
  return textResult(body);
}

/** get_file tool: read a repo-relative file, guarding against path traversal. */
async function handleGetFile(args: Record<string, unknown>): Promise<CallToolResult> {
  const relPath = asString(args.path);
  const projectPath = asString(args.projectPath);
  if (!relPath) return errorResult("Parameter 'path' is required.");
  if (!projectPath) return errorResult("Parameter 'projectPath' is required.");

  const absRoot = path.resolve(projectPath);
  const absTarget = path.resolve(absRoot, relPath);
  const rel = path.relative(absRoot, absTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return errorResult(`path escapes project root: ${relPath}`);
  }

  let content: string;
  try {
    content = await fs.readFile(absTarget, "utf8");
  } catch (err) {
    return errorResult(
      err instanceof Error
        ? `Failed to read ${relPath}: ${err.message}`
        : `Failed to read ${relPath}`,
    );
  }
  return textResult(content);
}

/** The 4 tool definitions advertised to MCP clients. */
const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "search",
    description:
      "Hybrid search (BM25 + co-location graph, fused via RRF) over a codingverse index. " +
      "Returns SearchHit[] as JSON. Requires the repo to be indexed first (`cv index`).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language or symbol query." },
        topK: {
          type: "number",
          description: "Number of hits to return (default 20).",
        },
        projectPath: {
          type: "string",
          description: "Absolute path to the repository root.",
        },
      },
      required: ["query", "projectPath"],
    },
  },
  {
    name: "pack",
    description:
      "Pack a repository into a layered LLM context (full / skeleton / outline / omit). " +
      "Returns a summary line followed by the full pack content.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "Absolute path to the repository root.",
        },
        tokenBudget: {
          type: "number",
          description: "Token budget (default 128000).",
        },
        strategy: {
          type: "string",
          enum: ["auto", "full", "skeleton", "outline"],
          description: "Layer strategy (default auto).",
        },
        format: {
          type: "string",
          enum: ["xml", "markdown", "json"],
          description: "Output format (default xml).",
        },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "expand",
    description:
      "Resolve a skeleton symbol id (from a pack) back to its full source text. " +
      "Run `pack` first so the expand map exists.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Skeleton symbol id (with or without the `cv:` prefix).",
        },
        projectPath: {
          type: "string",
          description: "Absolute path to the repository root.",
        },
      },
      required: ["id", "projectPath"],
    },
  },
  {
    name: "get_file",
    description:
      "Read a file from the repository by repo-relative path. " +
      "Guards against path traversal outside the project root.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path relative to the repository root (POSIX or platform separators).",
        },
        projectPath: {
          type: "string",
          description: "Absolute path to the repository root.",
        },
      },
      required: ["path", "projectPath"],
    },
  },
];

/** Return the list of tools advertised to MCP clients. */
export function listTools(): Tool[] {
  return TOOL_DEFINITIONS;
}

/**
 * Dispatch a tool call by name. Every handler is wrapped so that errors
 * become `{ isError: true }` results rather than crashing the server.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    switch (name) {
      case "search":
        return await handleSearch(args);
      case "pack":
        return await handlePack(args);
      case "expand":
        return await handleExpand(args);
      case "get_file":
        return await handleGetFile(args);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
