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

/**
 * A cached parse result keyed by content hash (git blob oid).
 * Stored under `<repo>/.codingverse/parse-cache.json`.
 */
export interface ParseCacheEntry {
  /** git blob hash of the file content at index time. */
  blobHash: string;
  parsed: ParsedFile;
}

/** Stats about cache hits/misses during a parse run. */
export interface ParseCacheStats {
  hits: number;
  misses: number;
  total: number;
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
  /**
   * v2-polish: scip-provenance edges that existed BEFORE this index() run.
   * A full re-index deletes nodes per file (FK cascade drops ALL edges,
   * including provenance='scip'), so this count lets the CLI warn the user
   * to re-run `cv index --scip`. Undefined/0 when no scip edges were present.
   */
  scipEdgesBefore?: number;
  /**
   * v2-polish: nodes with non-zero pagerank BEFORE this index() run. A full
   * re-index inserts pagerank=0 for all nodes, so this count lets the CLI
   * warn the user to re-run `cv rank`. Undefined/0 when none were ranked.
   */
  rankedNodesBefore?: number;
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

/**
 * v2.5-V5: board ③ code-graph payload. A pagerank-ranked subset of the symbol
 * graph — the top `limit` nodes by pagerank plus the edges that run BETWEEN
 * those selected nodes (edges to un-selected nodes are dropped so the frontend
 * never references a node id absent from `nodes`). `maxPagerank` drives the
 * D3 heat color scale; `truncated` is true when the graph had more nodes than
 * `limit`, so the UI can show "showing top N of M".
 */
export interface GraphNode {
  id: string;
  name: string;
  qualifiedName?: string;
  filePath: string;
  kind: string;
  pagerank: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { source: string; target: string; kind: string }[];
  maxPagerank: number;
  totalNodes: number;
  truncated: boolean;
}

/**
 * Full metadata for a single symbol node, backing board ③'s click-detail
 * panel. Everything the `nodes` row holds plus a global `pagerankRank`
 * (1 = highest pagerank in the repo) so the UI can show "#12 of 393".
 * Null fields mean the parser never captured that column for this symbol.
 */
export interface NodeDetail {
  id: string;
  name: string;
  qualifiedName?: string;
  kind: string;
  filePath: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  docstring?: string;
  visibility?: string;
  pagerank: number;
  pagerankRank: number;
  totalNodes: number;
}

/**
 * v2.5-V4: runtime state of the last `index()` run, persisted to the `meta`
 * table so a fresh `cv serve` process (which never runs index() itself) can
 * still surface board ⑥ (sync status). `changedFiles` are the cache-miss
 * paths that were actually re-parsed this run; hits were served from the
 * incremental parse cache. Null/absent until the repo has been indexed once.
 */
export interface SyncState {
  /** Epoch-ms when the index() run finished. */
  timestamp: number;
  /** Wall-clock duration of the index() run. */
  durationMs: number;
  /** Total files seen this run (hits + misses). */
  filesProcessed: number;
  /** Files served from the incremental parse cache (unchanged). */
  parseCacheHits: number;
  /** Files re-parsed this run (new or changed content). */
  parseCacheMisses: number;
  /** The cache-miss paths that were re-parsed this run. */
  changedFiles: string[];
}

/**
 * v2.5-V7: pack-preview payload for Dashboard board ⑤. Runs the pack pipeline
 * at a given token budget + layer strategy but returns ONLY the layer decision
 * summary — per-file layer + tokens, layer counts, totals — never the rendered
 * content (which can be megabytes). `fits` is true when the packed total is at
 * or under budget. The UI drives a budget slider against this to show how the
 * layer mix (full/skeleton/outline/omit) shifts as the budget tightens.
 */
export interface PackPreview {
  budget: number;
  total: number;
  fits: boolean;
  strategy: string;
  files: { path: string; layer: Layer; tokens: number }[];
  layerCounts: Record<Layer, number>;
  expandableCount: number;
}
