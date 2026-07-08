import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";

export function registerIndex(program: Command): void {
  program
    .command("index")
    .description("Build or refresh the incremental parse cache")
    .argument("[path]", "repository path", ".")
    .action(async (repoPath: string) => {
      const absRepo = path.resolve(repoPath);
      const engine = await Engine.open(absRepo);
      const stats = await engine.sync();
      console.error(
        `[cv index] ${stats.filesProcessed} files ` +
          `(${stats.filesSkipped} cached, ${stats.filesProcessed - stats.filesSkipped} parsed), ` +
          `${stats.symbols} symbols, ${stats.chunks} chunks in ${stats.durationMs}ms`,
      );
      await engine.close();
    });
}
