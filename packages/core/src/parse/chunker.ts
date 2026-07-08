import type { Chunk, Language } from "@codingverse/shared";
import { DEFAULT_CHUNK_SIZE } from "@codingverse/shared";
import type { Node } from "web-tree-sitter";
import type { LanguageConfig } from "./languages/registry.js";
import { chunkId } from "../indexdb/ids.js";

export { chunkId } from "../indexdb/ids.js";

/**
 * AST semantic chunking (inspired by Tabby's CodeSplitter).
 *
 * Walk top-level children of the AST; each definition node (per language
 * config.chunkNodeTypes) becomes a chunk. Non-definition runs (imports,
 * statements) are grouped into "filler" chunks. Oversized definition bodies
 * are split by line windows so no chunk greatly exceeds the target capacity.
 */

/** Split a large text block into line-windowed pieces near `capacity` chars. */
const splitByLines = (
  text: string,
  capacity: number,
): { body: string; lineOffset: number }[] => {
  const lines = text.split("\n");
  const out: { body: string; lineOffset: number }[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    buf.push(line);
    bufLen += line.length + 1;
    if (bufLen >= capacity) {
      out.push({ body: buf.join("\n"), lineOffset: startLine });
      buf = [];
      bufLen = 0;
      startLine = i + 1;
    }
  }
  if (buf.length > 0) out.push({ body: buf.join("\n"), lineOffset: startLine });
  return out;
};

export const chunkFile = (
  filePath: string,
  language: Language,
  source: string,
  rootNode: Node,
  config: LanguageConfig,
  capacity = DEFAULT_CHUNK_SIZE,
): Chunk[] => {
  const chunks: Chunk[] = [];
  const defTypes = new Set(config.chunkNodeTypes);

  const pushChunk = (body: string, startByte: number, startRow: number): void => {
    if (body.trim().length === 0) return;
    const endRow = startRow + body.split("\n").length - 1;
    chunks.push({
      id: chunkId(filePath, startByte),
      filePath,
      language,
      startLine: startRow + 1,
      endLine: endRow + 1,
      body,
    });
  };

  // Emit a definition node as one or more chunks (split if oversized).
  const emitDef = (node: Node): void => {
    const text = node.text;
    if (text.length <= capacity) {
      pushChunk(text, node.startIndex, node.startPosition.row);
      return;
    }
    for (const piece of splitByLines(text, capacity)) {
      const startRow = node.startPosition.row + piece.lineOffset;
      // approximate startByte for id uniqueness
      const approxByte = node.startIndex + piece.lineOffset;
      pushChunk(piece.body, approxByte, startRow);
    }
  };

  // Walk top-level named children; group non-def runs into filler chunks.
  let fillerStart: Node | null = null;
  let fillerEnd: Node | null = null;

  const flushFiller = (): void => {
    if (!fillerStart || !fillerEnd) return;
    const body = source.slice(fillerStart.startIndex, fillerEnd.endIndex);
    pushChunk(body, fillerStart.startIndex, fillerStart.startPosition.row);
    fillerStart = null;
    fillerEnd = null;
  };

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const child = rootNode.namedChild(i);
    if (!child) continue;

    // Unwrap export_statement to reach the inner declaration.
    const target =
      child.type === "export_statement" && child.namedChildCount > 0
        ? child.namedChild(0) ?? child
        : child;

    if (defTypes.has(target.type)) {
      flushFiller();
      emitDef(child); // keep the export wrapper text in the chunk
    } else {
      if (!fillerStart) fillerStart = child;
      fillerEnd = child;
    }
  }
  flushFiller();

  // Fallback: no chunks (e.g. tiny/odd file) → one chunk for the whole file.
  if (chunks.length === 0 && source.trim().length > 0) {
    pushChunk(source, 0, 0);
  }

  return chunks;
};
