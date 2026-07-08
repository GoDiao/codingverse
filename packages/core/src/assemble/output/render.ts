import type { PackedFile, OutputFormat } from "@codingverse/shared";
import { renderTree } from "./tree.js";

/**
 * Multi-format pack rendering: XML / Markdown / JSON.
 * Consumes M4's PackedFile[] (path + layer + content + tokens).
 * Custom Handlebars templates land in v3; MVP uses direct string builders.
 */

export interface RenderInput {
  files: PackedFile[];
  tokenCount: number;
  expandableCount: number;
}

const HEADER_PURPOSE =
  "This is a layered, LLM-optimized snapshot of a code repository produced by codingverse.";

const LAYER_NOTE =
  "Files are shown at one of four layers: [full] verbatim, [skeleton] signatures " +
  "with bodies replaced by `cv:<id>` placeholders (expandable on demand), " +
  "[outline] signature list only, [omit] name in the tree but content excluded.";

/** Language → markdown code-fence info string. */
const fenceLang = (language: string): string => {
  switch (language) {
    case "typescript":
    case "tsx":
      return "typescript";
    case "javascript":
    case "jsx":
      return "javascript";
    case "python":
      return "python";
    default:
      return "";
  }
};

/** Choose a fence long enough to not collide with backticks in content. */
const fenceFor = (content: string): string => {
  let fence = "```";
  while (content.includes(fence)) fence += "`";
  return fence;
};

const included = (files: PackedFile[]): PackedFile[] =>
  files.filter((f) => f.layer !== "omit");

// ── XML ──────────────────────────────────────────────────────
const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const renderXml = (input: RenderInput): string => {
  const inc = included(input.files);
  const tree = renderTree(input.files.map((f) => ({ path: f.path, layer: f.layer })));
  const parts: string[] = [];
  parts.push(`<codingverse token_count="${input.tokenCount}" expandable="${input.expandableCount}">`);
  parts.push(`<summary>\n${escapeXml(HEADER_PURPOSE)}\n${escapeXml(LAYER_NOTE)}\n</summary>`);
  parts.push(`<directory_structure>\n${escapeXml(tree)}\n</directory_structure>`);
  parts.push(`<files>`);
  for (const f of inc) {
    parts.push(
      `<file path="${escapeXml(f.path)}" layer="${f.layer}" tokens="${f.tokens}">\n` +
        `${escapeXml(f.content)}\n</file>`,
    );
  }
  parts.push(`</files>`);
  parts.push(`</codingverse>`);
  return parts.join("\n");
};

// ── Markdown ─────────────────────────────────────────────────
const renderMarkdown = (input: RenderInput): string => {
  const inc = included(input.files);
  const tree = renderTree(input.files.map((f) => ({ path: f.path, layer: f.layer })));
  const parts: string[] = [];
  parts.push(`# Repository Snapshot (codingverse)`);
  parts.push(`${HEADER_PURPOSE}\n\n${LAYER_NOTE}`);
  parts.push(`_Total tokens: ${input.tokenCount} · Expandable symbols: ${input.expandableCount}_`);
  parts.push(`## Directory Structure\n\n\`\`\`\n${tree}\n\`\`\``);
  parts.push(`## Files`);
  for (const f of inc) {
    const fence = fenceFor(f.content);
    parts.push(
      `### ${f.path}  \`[${f.layer}]\`\n\n${fence}${fenceLang(f.language)}\n${f.content}\n${fence}`,
    );
  }
  return parts.join("\n\n");
};

// ── JSON ─────────────────────────────────────────────────────
const renderJson = (input: RenderInput): string => {
  const tree = renderTree(input.files.map((f) => ({ path: f.path, layer: f.layer })));
  return JSON.stringify(
    {
      generator: "codingverse",
      tokenCount: input.tokenCount,
      expandableCount: input.expandableCount,
      directoryStructure: tree,
      files: included(input.files).map((f) => ({
        path: f.path,
        language: f.language,
        layer: f.layer,
        tokens: f.tokens,
        content: f.content,
      })),
    },
    null,
    2,
  );
};

/** Render packed files into the requested format. */
export const render = (input: RenderInput, format: OutputFormat): string => {
  switch (format) {
    case "xml":
      return renderXml(input);
    case "markdown":
      return renderMarkdown(input);
    case "json":
      return renderJson(input);
  }
};
