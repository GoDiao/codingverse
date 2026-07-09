import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";
import type { SymbolNode } from "@codingverse/shared";

function formatNode(n: SymbolNode): string {
  const name = n.qualifiedName ?? n.name;
  const pr = n.pagerank && n.pagerank > 0 ? `  [pagerank=${n.pagerank.toFixed(4)}]` : "";
  return `${n.filePath}:${n.startLine}-${n.endLine}  ${n.kind}  ${name}${pr}`;
}

export function registerImpact(program: Command): void {
  program
    .command("impact")
    .description("Impact radius: reverse BFS with container drill-down")
    .argument("<nodeId|name>", "node id (16-char hex) or symbol name")
    .argument("[path]", "repository path", ".")
    .option("-d, --depth <n>", "traversal depth", "3")
    .action(
      async (nodeArg: string, repoPath: string, opts: { depth: string }) => {
        const absRepo = path.resolve(repoPath);
        const depth = Number(opts.depth) || 3;
        const engine = await Engine.open(absRepo);

        try {
          const nodeId = await engine.resolveNodeId(nodeArg);
          const start = Date.now();
          const res = await engine.impactGraph(nodeId, depth);
          const durationMs = Date.now() - start;

          for (let d = 0; d < res.byDepth.length; d++) {
            console.log(`--- depth ${d} ---`);
            for (const n of res.byDepth[d]!) console.log(formatNode(n));
          }

          if (res.truncated) {
            console.error(
              "[cv impact] result truncated at 50 nodes/layer (container drill-down cap). Use a smaller depth for full results.",
            );
          }

          console.error(
            `[cv impact] ${res.nodes.length} nodes in ${durationMs}ms (depth ${depth})`,
          );
        } catch (err: unknown) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        } finally {
          await engine.close();
        }
      },
    );
}
