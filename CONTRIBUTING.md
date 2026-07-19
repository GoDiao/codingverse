# Contributing to codingverse

Thanks for your interest in contributing. This guide covers the development
setup, project layout, and the pull-request flow.

## Prerequisites

- **Node ≥ 20**
- **pnpm** (the repo pins `pnpm@10.31.0` via `packageManager`)

## Setup

```bash
git clone <your-fork-url> codingverse
cd codingverse
pnpm install
pnpm -r build
```

## Everyday commands

| Command | What it does |
|---------|--------------|
| `pnpm -r build` | Build all packages (`tsc` per package). |
| `pnpm -r test` | Run the test suite (centralized in `@codingverse/core`). |
| `pnpm -r typecheck` | Type-check without emitting. |
| `pnpm -r clean` | Remove build output. |

Run the CLI you just built with `node packages/cli/dist/bin.js <command>`, or
alias it as `cv` (see the README).

## Project layout

codingverse is a pnpm monorepo:

| Package | Role |
|---------|------|
| `@codingverse/shared` | Types, constants, SQLite schema — the data contract. |
| `@codingverse/core` | The engine and its ingest → parse → index → assemble pipeline. Tests live here. |
| `codingverse` (cli) | The `cv` command-line interface. |
| `@codingverse/dashboard` | Observation-mode HTTP server + SPA. |
| `@codingverse/mcp` | MCP server over stdio. |

See [docs/architecture.md](./docs/architecture.md) for how the pipeline works.

## Testing

Tests are written with [Vitest](https://vitest.dev/) and live in
`@codingverse/core`. When you add a feature or fix a bug:

- Add or update tests that cover the change.
- Keep tests deterministic — no reliance on wall-clock timing or network.
- Run `pnpm -r test` and make sure everything passes before opening a PR.

If you're touching a data contract, update `@codingverse/shared` and the schema
together so the rest of the pipeline stays consistent.

## Adding a language

Language support is intentionally small to extend — one tree-sitter tags query
plus one registry entry. See the
[architecture doc](./docs/architecture.md#adding-a-language) and the existing
Go/Rust/Java extractors in `packages/core/src/parse/languages/`.

## Pull requests

1. Branch off `master` (don't commit directly to it).
2. Make your change with tests.
3. Run `pnpm -r build`, `pnpm -r test`, and `pnpm -r typecheck`.
4. Update docs if you changed behavior or the CLI surface.
5. Open a PR using the template. Keep the title concise and describe what you
   changed, why, and how you verified it.

Small, focused PRs are easier to review and land faster than large ones.

## Code style

- TypeScript, ESM, strict types.
- Match the conventions of the file you're editing.
- Prefer clarity over cleverness; leave a short comment when the "why" isn't
  obvious from the code.

## Reporting bugs and requesting features

Use the issue templates. For bugs, include the exact command, your environment,
and expected vs actual behavior. A minimal repo that reproduces the issue is the
fastest path to a fix.

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).
