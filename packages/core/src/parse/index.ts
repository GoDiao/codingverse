// Stage ② Parse: web-tree-sitter WASM parsing, symbol extraction, AST chunking.

import { createHash } from "node:crypto";
import type { FileEntry, ParsedFile, Chunk, Language } from "@codingverse/shared";
import { detectLanguage, getLanguageConfig } from "./languages/registry.js";
import { getParser, resetParserCaches } from "./parser.js";
import { extractSymbols } from "./extract.js";
import { chunkFile } from "./chunker.js";

export { detectLanguage, getLanguageConfig, supportedLanguages } from "./languages/index.js";
export { getParser, resetParserCaches } from "./parser.js";
export { extractSymbols } from "./extract.js";
export { chunkFile } from "./chunker.js";

const wholeFileChunk = (file: FileEntry, language: Language): Chunk => ({
  id: createHash("sha1").update(`${file.path}:0`).digest("hex").slice(0, 16),
  filePath: file.path,
  language,
  startLine: 1,
  endLine: file.content.split("\n").length,
  body: file.content,
});

/**
 * Parse a single file: detect language → parse AST → extract symbols/refs → chunk.
 * Unsupported languages or parse failures degrade to a single whole-file chunk.
 */
export const parseFile = async (file: FileEntry): Promise<ParsedFile> => {
  const language = detectLanguage(file.path);
  const config = getLanguageConfig(language);

  if (!config) {
    // Unsupported language: degrade to whole-file chunk, no symbols.
    return {
      path: file.path,
      language,
      symbols: [],
      refs: [],
      chunks: [wholeFileChunk(file, language)],
      degraded: true,
    };
  }

  const handle = await getParser(language);
  if (!handle) {
    return {
      path: file.path,
      language,
      symbols: [],
      refs: [],
      chunks: [wholeFileChunk(file, language)],
      degraded: true,
    };
  }

  const tree = handle.parser.parse(file.content);
  if (!tree) {
    return {
      path: file.path,
      language,
      symbols: [],
      refs: [],
      chunks: [wholeFileChunk(file, language)],
      degraded: true,
    };
  }

  try {
    const { symbols, refs } = extractSymbols(handle, tree.rootNode);
    const chunks = chunkFile(file.path, language, file.content, tree.rootNode, config);
    return { path: file.path, language, symbols, refs, chunks, degraded: false };
  } catch {
    return {
      path: file.path,
      language,
      symbols: [],
      refs: [],
      chunks: [wholeFileChunk(file, language)],
      degraded: true,
    };
  } finally {
    // Release native WASM heap held by the tree.
    tree.delete();
  }
};

/** Parse many files sequentially (WASM parser is single-threaded per language). */
export const parseFiles = async (files: FileEntry[]): Promise<ParsedFile[]> => {
  const out: ParsedFile[] = [];
  for (const file of files) out.push(await parseFile(file));
  return out;
};

/** Release all cached WASM resources (tests/shutdown). */
export const disposeParsers = (): void => resetParserCaches();
