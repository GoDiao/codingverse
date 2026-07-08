import type { Language } from "@codingverse/shared";
import { TS_TAGS } from "./typescript.js";
import { PY_TAGS } from "./python.js";

/**
 * Declarative per-language configuration.
 * Adding a language = one entry here + its wasm in tree-sitter-wasms + a tags query.
 */
export interface LanguageConfig {
  language: Language;
  /** Grammar wasm filename within `tree-sitter-wasms/out/`. */
  wasmFile: string;
  /** tree-sitter tags query (scm) for symbol + reference capture. */
  tagsQuery: string;
  /** AST node types that form good chunk boundaries (definitions). */
  chunkNodeTypes: string[];
}

const EXTENSION_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".py": "python",
  ".pyw": "python",
};

const CONFIGS: Partial<Record<Language, LanguageConfig>> = {
  typescript: {
    language: "typescript",
    wasmFile: "tree-sitter-typescript.wasm",
    tagsQuery: TS_TAGS,
    chunkNodeTypes: [
      "function_declaration",
      "method_definition",
      "class_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "enum_declaration",
    ],
  },
  tsx: {
    language: "tsx",
    wasmFile: "tree-sitter-tsx.wasm",
    tagsQuery: TS_TAGS,
    chunkNodeTypes: [
      "function_declaration",
      "method_definition",
      "class_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "enum_declaration",
    ],
  },
  javascript: {
    language: "javascript",
    wasmFile: "tree-sitter-javascript.wasm",
    tagsQuery: TS_TAGS,
    chunkNodeTypes: [
      "function_declaration",
      "method_definition",
      "class_declaration",
    ],
  },
  jsx: {
    language: "jsx",
    wasmFile: "tree-sitter-javascript.wasm",
    tagsQuery: TS_TAGS,
    chunkNodeTypes: [
      "function_declaration",
      "method_definition",
      "class_declaration",
    ],
  },
  python: {
    language: "python",
    wasmFile: "tree-sitter-python.wasm",
    tagsQuery: PY_TAGS,
    chunkNodeTypes: ["function_definition", "class_definition"],
  },
};

/** Detect language from a file path's extension. */
export const detectLanguage = (filePath: string): Language => {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "unknown";
  const ext = filePath.slice(dot).toLowerCase();
  return EXTENSION_MAP[ext] ?? "unknown";
};

/** Get the language config, or undefined if unsupported. */
export const getLanguageConfig = (language: Language): LanguageConfig | undefined =>
  CONFIGS[language];

/** List all supported languages that have a config. */
export const supportedLanguages = (): Language[] =>
  Object.keys(CONFIGS) as Language[];
