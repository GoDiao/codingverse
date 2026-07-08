import type { Command } from "commander";

export function registerPack(program: Command): void {
  program
    .command("pack")
    .description("Pack a repository into a layered LLM context file")
    .argument("[path]", "repository path", ".")
    .option("-o, --output <file>", "output file (default: stdout)")
    .option("-f, --format <format>", "output format: xml | markdown | json", "xml")
    .option("-b, --budget <tokens>", "token budget", String(128_000))
    .action((path: string) => {
      console.error(`[cv pack] not implemented yet (M4/M5). repo=${path}`);
      process.exitCode = 1;
    });
}
