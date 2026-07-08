import type { Command } from "commander";

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Hybrid search over the index (vector + BM25 + graph)")
    .argument("<query>", "natural language or symbol query")
    .option("-k, --top-k <n>", "number of hits to return", "20")
    .action((query: string) => {
      console.error(`[cv search] not implemented yet (v1). query=${query}`);
      process.exitCode = 1;
    });
}
