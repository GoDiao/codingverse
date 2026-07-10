import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";
import { formatNode } from "./format.js";

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
        const engine = await Engine.open(absRepo);

        try {
          const damping = Number(opts.damping);
          const maxIter = Number(opts.maxIter);
          // Surface invalid --damping / --max-iter on stderr instead of
          // silently falling back — keeps `cv rank --damping abc` debuggable.
          const dampingFinite = Number.isFinite(damping);
          const maxIterFinite = Number.isFinite(maxIter);
          if (opts.damping !== undefined && !dampingFinite) {
            console.error(
              `[cv rank] warning: invalid --damping "${opts.damping}", using default 0.85`,
            );
          }
          if (opts.maxIter !== undefined && !maxIterFinite) {
            console.error(
              `[cv rank] warning: invalid --max-iter "${opts.maxIter}", using default 100`,
            );
          }

          const stats = await engine.rank({
            damping: dampingFinite ? damping : undefined,
            maxIter: maxIterFinite ? maxIter : undefined,
          });

          if (stats.nodeCount === 0) {
            console.error("[cv rank] 0 nodes, nothing to rank");
            return;
          }

          const top = await engine.topRankedNodes(20);
          // rank's rows always have pagerank > 0 after engine.rank(), so
          // formatNode's pagerank>0 gate surfaces the score on every line
          // (matching callers/callees/impact's line shape per B5/C2).
          for (const r of top) {
            console.log(formatNode(r));
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