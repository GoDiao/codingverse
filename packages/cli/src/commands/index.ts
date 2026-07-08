import type { Command } from "commander";

export function registerIndex(program: Command): void {
  program
    .command("index")
    .description("Build or update the code index (SQLite)")
    .argument("[path]", "repository path", ".")
    .option("--force", "full re-index (ignore incremental cache)")
    .action((path: string) => {
      console.error(`[cv index] not implemented yet (v1). repo=${path}`);
      process.exitCode = 1;
    });
}
