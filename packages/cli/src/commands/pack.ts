import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";

export function registerPack(program: Command): void {
  program
    .command("pack")
    .description("Pack a repository into a layered LLM context file")
    .argument("[path]", "repository path", ".")
    .option("-o, --output <file>", "output file (default: stdout)")
    .option("-f, --format <format>", "output format: xml | markdown | json", "xml")
    .option("-b, --budget <tokens>", "token budget", String(128_000))
    .option("--list", "list ingested files only (M1 preview)")
    .action(async (repoPath: string, opts: { list?: boolean }) => {
      const absRepo = path.resolve(repoPath);
      const engine = await Engine.open(absRepo);
      const { files, skipped } = await engine.ingest();

      // M1 preview: list files. Full layered pack lands in M4/M5.
      if (opts.list) {
        for (const f of files) console.log(f.path);
        console.error(
          `\n[cv pack] ingested ${files.length} files, skipped ${skipped.length}`,
        );
        await engine.close();
        return;
      }

      console.error(
        `[cv pack] ingested ${files.length} files, skipped ${skipped.length}. ` +
          `Layered pack output not implemented yet (M4/M5). Use --list to preview files.`,
      );
      await engine.close();
      process.exitCode = 1;
    });
}
