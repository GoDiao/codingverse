import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";
import type { TreemapNode } from "@codingverse/shared";

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

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show index status and observation state")
    .argument("[path]", "repository path", ".")
    .option("--token-map", "print token treemap (Dashboard board ② CLI form)")
    .action(async (repoPath: string, opts: { tokenMap?: boolean }) => {
      const absRepo = path.resolve(repoPath);
      const engine = await Engine.open(absRepo);

      if (opts.tokenMap) {
        const { files, total, treemap } = await engine.tokenReport();
        printTreemap(treemap, total);
        console.error(
          `\n[cv status] ${files.length} files, ${total} tokens total ` +
            `(encoding: o200k_base)`,
        );
        await engine.close();
        return;
      }

      // Default status view (full index status lands in v1 once SQLite exists).
      const { files, total } = await engine.tokenReport();
      console.log(`repo:   ${absRepo}`);
      console.log(`files:  ${files.length}`);
      console.log(`tokens: ${total}`);
      console.log(`\nTop files by tokens:`);
      for (const f of files.slice(0, 10)) {
        console.log(`  ${String(f.tokens).padStart(8)}  ${f.path}`);
      }
      await engine.close();
    });
}
