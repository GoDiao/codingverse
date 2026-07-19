# Changelog

All notable changes to codingverse are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project has not
yet cut a numbered release; the sections below track the development milestones
by generation (v1 → v2 → v2.5 → v3).

## Unreleased

### Added — v3 (scoped packing, real call graph, watch, multi-language)

- **Diff-scoped packing** — `cv pack --changed` / `--since <ref>` packs changed
  files plus their reverse call-graph impact radius.
- **Query-scoped packing** — `cv pack --query "<text>"` packs search hits plus
  their bidirectional call-graph neighborhood.
- **Real call graph in retrieval** — search's structural path now walks the
  actual call graph (callers + callees, ranked by hop distance), replacing the
  earlier same-file line-proximity heuristic. RRF fusion is unchanged.
- **Continuous indexing** — `cv watch` re-indexes on file changes; `cv serve
  --watch` keeps the dashboard live.
- **Multi-language extractors** — Go, Rust, and Java, in addition to
  TypeScript, JavaScript, and Python.

### Added — v2.5 (observation dashboard)

- `@codingverse/dashboard` package and `cv serve` — a `node:http` server with a
  zero-build SPA.
- Six boards: Overview, Token map, Code graph, Retrieval (search inspector),
  Pack (live layered-pack preview), and Sync (index/cache state).
- `cv status` extended with an index overview, health, and language breakdown
  (`--json`, `--token-map`).
- Performance pass: batched pagerank writeback, BFS depth capping, SCIP
  name→id preloading, and instance/statement caching.

### Added — v2 (call graph + ranking)

- Call-graph traversal: `cv callers` / `cv callees` / `cv impact` (BFS with
  container drill-down).
- PageRank over the call graph (`cv rank`), used to prioritize symbols in
  packing and search.
- Optional SCIP import (`cv index --scip`) for precise edges.
- MCP server expanded to 7 tools (adds `callers` / `callees` / `impact`).

### Added — v1 (foundation)

- The core pipeline: ingest → parse → index → assemble.
- SQLite index with FTS5, tree-sitter parsing, and heuristic reference
  resolution into call edges.
- Layered packing (`full` / `skeleton` / `outline` / `omit`) with a token
  budget, and `cv expand` for on-demand skeleton expansion.
- Hybrid search (`cv search`): BM25 fused with a graph path via RRF, with a
  trigram tokenizer so CamelCase identifiers are findable.
- `@codingverse/mcp` server with 4 tools (`search` / `pack` / `expand` /
  `get_file`) over stdio.
