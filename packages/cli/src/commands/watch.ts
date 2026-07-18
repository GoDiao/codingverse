import path from "node:path";
import type { Command } from "commander";
import { Engine, watchRepo } from "@codingverse/core";

export function registerWatch(program: Command): void {
  program
    .command("watch")
    .description("Continuously re-index on file changes (keeps the index hot)")
    .argument("[path]", "repository path", ".")
    .option("--debounce <ms>", "debounce window for coalescing changes", "300")
    .option("--no-rank", "skip PageRank after each re-index (faster)")
    .action(
      async (
        repoPath: string,
        opts: { debounce: string; rank: boolean },
      ) => {
        const absRepo = path.resolve(repoPath);
        const engine = await Engine.open(absRepo);

        // Initial index so the watcher starts from a fresh baseline.
        const first = await engine.index();
        if (opts.rank) await engine.rank();
        console.error(
          `[cv watch] initial index: ${first.filesProcessed} files, ` +
            `${first.symbols} symbols, ${first.edges} edges in ${first.durationMs}ms`,
        );
        console.error(`[cv watch] watching ${absRepo} — Ctrl-C to stop`);

        const handle = watchRepo(engine, {
          debounceMs: Number(opts.debounce) || 300,
          rank: opts.rank,
          onReindex: ({ changedPaths, durationMs }) => {
            const preview = changedPaths.slice(0, 3).join(", ");
            const more = changedPaths.length > 3 ? ` +${changedPaths.length - 3}` : "";
            console.error(
              `[cv watch] re-indexed ${changedPaths.length} change(s) in ${durationMs}ms` +
                (preview ? ` — ${preview}${more}` : ""),
            );
          },
          onError: (err) => {
            console.error(
              `[cv watch] re-index error: ${err instanceof Error ? err.message : String(err)}`,
            );
          },
        });

        const shutdown = (): void => {
          handle.close();
          void engine.close().then(() => process.exit(0));
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      },
    );
}
