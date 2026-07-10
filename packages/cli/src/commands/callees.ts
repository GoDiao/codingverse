import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";
import { formatNode } from "./format.js";

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
        // depth 0 = the start node only (see callers.ts for the rationale).
        const depth =
          opts.depth === undefined ? 1 : Math.max(0, Number(opts.depth));
        const engine = await Engine.open(absRepo);

        try {
          const nodeId = await engine.resolveNodeId(nodeArg);
          const start = Date.now();
          const res = await engine.calleesGraph(nodeId, depth);
          const durationMs = Date.now() - start;

          for (let d = 0; d < res.byDepth.length; d++) {
            console.log(`--- depth ${d} ---`);
            for (const n of res.byDepth[d]!) console.log(formatNode(n));
          }

          console.error(
            `[cv callees] ${res.nodes.length} nodes in ${durationMs}ms (depth ${depth})`,
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
