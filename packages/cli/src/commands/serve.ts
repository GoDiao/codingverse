import path from "node:path";
import type { Command } from "commander";
import { Engine, watchRepo } from "@codingverse/core";
import { startServer } from "@codingverse/dashboard";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the Dashboard HTTP server (observation mode, board ①-⑥)")
    .argument("[path]", "repository path", ".")
    .option("-p, --port <n>", "listen port", "7331")
    .option("--host <host>", "listen host (default localhost-only)", "127.0.0.1")
    .option("--watch", "continuously re-index on file changes (keeps boards live)")
    .action(
      async (repoPath: string, opts: { port: string; host: string; watch?: boolean }) => {
        const absRepo = path.resolve(repoPath);
        const port = Number(opts.port) || 7331;

        const { close } = await startServer({
          repoPath: absRepo,
          port,
          host: opts.host,
        });

        // V3-4: --watch keeps the index (and thus every board) hot while the
        // server runs. Uses its own Engine so it doesn't share the server's
        // read handle.
        let stopWatch: (() => void) | undefined;
        if (opts.watch) {
          const watchEngine = await Engine.open(absRepo);
          await watchEngine.index();
          await watchEngine.rank();
          const handle = watchRepo(watchEngine, {
            onReindex: ({ changedPaths, durationMs }) =>
              console.error(
                `[cv serve] re-indexed ${changedPaths.length} change(s) in ${durationMs}ms`,
              ),
            onError: (err) =>
              console.error(
                `[cv serve] re-index error: ${err instanceof Error ? err.message : String(err)}`,
              ),
          });
          stopWatch = () => {
            handle.close();
            void watchEngine.close();
          };
          console.error(`[cv serve] watch mode on — re-indexing on change`);
        }

        // Keep the process alive until Ctrl-C, then shut down cleanly.
        const shutdown = (): void => {
          stopWatch?.();
          void close().then(() => process.exit(0));
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      },
    );
}
