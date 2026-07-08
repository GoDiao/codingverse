-- codingverse SQLite schema
-- Single source of truth for the index engine (stage ③).
-- Merges CodeGraph's symbol graph with Tabby's binarized-vector columns.

-- Symbol nodes (functions / classes / methods / variables …)
CREATE TABLE IF NOT EXISTS nodes (
  id             TEXT PRIMARY KEY,      -- hash(file_path + qualified_name)
  kind           TEXT NOT NULL,
  name           TEXT NOT NULL,
  qualified_name TEXT,
  file_path      TEXT NOT NULL,
  language       TEXT,
  start_line     INTEGER, end_line INTEGER,
  start_byte     INTEGER, end_byte INTEGER,
  signature      TEXT,                  -- used by skeleton compression
  docstring      TEXT,
  visibility     TEXT,                  -- public/private (PageRank multiplier)
  pagerank       REAL DEFAULT 0,        -- computed in stage ④, written back
  updated_at     INTEGER
);

-- Relationship edges (calls / references / extends / contains / imports)
CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  line       INTEGER, col INTEGER,
  provenance TEXT DEFAULT 'tree-sitter'
);

-- Code chunks (retrievable units, with vector)
CREATE TABLE IF NOT EXISTS chunks (
  id               TEXT PRIMARY KEY,    -- hash(file_path + start_byte)
  file_path        TEXT NOT NULL,
  language         TEXT,
  start_line       INTEGER, end_line INTEGER,
  body             TEXT NOT NULL,
  token_count      INTEGER,
  embedding        BLOB,                -- raw float32 vector (optional, sqlite-vec upgrade)
  embedding_tokens TEXT                 -- binarized token string (Tabby route, FTS search)
);

-- File-level incremental cache
CREATE TABLE IF NOT EXISTS files (
  path          TEXT PRIMARY KEY,
  git_blob_hash TEXT,                   -- cross-cutting B: incremental key
  content_hash  TEXT,
  language      TEXT,
  size          INTEGER,
  node_count    INTEGER,
  indexed_at    INTEGER,
  parse_status  TEXT                    -- ok/degraded/failed/skipped (Dashboard health)
);

-- Pending references (two-phase resolution)
CREATE TABLE IF NOT EXISTS unresolved_refs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id   TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  reference_name TEXT NOT NULL,
  reference_kind TEXT,
  line INTEGER, col INTEGER,
  file_path      TEXT, language TEXT
);

-- FTS5: symbol names
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id UNINDEXED, name, qualified_name, docstring, signature,
  content='nodes', content_rowid='rowid'
);

-- FTS5: chunk body (BM25) + binarized vector tokens (pseudo-vector)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  id UNINDEXED, body, embedding_tokens,
  content='chunks', content_rowid='rowid'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path, start_line);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_tgt ON edges(target, kind);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_unresolved ON unresolved_refs(from_node_id, reference_name);

-- Metadata
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
