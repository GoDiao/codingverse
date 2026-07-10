import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";

export function registerIndex(program: Command): void {
  program
    .command("index")
    .description("Build or refresh the SQLite index (symbols, edges, chunks)")
    .argument("[path]", "repository path", ".")
    .option(
      "--scip <path>",
      "path to a .scip index file to import (replaces heuristic edges for covered files)",
    )
    .action(async (repoPath: string, opts: { scip?: string }) => {
      const absRepo = path.resolve(repoPath);
      const engine = await Engine.open(absRepo);
      try {
        const stats = await engine.index();
        console.error(
          `[cv index] ${stats.filesProcessed} files ` +
            `(${stats.filesSkipped} cached, ${stats.filesProcessed - stats.filesSkipped} parsed), ` +
            `${stats.symbols} symbols, ${stats.edges} edges, ${stats.chunks} chunks in ${stats.durationMs}ms`,
        );

        if (opts.scip) {
          const scipPath = path.resolve(opts.scip);
          const scipStats = await engine.importScip({
            scipPath,
          });
          console.error(
            `[cv index --scip] ${scipStats.documents} documents, ` +
              `${scipStats.occurrences} occurrences, ${scipStats.relationships} relationships, ` +
              `${scipStats.edgesInserted} scip edges inserted ` +
              `(${scipStats.edgesReplaced} heuristic edges replaced)`,
          );
        }
      } finally {
        await engine.close();
      }
    });
}
