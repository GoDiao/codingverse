# Architecture

codingverse turns a repository into a single SQLite index and serves it through
three outputs: **pack**, **search**, and **observe**. This document describes
how the pieces fit together.

## System overview

```
                    ┌─────────────────────────────────────────┐
                    │              @codingverse/core            │
  repo files  ───▶  │  ingest → parse → index → assemble        │  ───▶  outputs
                    │            │                               │
                    │            ▼                               │
                    │   .codingverse/index.db (SQLite + FTS5)    │
                    └─────────────────────────────────────────┘
                          ▲              ▲              ▲
                          │              │              │
                     cv (CLI)       dashboard         mcp
                                   (observe)        (7 tools)
```

Everything is local. There are no embeddings and no network calls — retrieval
is BM25 (SQLite FTS5) fused with a call graph built from tree-sitter parses.

## Monorepo packages

| Package | Role |
|---------|------|
| `@codingverse/shared` | Types, constants, and the SQLite schema (`schema.sql`). The single source of truth for data contracts. |
| `@codingverse/core` | The engine and its four-stage pipeline. Everything else is a thin adapter over `Engine`. |
| `codingverse` (cli) | The `cv` command-line interface (built on `commander`). |
| `@codingverse/dashboard` | Observation mode: a `node:http` server plus a zero-build single-page app. |
| `@codingverse/mcp` | An MCP server exposing engine operations as 7 tools over stdio. |

## The pipeline

`@codingverse/core` is organized around a four-stage pipeline, mirrored by the
`src/` layout:

```
src/
  ingest/     # walk the repo, honor .gitignore, read file contents
  parse/      # tree-sitter → symbols, references, chunks (per language)
  indexdb/    # SQLite store, ref resolution, call graph, search, ranking
  budget/     # tokenization + budget accounting
  assemble/   # layered packing
  cache/      # parse cache (git-blob-hash) + git change detection
  Engine.ts   # the facade tying it all together
```

### 1. Ingest

Walk the repository tree, apply `.gitignore` and default ignore rules, and read
file contents. Produces a list of `FileEntry`.

### 2. Parse

Each file is parsed with its tree-sitter grammar (loaded lazily from
`tree-sitter-wasms`). A per-language **tags query** captures:

- `@definition.<kind>` — a symbol definition (class, function, method, struct, …)
- `@name` — the identifier for the nearest definition/reference
- `@reference.call` — a call site (becomes a call edge after resolution)

The parser emits **symbols** (with kind, name, scope, line span), **references**
(unresolved call sites), and **chunks** (definition-aligned slices of source for
retrieval). A **parse cache** keyed by git blob hash means unchanged files are
skipped on re-index.

### 3. Index

Symbols, chunks, and files are written to SQLite. FTS5 virtual tables index
chunk and node text for BM25. Then `RefResolver` resolves each unresolved
reference to a target node (same-file first, then cross-file same-language by
name) and writes a row into `edges` — this is the **call graph**.

Optionally, `cv rank` runs **PageRank** over the call graph and writes a score
back to each node, so packing and search can prioritize structurally important
symbols. A SCIP index can be imported (`--scip`) to replace heuristic edges with
precise ones for covered files.

#### SQLite schema

| Table | Purpose |
|-------|---------|
| `nodes` | Symbols: id, kind, name, qualified name, file, line/byte span, signature, docstring, visibility, pagerank |
| `edges` | Resolved relationships (e.g. `calls`) between nodes, with provenance |
| `chunks` | Definition-aligned source slices for retrieval |
| `files` | Per-file metadata (hash, language, parse status) |
| `unresolved_refs` | Reference sites not yet (or not) resolved into edges |
| `nodes_fts` / `chunks_fts` | FTS5 virtual tables for BM25 |
| `meta` | Key/value state, including the last sync snapshot |

### 4. Assemble

The index feeds two assembly paths:

**Layered packing.** Every symbol is rendered at one of four fidelity levels:

| Layer | Rendering |
|-------|-----------|
| `full` | Complete source |
| `skeleton` | Signature + docstring, body replaced by a placeholder |
| `outline` | Name and signature only |
| `omit` | Dropped (still counted in the file listing) |

Symbols are ranked by PageRank and packed `full` until the **token budget** is
consumed; the remainder degrade to skeleton → outline → omit. Skeletons carry a
stable id so a consumer can request the full body later via `cv expand`. Output
is `xml`, `markdown`, or `json`.

**Hybrid search.** A query runs two retrieval paths that are fused with
Reciprocal Rank Fusion (RRF, k=60):

- **BM25** — lexical match over `chunks_fts`, with CamelCase-aware tokenization.
- **Call graph** — the BM25 seed chunks map to symbol nodes; the graph is walked
  in both directions (callers + callees) up to a hop limit, and the reached
  nodes map back to chunks. Distance is hop count to the nearest seed.

A chunk present on both paths scores highest — it is both textually relevant and
structurally connected.

## Scoped packing

Two scoping modes narrow a pack to the relevant slice of the repo:

- **Diff-scoped** (`--changed` / `--since <ref>`): seed with files changed vs
  HEAD (or a ref), expand via the reverse call graph (impact radius), pack that
  set.
- **Query-scoped** (`--query <text>`): seed with search hits, expand via the
  bidirectional call-graph neighborhood, pack that set.

Both reuse the layered packer with a path whitelist (`restrictTo`).

## Continuous indexing

`watchRepo` (used by `cv watch` and `cv serve --watch`) watches the repo tree
with a recursive `fs.watch`, debounces bursts of change events, and runs a
single re-index (plus optional re-rank) per burst. The state directory,
`.git`, and `node_modules` are ignored so index writes don't trigger a loop.
The parse cache keeps re-indexing cheap since only changed files are re-parsed.

## Adding a language

Adding a language is deliberately small:

1. Write a tree-sitter **tags query** using the shared capture convention
   (`@definition.<kind>`, `@name`, `@reference.call`) in
   `packages/core/src/parse/languages/<lang>.ts`.
2. Add one entry to `CONFIGS` in
   `packages/core/src/parse/languages/registry.ts`: the grammar wasm filename,
   the tags query, chunk node types, scope style (`brace` / `indent`), and the
   line-comment prefix. Add the file extensions to `EXTENSION_MAP`.

The grammar wasm must be available in the `tree-sitter-wasms` package. The kinds
your tags emit must be recognized by `DEF_KIND` / `REF_KIND` in
`packages/core/src/parse/extract.ts` (extend those maps if you introduce a new
kind). That's it — the rest of the pipeline is language-agnostic.

See the Go/Rust/Java extractors for reference implementations.
