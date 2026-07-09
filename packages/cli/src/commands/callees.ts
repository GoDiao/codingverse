import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";
import type { SymbolNode } from "@codingverse/shared";

function formatNode(n: SymbolNode): string {
  const name = n.qualifiedName ?? n.name;
  const pr = n.pagerank && n.pagerank > 0 ? `  [pagerank=${n.pagerank.toFixed(4)}]` : "";
  return `${n.filePath}:${n.startLine}-${n.endLine}  ${n.kind}  ${name}${pr}`;
}

export function registerCallees(program: Command): void {
  program
    .command("callees")
    .description("What this node calls (forward BFS along call edges)")
    .argument("<nodeId|name>", "node id (16-char hex) or symbol name")
    .argument("[path]", "repository path", ".")
    .option("-d, --depth <n>", "traversal depth", "1")
    .action(
      async (nodeArg: string, repoPath: string, opts: { depth: string }) => {
        const absRepo = path.resolve(repoPath);
        const depth = Number(opts.depth) || 1;
        const engine = await Engine.open(absRepo);

        try {
          const nodeId = await engine.resolveNodeId(nodeArg);
          const start = Date.now();
          const nodes = await engine.callees(nodeId, depth);
          const durationMs = Date.now() - start;

          for (const n of nodes) console.log(formatNode(n));

          console.error(
            `[cv callees] ${nodes.length} nodes in ${durationMs}ms (depth ${depth})`,
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
