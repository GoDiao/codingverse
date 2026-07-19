# codingverse

**English** · [简体中文](./README.zh-CN.md)

> A unified Code RAG toolkit — **index once, three-mode output: pack / search / observe.**

**[→ codingverse.github.io landing page](https://godiao.github.io/codingverse/)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-233%20passing-success.svg)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178c6.svg)](https://www.typescriptlang.org/)

codingverse turns a code repository into a single SQLite index (symbols, call edges, chunks), then serves that index through three complementary outputs:

- **pack** — assemble a token-budgeted, layered context file for an LLM
- **search** — hybrid retrieval (BM25 + call graph, fused via RRF)
- **observe** — a six-board dashboard to see what the index actually contains

Everything is built on tree-sitter parsing and a local call graph — no embeddings, no external services, no API keys.

---

## Table of contents

- [Why](#why)
- [Features](#features)
- [Install](#install)
- [Quickstart](#quickstart)
- [The three modes](#the-three-modes)
- [CLI reference](#cli-reference)
- [MCP integration](#mcp-integration)
- [Dashboard](#dashboard)
- [Language support](#language-support)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Why

Feeding a whole repo to an LLM wastes tokens; feeding hand-picked files misses context. codingverse indexes the repo once, then lets you extract exactly the slice you need:

- Pack a **token budget** worth of the most important code, compressing the rest to skeletons/outlines instead of dropping it.
- Pack only what **changed** (`--changed` / `--since`) plus its call-graph impact radius.
- Pack only what a **query** matches (`--query`) plus its call-graph neighborhood.
- Search with a real call graph so results include callers/callees, not just text matches.

## Features

- **Layered packing** — every symbol is rendered at one of four fidelity levels (`full` / `skeleton` / `outline` / `omit`) to fit a token budget, ranked by PageRank over the call graph.
- **Diff-scoped packing** — `cv pack --changed` / `--since <ref>` packs changed files plus their reverse call-graph impact.
- **Query-scoped packing** — `cv pack --query "<text>"` packs search hits plus their bidirectional call-graph neighborhood.
- **Hybrid search** — BM25 lexical retrieval fused with real call-graph expansion (callers + callees) via Reciprocal Rank Fusion.
- **Call-graph navigation** — `callers` / `callees` / `impact` traversal over resolved edges.
- **Continuous indexing** — `cv watch` re-indexes on file changes; `cv serve --watch` keeps the dashboard live.
- **Observation dashboard** — six boards over a zero-build SPA served by `node:http`.
- **MCP server** — 7 tools over stdio for editor/agent integration.
- **Multi-language** — TypeScript, JavaScript, Python, Go, Rust, Java.
- **Local-only** — SQLite index, no embeddings, no network calls.

## Install

Requires **Node ≥ 20** and **pnpm**. codingverse is a pnpm monorepo; build from source:

```bash
git clone <your-fork-url> codingverse
cd codingverse
pnpm install
pnpm -r build
```

The CLI entry point is `packages/cli/dist/bin.js`. Run it directly, or wire a shell alias:

```bash
alias cv="node /absolute/path/to/codingverse/packages/cli/dist/bin.js"
```

The rest of this README assumes `cv` resolves to that binary.

## Quickstart

```bash
# 1. Build the index for a repo (symbols, call edges, chunks)
cv index /path/to/repo

# 2. Compute PageRank so packing/search can prioritize important symbols
cv rank /path/to/repo

# 3a. PACK — write a 32k-token context file
cv pack /path/to/repo --budget 32000 -o context.xml

# 3b. SEARCH — hybrid retrieval
cv search "token budget" /path/to/repo

# 3c. OBSERVE — open the dashboard at http://127.0.0.1:7331
cv serve /path/to/repo

# Keep the index hot while you work
cv watch /path/to/repo
```

Scoped packing for focused context:

```bash
# Only files changed vs HEAD + their impact radius
cv pack . --changed --budget 16000

# Only files changed since a ref
cv pack . --since main --budget 16000

# Only files a query matches + their call-graph neighborhood
cv pack . --query "retry backoff" --budget 16000
```

## The three modes

| Mode | Command | What you get |
|------|---------|--------------|
| **pack** | `cv pack` | A single layered context file (`xml` / `markdown` / `json`) sized to a token budget. Important symbols stay `full`; the rest degrade to `skeleton` → `outline` → `omit`. Skeletons can be re-expanded on demand with `cv expand`. |
| **search** | `cv search` | Ranked hits fusing BM25 (lexical) with call-graph expansion (structural). Add `--json` for machine-readable output. |
| **observe** | `cv serve` | A local dashboard with six boards: Overview, Token map, Code graph, Retrieval, Pack, Sync. |

## CLI reference

| Command | Description |
|---------|-------------|
| `cv index [path]` | Build or refresh the SQLite index (symbols, edges, chunks). `--scip <file>` imports a SCIP index for precise edges. |
| `cv rank [path]` | Compute PageRank over the call graph, written back to `nodes.pagerank`. `--damping`, `--max-iter`. |
| `cv pack [path]` | Pack a repo into a layered LLM context file. `-o`, `-f xml\|markdown\|json`, `-b <tokens>`, `--changed`, `--since <ref>`, `--query <text>`, `-k`, `-d`, `--always-full <globs>`. |
| `cv search <query> [path]` | Hybrid search (BM25 + call graph via RRF). `-k <n>`, `--json`. |
| `cv expand [id] [path]` | Expand a skeleton symbol by id, or `--list` expandable ids from the last pack. `--meta` for metadata only. |
| `cv callers <node\|name> [path]` | Who calls this node (reverse BFS). `-d <depth>`. |
| `cv callees <node\|name> [path]` | What this node calls (forward BFS). `-d <depth>`. |
| `cv impact <node\|name> [path]` | Impact radius (reverse BFS with container drill-down). `-d <depth>`. |
| `cv status [path]` | Index status and observation state. `--token-map`, `--json`. |
| `cv serve [path]` | Start the dashboard HTTP server. `-p <port>`, `--host`, `--watch`. |
| `cv watch [path]` | Continuously re-index on file changes. `--debounce <ms>`, `--no-rank`. |

Full option details in [docs/cli-reference.md](./docs/cli-reference.md).

## MCP integration

The `cv-mcp` server (in `@codingverse/mcp`) exposes the engine over stdio via the Model Context Protocol, with 7 tools:

`search` · `pack` · `expand` · `get_file` · `callers` · `callees` · `impact`

Point an MCP-capable client at the built server binary (`packages/mcp/dist/bin.js`). Example client config:

```json
{
  "mcpServers": {
    "codingverse": {
      "command": "node",
      "args": ["/absolute/path/to/codingverse/packages/mcp/dist/bin.js", "/path/to/repo"]
    }
  }
}
```

The repo must be indexed first (`cv index`).

## Dashboard

`cv serve` starts a zero-build single-page app on `127.0.0.1:7331` (localhost-only by default). Six boards:

1. **Overview** — index stats, health, language breakdown
2. **Token map** — treemap of where the token budget goes
3. **Code graph** — interactive call graph with caller/callee highlighting
4. **Retrieval** — search inspector: BM25 vs call-graph paths, fused by RRF
5. **Pack** — live layered-pack preview with budget/strategy controls and full-output export
6. **Sync** — last index run and changed-file state

Use `cv serve --watch` to have the boards refresh as you edit code.

## Language support

| Language | Extensions | Symbols extracted |
|----------|-----------|-------------------|
| TypeScript | `.ts` `.mts` `.cts` `.tsx` | class, interface, type, enum, function, method |
| JavaScript | `.js` `.mjs` `.cjs` `.jsx` | class, function, method |
| Python | `.py` `.pyw` | class, function, method |
| Go | `.go` | func, method, struct, interface, type |
| Rust | `.rs` | fn, struct, enum, trait, type |
| Java | `.java` | class, interface, enum, method, constructor |

Adding a language is one tree-sitter tags query plus one registry entry — see [docs/architecture.md](./docs/architecture.md#adding-a-language).

## Architecture

codingverse is a pnpm monorepo of five packages:

| Package | Role |
|---------|------|
| `@codingverse/shared` | Shared types, constants, SQLite schema |
| `@codingverse/core` | The engine: ingest → parse → index → assemble pipeline |
| `codingverse` (cli) | The `cv` command-line interface |
| `@codingverse/dashboard` | Observation-mode HTTP server + SPA |
| `@codingverse/mcp` | MCP server over stdio |

The pipeline: **ingest** (walk + gitignore) → **parse** (tree-sitter → symbols + refs + chunks) → **index** (SQLite + FTS5, resolve refs into call edges) → **assemble** (layered pack / hybrid search). See [docs/architecture.md](./docs/architecture.md) for the full design.

## Development

```bash
pnpm install
pnpm -r build       # build all packages
pnpm -r test        # run the test suite (233 tests, centralized in core)
pnpm -r typecheck   # type-check without emitting
```

Tests live in `@codingverse/core` and cover parsing, indexing, resolution, ranking, packing, search fusion, scoped packing, watching, and multi-language extraction.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup, project structure, and PR flow. Please also read the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE)
