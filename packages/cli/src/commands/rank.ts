import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";

export function registerRank(program: Command): void {
  program
    .command("rank")
    .description("Compute PageRank over the call graph, write back to nodes.pagerank")
    .argument("[path]", "repository path", ".")
    .option("--damping <n>", "PageRank damping factor (default 0.85)", "0.85")
    .option("--max-iter <n>", "max power-iteration steps (default 100)", "100")
    .action(
      async (repoPath: string, opts: { damping: string; maxIter: string }) => {
        const absRepo = path.resolve(repoPath);
        const damping = Number(opts.damping);
        const maxIter = Number(opts.maxIter);
        const engine = await Engine.open(absRepo);

        try {
          const stats = await engine.rank({
            damping: Number.isFinite(damping) ? damping : undefined,
            maxIter: Number.isFinite(maxIter) ? maxIter : undefined,
          });

          if (stats.nodeCount === 0) {
            console.error("[cv rank] 0 nodes, nothing to rank");
            return;
          }

          const top = await engine.topRankedNodes(20);
          for (const r of top) {
            const name = r.qualifiedName ?? r.name;
            console.log(
              `${r.pagerank.toFixed(6)}  ${r.filePath}:${r.startLine}  ${name}`,
            );
          }

          const convergedTxt = stats.converged
            ? `converged in ${stats.iterations} iters`
            : `did not converge (stopped at ${stats.iterations} iters)`;
          console.error(
            `[cv rank] ${stats.nodeCount} nodes, ${stats.edgeCount} edges, ` +
              `${convergedTxt} / ${stats.durationMs}ms`,
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
