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
    .option("--symbols", "list extracted symbols per file (M2 preview)")
    .action(async (repoPath: string, opts: { list?: boolean; symbols?: boolean }) => {
      const absRepo = path.resolve(repoPath);
      const engine = await Engine.open(absRepo);

      // M1 preview: list files.
      if (opts.list) {
        const { files, skipped } = await engine.ingest();
        for (const f of files) console.log(f.path);
        console.error(
          `\n[cv pack] ingested ${files.length} files, skipped ${skipped.length}`,
        );
        await engine.close();
        return;
      }

      // M2 preview: parse and list symbols.
      if (opts.symbols) {
        const parsed = await engine.parse();
        let symCount = 0;
        let chunkCount = 0;
        let degraded = 0;
        for (const p of parsed) {
          if (p.degraded) degraded++;
          chunkCount += p.chunks.length;
          if (p.symbols.length === 0) continue;
          symCount += p.symbols.length;
          console.log(`\n${p.path} [${p.language}]`);
          for (const s of p.symbols) {
            const scope = s.scope.length ? `${s.scope.join("::")}::` : "";
            console.log(`  ${s.kind.padEnd(10)} ${scope}${s.name}  (L${s.startLine}-${s.endLine})`);
          }
        }
        console.error(
          `\n[cv pack] parsed ${parsed.length} files: ${symCount} symbols, ` +
            `${chunkCount} chunks, ${degraded} degraded`,
        );
        await engine.close();
        return;
      }

      const { files, skipped } = await engine.ingest();

      console.error(
        `[cv pack] ingested ${files.length} files, skipped ${skipped.length}. ` +
          `Layered pack output not implemented yet (M4/M5). Use --list to preview files.`,
      );
      await engine.close();
      process.exitCode = 1;
    });
}
