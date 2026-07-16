import path from "node:path";
import type { Command } from "commander";
import { startServer } from "@codingverse/dashboard";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the Dashboard HTTP server (observation mode, board ①-⑥)")
    .argument("[path]", "repository path", ".")
    .option("-p, --port <n>", "listen port", "7331")
    .option("--host <host>", "listen host (default localhost-only)", "127.0.0.1")
    .action(async (repoPath: string, opts: { port: string; host: string }) => {
      const absRepo = path.resolve(repoPath);
      const port = Number(opts.port) || 7331;

      const { close } = await startServer({
        repoPath: absRepo,
        port,
        host: opts.host,
      });

      // Keep the process alive until Ctrl-C, then shut down cleanly.
      const shutdown = (): void => {
        void close().then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
