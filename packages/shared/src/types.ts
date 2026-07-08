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

export interface PackResult {
  content: string;
  tokenCount: number;
  layerMap: Record<string, Layer>;
  fileCount: number;
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
