import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Hybrid search over the index (BM25 + co-location graph, fused via RRF)")
    .argument("<query>", "natural language or symbol query")
    .argument("[path]", "repository path", ".")
    .option("-k, --top-k <n>", "number of hits to return", "20")
    .option("--json", "output full results as JSON (machine-readable)")
    .action(
      async (
        query: string,
        repoPath: string,
        opts: { topK: string; json?: boolean },
      ) => {
        const absRepo = path.resolve(repoPath);
        const topK = Number(opts.topK) || 20;
        const engine = await Engine.open(absRepo);

        try {
          const start = Date.now();
          const hits = await engine.search(query, { topK });
          const durationMs = Date.now() - start;

          if (hits.length === 0) {
            console.error(
              "[cv search] no results. Run `cv index` first to build the index, or refine your query.",
            );
            process.exitCode = 1;
            return;
          }

          if (opts.json) {
            console.log(JSON.stringify(hits, null, 2));
          } else {
            for (const hit of hits) {
              const { rrf, bm25, graph } = hit.scores;
              console.log(
                `${hit.filePath}:${hit.startLine}-${hit.endLine}  ` +
                  `rrf=${rrf.toFixed(4)}  bm25=${bm25.toFixed(4)}  graph=${graph}`,
              );
              const bodyLines = hit.body.split("\n").slice(0, 3);
              for (const line of bodyLines) {
                console.log(`  ${line}`);
              }
              console.log();
            }
          }

          console.error(
            `[cv search] ${hits.length} hits in ${durationMs}ms (bm25+graph RRF, k=60)`,
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