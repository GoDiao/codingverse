# CLI reference

The `cv` command is the entry point for all local operations. Every command
takes an optional `[path]` argument (default `.`) pointing at the repository to
operate on. Most commands require the repo to be indexed first (`cv index`).

> Setup: after `pnpm -r build`, the binary is at
> `packages/cli/dist/bin.js`. Alias it as `cv` (see the README) or invoke with
> `node`.

## `cv index [path]`

Build or refresh the SQLite index (symbols, edges, chunks).

| Option | Description |
|--------|-------------|
| `--scip <path>` | Import a `.scip` index file, replacing heuristic edges with precise ones for covered files. |

A full re-index resets pagerank and any prior SCIP import; re-run `cv rank`
and/or `--scip` afterward. The command prints a note when it does so.

## `cv rank [path]`

Compute PageRank over the call graph and write scores back to `nodes.pagerank`.
Packing and search use these scores to prioritize important symbols.

| Option | Default | Description |
|--------|---------|-------------|
| `--damping <n>` | `0.85` | PageRank damping factor. |
| `--max-iter <n>` | `100` | Max power-iteration steps. |

## `cv pack [path]`

Pack a repository into a layered LLM context file.

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <file>` | stdout | Output file. |
| `-f, --format <fmt>` | `xml` | Output format: `xml`, `markdown`, or `json`. |
| `-b, --budget <tokens>` | `128000` | Token budget. |
| `--always-full <globs>` | `""` | Comma-separated globs to always keep at full fidelity. |
| `--changed` | | Pack only files changed vs HEAD + their impact radius. |
| `--since <ref>` | | Pack only files changed since `<ref>` + their impact radius. |
| `--query <text>` | | Pack only files matching a search + their call-graph neighborhood. |
| `-k, --top-k <n>` | `10` | Search hits to seed `--query` packing. |
| `-d, --depth <n>` | `2` | Expansion depth for `--changed` / `--since` / `--query`. |
| `--list` | | List ingested files only (preview). |
| `--symbols` | | List extracted symbols per file (preview). |

Scoping modes are mutually informative: `--query` takes precedence over
`--changed` / `--since` if combined. Scope summaries are printed to stderr so
stdout stays a clean pipe.

## `cv search <query> [path]`

Hybrid search over the index (BM25 + call graph, fused via RRF).

| Option | Default | Description |
|--------|---------|-------------|
| `-k, --top-k <n>` | `20` | Number of hits to return. |
| `--json` | | Output full results as JSON (machine-readable). |

## `cv expand [id] [path]`

Expand a skeleton symbol by id, or list expandable ids from the last pack.

| Option | Description |
|--------|-------------|
| `--list` | List all expandable ids from the last pack. |
| `--meta` | Show symbol metadata instead of the body. |

## `cv callers <nodeId|name> [path]`

Who calls this node (reverse BFS along call edges). The first argument is a
16-char hex node id or a symbol name.

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --depth <n>` | `1` | Traversal depth. |

## `cv callees <nodeId|name> [path]`

What this node calls (forward BFS along call edges).

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --depth <n>` | `1` | Traversal depth. |

## `cv impact <nodeId|name> [path]`

Impact radius: reverse BFS with container drill-down.

| Option | Default | Description |
|--------|---------|-------------|
| `-d, --depth <n>` | `3` | Traversal depth. |

## `cv status [path]`

Show index status and observation state (dashboard board ① in CLI form).

| Option | Description |
|--------|-------------|
| `--token-map` | Print the token treemap (board ② in CLI form). |
| `--json` | Output full stats as JSON (machine-readable). |

## `cv serve [path]`

Start the dashboard HTTP server (observation mode, boards ①–⑥).

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <n>` | `7331` | Listen port. |
| `--host <host>` | `127.0.0.1` | Listen host (localhost-only by default). |
| `--watch` | | Continuously re-index on file changes so the boards stay live. |

## `cv watch [path]`

Continuously re-index on file changes to keep the index hot.

| Option | Default | Description |
|--------|---------|-------------|
| `--debounce <ms>` | `300` | Debounce window for coalescing a burst of changes. |
| `--no-rank` | | Skip PageRank after each re-index (faster). |

Press Ctrl-C to stop; the watcher and index handle shut down cleanly.
