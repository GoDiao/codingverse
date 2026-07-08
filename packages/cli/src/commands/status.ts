import type { Command } from "commander";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show index status and observation state")
    .argument("[path]", "repository path", ".")
    .option("--token-map", "print token treemap (Dashboard board ② CLI form)")
    .action((path: string) => {
      console.error(`[cv status] not implemented yet (M7). repo=${path}`);
      process.exitCode = 1;
    });
}
