import type {
  IndexStats,
  PackOptions,
  PackResult,
  SearchOptions,
  SearchHit,
  SymbolNode,
  DashboardStats,
  IngestConfig,
  IngestResult,
  ParsedFile,
  Chunk,
  TreemapNode,
} from "@codingverse/shared";
import fs from "node:fs/promises";
import { ingest } from "./ingest/index.js";
import { parseFiles } from "./parse/index.js";
import { TokenBudget, buildTokenTreemap, type FileTokenCount } from "./budget/index.js";
import { compress } from "./assemble/index.js";

export interface EngineOptions {
  /** Where to store the index/cache. Defaults to `<repo>/.codingverse`. */
  stateDir?: string;
}

/**
 * Engine — the facade over the 4-stage pipeline (ingest / parse / index / assemble)
 * plus the two cross-cutting concerns (token budget, incremental cache).
 *
 * One engine, three output modes: pack (CLI), search (MCP), stats (Dashboard).
 *
 * NOTE: M0 scaffold — all methods are stubs. Implemented incrementally per MVP milestones.
 */
export class Engine {
  private readonly repoPath: string;
  private readonly options: EngineOptions;
  /** Last pack's expand map (skeleton id → source span), for expand(). */
  private lastExpandMap: Record<string, import("@codingverse/shared").ExpandEntry> = {};

  private constructor(repoPath: string, options: EngineOptions) {
    this.repoPath = repoPath;
    this.options = options;
  }

  static async open(repoPath: string, opts: EngineOptions = {}): Promise<Engine> {
    return new Engine(repoPath, opts);
  }

  /** Stage ①: discover, read, decode, and validate files. */
  async ingest(config: IngestConfig = {}): Promise<IngestResult> {
    return ingest(this.repoPath, config);
  }

  /** Stage ②: parse files → symbols, refs, chunks. */
  async parse(config: IngestConfig = {}): Promise<ParsedFile[]> {
    const { files } = await ingest(this.repoPath, config);
    return parseFiles(files);
  }

  /**
   * Cross-cutting A: token accounting over the parsed repo.
   * Counts every chunk, aggregates per file, and builds a token treemap.
   */
  async tokenReport(
    config: IngestConfig = {},
  ): Promise<{ files: FileTokenCount[]; total: number; treemap: TreemapNode }> {
    const parsed = await this.parse(config);
    const budget = new TokenBudget({ repoRoot: this.repoPath });
    await budget.init();

    const byFile = new Map<string, Chunk[]>();
    for (const p of parsed) byFile.set(p.path, p.chunks);

    const files = budget.countFiles(byFile);
    await budget.flush();

    const total = files.reduce((sum, f) => sum + f.tokens, 0);
    const treemap = buildTokenTreemap(files);
    return { files, total, treemap };
  }

  /** Stage ①-③: build / update the index. */
  async index(): Promise<IndexStats> {
    throw new Error("Engine.index not implemented (M2/M3)");
  }

  /** Incremental sync via git blob hash fast path. */
  async sync(): Promise<IndexStats> {
    throw new Error("Engine.sync not implemented (M6)");
  }

  /**
   * Pack mode: layered compression into a single LLM context.
   * M4 produces the structured per-file layer result + expand map.
   * M5 will add multi-format rendering (XML/Markdown/JSON) + directory tree.
   */
  async pack(opts: PackOptions = {}): Promise<PackResult> {
    const { files: ingested } = await ingest(this.repoPath, opts);
    const parsed = await parseFiles(ingested);
    const sources = new Map(ingested.map((f) => [f.path, f.content]));

    const result = await compress(parsed, sources, opts, this.repoPath);
    this.lastExpandMap = result.expandMap;

    // M4 preview assembly: concatenate non-omitted files with a simple header.
    // (M5 replaces this with format-specific rendering.)
    const parts: string[] = [];
    for (const f of result.files) {
      if (f.layer === "omit") continue;
      parts.push(`===== ${f.path} [${f.layer}] =====\n${f.content}`);
    }
    const content = parts.join("\n\n");

    return {
      content,
      tokenCount: result.total,
      layerMap: result.layerMap,
      fileCount: result.files.filter((f) => f.layer !== "omit").length,
      files: result.files,
      expandMap: result.expandMap,
    };
  }

  /** Search mode: vector + BM25 + graph, fused via RRF. */
  async search(_query: string, _opts: SearchOptions = {}): Promise<SearchHit[]> {
    throw new Error("Engine.search not implemented (v1)");
  }

  /**
   * Expand a skeleton symbol by id → its full source text.
   * Uses the most recent pack's expand map; reads the span from disk.
   */
  async expand(id: string): Promise<string> {
    const entry = this.lastExpandMap[id];
    if (!entry) {
      throw new Error(`Unknown expand id: ${id}. Run pack() first, or the id is stale.`);
    }
    const absPath = `${this.repoPath}/${entry.path}`;
    const content = await fs.readFile(absPath, "utf8");
    return content.slice(entry.startByte, entry.endByte);
  }

  /** Call-hierarchy: who calls this node. */
  async callers(_nodeId: string, _depth = 1): Promise<SymbolNode[]> {
    throw new Error("Engine.callers not implemented (v2)");
  }

  /** Call-hierarchy: what this node calls. */
  async callees(_nodeId: string, _depth = 1): Promise<SymbolNode[]> {
    throw new Error("Engine.callees not implemented (v2)");
  }

  /** Impact radius: reverse BFS with container drill-down. */
  async impact(_nodeId: string, _depth = 3): Promise<SymbolNode[]> {
    throw new Error("Engine.impact not implemented (v2)");
  }

  /** Dashboard data source: all observation state in one call. */
  async stats(): Promise<DashboardStats> {
    throw new Error("Engine.stats not implemented (v2.5)");
  }

  async close(): Promise<void> {
    // no-op until SQLite connection is introduced (v1)
  }

  /** Exposed for early CLI wiring / debugging. */
  getRepoPath(): string {
    return this.repoPath;
  }

  getStateDir(): string | undefined {
    return this.options.stateDir;
  }
}
