import { createRequire } from "node:module";
import { Parser, Language as WasmLanguage, Query, type Node, type Tree } from "web-tree-sitter";
import type { Language } from "@codingverse/shared";
import { getLanguageConfig } from "./languages/registry.js";

const require = createRequire(import.meta.url);

/**
 * web-tree-sitter runtime wrapper.
 *
 * - Parser.init() once (WASM runtime bootstrap)
 * - lazy-load grammar wasm per language, cached
 * - cached Parser + compiled Query per language
 *
 * NOTE: web-tree-sitter parsers hold native WASM heap memory invisible to V8 GC.
 * Trees must be `.delete()`d after use (handled in extract/chunker).
 */

let runtimeInit: Promise<void> | undefined;
const languageCache = new Map<Language, WasmLanguage>();
const parserCache = new Map<Language, Parser>();
const queryCache = new Map<Language, Query>();
const unavailable = new Set<Language>();

const initRuntime = (): Promise<void> => {
  runtimeInit ??= Parser.init();
  return runtimeInit;
};

/** Resolve a grammar wasm path from the tree-sitter-wasms package. */
const resolveWasm = (wasmFile: string): string =>
  require.resolve(`tree-sitter-wasms/out/${wasmFile}`);

/** Load (and cache) the grammar Language for a given language. */
const loadLanguage = async (language: Language): Promise<WasmLanguage | undefined> => {
  if (languageCache.has(language)) return languageCache.get(language);
  if (unavailable.has(language)) return undefined;

  const config = getLanguageConfig(language);
  if (!config) {
    unavailable.add(language);
    return undefined;
  }

  await initRuntime();
  try {
    const lang = await WasmLanguage.load(resolveWasm(config.wasmFile));
    languageCache.set(language, lang);
    return lang;
  } catch {
    unavailable.add(language);
    return undefined;
  }
};

export interface ParserHandle {
  language: Language;
  parser: Parser;
  query: Query;
}

/**
 * Get a ready parser + compiled tags query for a language, or undefined if
 * the language is unsupported or its grammar failed to load.
 */
export const getParser = async (language: Language): Promise<ParserHandle | undefined> => {
  const lang = await loadLanguage(language);
  if (!lang) return undefined;

  let parser = parserCache.get(language);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(lang);
    parserCache.set(language, parser);
  }

  let query = queryCache.get(language);
  if (!query) {
    const config = getLanguageConfig(language)!;
    query = new Query(lang, config.tagsQuery);
    queryCache.set(language, query);
  }

  return { language, parser, query };
};

/** Parse source into a Tree. Caller MUST call tree.delete() when done. */
export const parseSource = (handle: ParserHandle, source: string): Tree | null =>
  handle.parser.parse(source);

export type { Node, Tree };

/** Test/util: release all cached WASM resources. */
export const resetParserCaches = (): void => {
  for (const p of parserCache.values()) p.delete?.();
  parserCache.clear();
  queryCache.clear();
  languageCache.clear();
  unavailable.clear();
};
