/**
 * Core domain types for codingverse.
 * Single source of truth shared across core / cli / mcp / dashboard.
 */

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
