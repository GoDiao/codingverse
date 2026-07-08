/**
 * Core domain types for codingverse.
 * Single source of truth shared across core / cli / mcp / dashboard.
 */

// ─────────────────────────────────────────────────────────────
// Stage ① Ingest: file discovery & reading
// ─────────────────────────────────────────────────────────────

export type FileSkipReason =
  | "binary-extension"
  | "binary-content"
  | "size-limit"
  | "encoding-error"
  | "invalid-file";

/** A successfully ingested file: discovered, read, decoded, validated. */
export interface FileEntry {
  /** Path relative to repo root, POSIX separators. */
  path: string;
  /** Absolute filesystem path. */
  absPath: string;
  /** Decoded text content. */
  content: string;
  /** Byte length of the raw file. */
  size: number;
}

/** A file that was discovered but skipped, with the reason. */
export interface SkippedFile {
  path: string;
  reason: FileSkipReason;
}

/** Configuration for the ingest stage. */
export interface IngestConfig {
  /** Glob patterns to include. Defaults to all files. */
  include?: string[];
  /** Extra ignore glob patterns (on top of defaults + .gitignore). */
  exclude?: string[];
  /** Respect .gitignore / .git/info/exclude. Default true. */
  useGitignore?: boolean;
  /** Apply built-in DEFAULT_IGNORE list. Default true. */
  useDefaultIgnore?: boolean;
  /** Max file size in bytes; larger files are skipped. */
  maxFileSize?: number;
  /** Apply is_valid_file heuristics (reject minified/generated). Default true. */
  validate?: boolean;
  /** Concurrency for reading files. Default 64. */
  concurrency?: number;
}

/** Result of the ingest stage. */
export interface IngestResult {
  files: FileEntry[];
  skipped: SkippedFile[];
}

// ─────────────────────────────────────────────────────────────
// Stage ② Parse: symbols & relations
// ─────────────────────────────────────────────────────────────

/** Supported languages for parsing (M2: typescript/python; extended later). */
export type Language =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "unknown";

/** A raw symbol extracted from the AST, before indexing (no stable id yet). */
export interface RawSymbol {
  kind: SymbolKind;
  name: string;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
  /**
   * Byte offset where the body begins (after the signature): the `{` for
   * brace languages, or the newline after `:` for Python. Undefined when the
   * symbol has no body (e.g. type alias, interface member). Used by skeleton
   * compression to replace the body with a placeholder.
   */
  bodyStartByte?: number;
  signature?: string;
  docstring?: string;
  /** Names of enclosing scopes (outermost first), for qualified name. */
  scope: string[];
}

/** A raw reference (call/type/etc.) to another symbol by name. */
export interface RawRef {
  /** Referenced symbol name. */
  name: string;
  kind: EdgeKind;
  startLine: number;
  startByte: number;
}

/** Result of parsing a single file (stage ②). */
export interface ParsedFile {
  path: string;
  language: Language;
  symbols: RawSymbol[];
  refs: RawRef[];
  chunks: Chunk[];
  /** True if the parse used a fallback (unsupported lang / parse error). */
  degraded: boolean;
}

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "struct"
  | "enum"
  | "variable"
  | "constant"
  | "module"
  | "type"
  | "unknown";

export interface SymbolNode {
  /** hash(file_path + qualified_name) — stable across re-index */
  id: string;
  kind: SymbolKind;
  name: string;
  qualifiedName?: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
  signature?: string;
  docstring?: string;
  visibility?: "public" | "private" | "protected";
  pagerank?: number;
}

export type EdgeKind =
  | "calls"
  | "references"
  | "extends"
  | "implements"
  | "contains"
  | "imports";

export type EdgeProvenance = "tree-sitter" | "scip" | "heuristic";

export interface Edge {
  source: string;
  target: string;
  kind: EdgeKind;
  line?: number;
  col?: number;
  provenance: EdgeProvenance;
}

// ─────────────────────────────────────────────────────────────
// Stage ② Parse → ③ Index: chunks
// ─────────────────────────────────────────────────────────────

export interface Chunk {
  /** hash(file_path + start_byte) */
  id: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  body: string;
  tokenCount?: number;
  /** binarized embedding tokens (Tabby-style pseudo-vector) */
  embeddingTokens?: string;
}

// ─────────────────────────────────────────────────────────────
// Stage ④ Assemble: pack output
// ─────────────────────────────────────────────────────────────

export type Layer = "full" | "skeleton" | "outline" | "omit";

export type OutputFormat = "xml" | "markdown" | "json";

export interface PackOptions {
  tokenBudget?: number;
  format?: OutputFormat;
  template?: string;
  include?: string[];
  exclude?: string[];
  layerStrategy?: "auto" | "full" | "skeleton" | "outline";
  alwaysFull?: string[];
}

/** One file rendered at a chosen layer. */
export interface PackedFile {
  path: string;
  language: Language;
  layer: Layer;
  /** Rendered content for this layer (empty when layer === "omit"). */
  content: string;
  tokens: number;
}

/** A skeleton-expandable symbol: maps a stable id back to its source span. */
export interface ExpandEntry {
  id: string;
  path: string;
  name: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
}

export interface PackResult {
  content: string;
  tokenCount: number;
  layerMap: Record<string, Layer>;
  fileCount: number;
  /** Files with their chosen layers (for Dashboard board ⑤). */
  files: PackedFile[];
  /** Skeleton expansion map: stable id → source span. */
  expandMap: Record<string, ExpandEntry>;
}

// ─────────────────────────────────────────────────────────────
// Stage ④ Assemble: search
// ─────────────────────────────────────────────────────────────

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  graphExpand?: boolean;
}

export interface SearchScores {
  vector: number;
  bm25: number;
  graph: number;
  rrf: number;
}

export interface SearchHit {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;
  scores: SearchScores;
  relatedNodes: string[];
}

// ─────────────────────────────────────────────────────────────
// Index lifecycle
// ─────────────────────────────────────────────────────────────

export type ParseStatus = "ok" | "degraded" | "failed" | "skipped";

export interface IndexStats {
  filesProcessed: number;
  filesSkipped: number;
  symbols: number;
  edges: number;
  chunks: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────
// Observation (Dashboard)
// ─────────────────────────────────────────────────────────────

export interface TreemapNode {
  name: string;
  path: string;
  tokens: number;
  children?: TreemapNode[];
}

export interface DashboardStats {
  index: {
    files: number;
    symbols: number;
    edges: number;
    chunks: number;
    dbSize: number;
    lastSync: number;
  };
  health: Record<ParseStatus, number>;
  languages: Record<string, number>;
  tokenMap: TreemapNode;
  syncQueue: { path: string; status: string }[];
}
