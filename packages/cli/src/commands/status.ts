import path from "node:path";
import { existsSync } from "node:fs";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";
import type { DashboardStats, TreemapNode } from "@codingverse/shared";
import { STATE_DIR } from "@codingverse/shared";

/** Render a treemap node as an indented tree with token counts + percentage. */
function printTreemap(node: TreemapNode, total: number, indent = "", isLast = true): void {
  if (node.path !== "") {
    const pct = total > 0 ? ((node.tokens / total) * 100).toFixed(1) : "0.0";
    const branch = indent === "" ? "" : isLast ? "└─ " : "├─ ";
    console.log(`${indent}${branch}${node.name}  ${node.tokens} tok (${pct}%)`);
  }
  const children = node.children ?? [];
  // sort children by tokens desc for readability
  const sorted = [...children].sort((a, b) => b.tokens - a.tokens);
  const childIndent = node.path === "" ? "" : indent + (isLast ? "   " : "│  ");
  sorted.forEach((child, i) => {
    printTreemap(child, total, childIndent, i === sorted.length - 1);
  });
}

/** Collect leaf (file) nodes from a treemap into a flat {path, tokens} list. */
function flattenLeaves(node: TreemapNode): { path: string; tokens: number }[] {
  const children = node.children ?? [];
  if (children.length === 0) {
    return node.path === "" ? [] : [{ path: node.path, tokens: node.tokens }];
  }
  return children.flatMap(flattenLeaves);
}

/** Human-readable byte size (B / KB / MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Epoch-ms → local ISO-ish string, or "never" when 0. */
function formatTimestamp(ms: number): string {
  if (!ms) return "never";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Print the full board-① overview from a DashboardStats. */
function printOverview(absRepo: string, stats: DashboardStats): void {
  const { index, health, languages, tokenMap } = stats;

  console.log(`repo:     ${absRepo}`);
  console.log(`files:    ${index.files}`);
  console.log(`symbols:  ${index.symbols}`);
  console.log(`edges:    ${index.edges}`);
  console.log(`chunks:   ${index.chunks}`);
  console.log(`db size:  ${formatBytes(index.dbSize)}`);
  console.log(`indexed:  ${formatTimestamp(index.lastSync)}`);

  console.log(`\nHealth:`);
  console.log(
    `  ok ${health.ok}  degraded ${health.degraded}  ` +
      `failed ${health.failed}  skipped ${health.skipped}`,
  );

  const langs = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  if (langs.length > 0) {
    console.log(`\nLanguages:`);
    for (const [lang, n] of langs) {
      console.log(`  ${String(n).padStart(6)}  ${lang}`);
    }
  }

  const leaves = flattenLeaves(tokenMap).sort((a, b) => b.tokens - a.tokens);
  if (leaves.length > 0) {
    console.log(`\nTop files by tokens:`);
    for (const f of leaves.slice(0, 10)) {
      console.log(`  ${String(f.tokens).padStart(8)}  ${f.path}`);
    }
  }
}

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show index status and observation state (Dashboard board ①)")
    .argument("[path]", "repository path", ".")
    .option("--token-map", "print token treemap (Dashboard board ② CLI form)")
    .option("--json", "output full DashboardStats as JSON (machine-readable)")
    .action(async (repoPath: string, opts: { tokenMap?: boolean; json?: boolean }) => {
      const absRepo = path.resolve(repoPath);
      const engine = await Engine.open(absRepo);

      try {
        // Board ② CLI form: token treemap. Re-parses from disk (does not
        // require an index), so it stays available on a never-indexed repo.
        if (opts.tokenMap) {
          const { files, total, treemap } = await engine.tokenReport();
          printTreemap(treemap, total);
          console.error(
            `\n[cv status] ${files.length} files, ${total} tokens total ` +
              `(encoding: o200k_base)`,
          );
          return;
        }

        // Default / --json views read the SQLite index via Engine.stats().
        // Guard the lazy-index invariant: if no index.db exists yet, don't let
        // ensureIndexDb() create an empty one — tell the user to index first.
        const indexPath = path.join(absRepo, STATE_DIR, "index.db");
        if (!existsSync(indexPath)) {
          console.error(
            "[cv status] no index found. Run `cv index` first to build it.",
          );
          process.exitCode = 1;
          return;
        }

        const stats = await engine.stats();

        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        printOverview(absRepo, stats);
      } catch (err: unknown) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        await engine.close();
      }
    });
}
