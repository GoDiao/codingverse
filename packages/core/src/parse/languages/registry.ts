import type { Language } from "@codingverse/shared";
import { TS_TAGS, JS_TAGS } from "./typescript.js";
import { PY_TAGS } from "./python.js";
import { GO_TAGS } from "./go.js";
import { RUST_TAGS } from "./rust.js";
import { JAVA_TAGS } from "./java.js";

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
  /** Block style: brace `{}` or indentation. Drives skeleton rendering. */
  scopeStyle: "brace" | "indent";
  /** Single-line comment prefix (for skeleton placeholders). */
  lineComment: string;
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
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
};

const TS_CHUNK_NODES = [
  "function_declaration",
  "method_definition",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
];
const JS_CHUNK_NODES = ["function_declaration", "method_definition", "class_declaration"];
const GO_CHUNK_NODES = ["function_declaration", "method_declaration", "type_declaration"];
const RUST_CHUNK_NODES = [
  "function_item",
  "struct_item",
  "enum_item",
  "trait_item",
  "impl_item",
  "type_item",
];
const JAVA_CHUNK_NODES = [
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "method_declaration",
  "constructor_declaration",
];

const CONFIGS: Partial<Record<Language, LanguageConfig>> = {
  typescript: {
    language: "typescript",
    wasmFile: "tree-sitter-typescript.wasm",
    tagsQuery: TS_TAGS,
    chunkNodeTypes: TS_CHUNK_NODES,
    scopeStyle: "brace",
    lineComment: "//",
  },
  tsx: {
    language: "tsx",
    wasmFile: "tree-sitter-tsx.wasm",
    tagsQuery: TS_TAGS,
    chunkNodeTypes: TS_CHUNK_NODES,
    scopeStyle: "brace",
    lineComment: "//",
  },
  javascript: {
    language: "javascript",
    wasmFile: "tree-sitter-javascript.wasm",
    tagsQuery: JS_TAGS,
    chunkNodeTypes: JS_CHUNK_NODES,
    scopeStyle: "brace",
    lineComment: "//",
  },
  jsx: {
    language: "jsx",
    wasmFile: "tree-sitter-javascript.wasm",
    tagsQuery: JS_TAGS,
    chunkNodeTypes: JS_CHUNK_NODES,
    scopeStyle: "brace",
    lineComment: "//",
  },
  python: {
    language: "python",
    wasmFile: "tree-sitter-python.wasm",
    tagsQuery: PY_TAGS,
    chunkNodeTypes: ["function_definition", "class_definition"],
    scopeStyle: "indent",
    lineComment: "#",
  },
  go: {
    language: "go",
    wasmFile: "tree-sitter-go.wasm",
    tagsQuery: GO_TAGS,
    chunkNodeTypes: GO_CHUNK_NODES,
    scopeStyle: "brace",
    lineComment: "//",
  },
  rust: {
    language: "rust",
    wasmFile: "tree-sitter-rust.wasm",
    tagsQuery: RUST_TAGS,
    chunkNodeTypes: RUST_CHUNK_NODES,
    scopeStyle: "brace",
    lineComment: "//",
  },
  java: {
    language: "java",
    wasmFile: "tree-sitter-java.wasm",
    tagsQuery: JAVA_TAGS,
    chunkNodeTypes: JAVA_CHUNK_NODES,
    scopeStyle: "brace",
    lineComment: "//",
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
