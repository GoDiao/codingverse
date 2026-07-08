import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";
import type { Layer, OutputFormat } from "@codingverse/shared";

export function registerPack(program: Command): void {
  program
    .command("pack")
    .description("Pack a repository into a layered LLM context file")
    .argument("[path]", "repository path", ".")
    .option("-o, --output <file>", "output file (default: stdout)")
    .option("-f, --format <format>", "output format: xml | markdown | json", "xml")
    .option("-b, --budget <tokens>", "token budget", String(128_000))
    .option(
      "-s, --strategy <strategy>",
      "layer strategy: auto | full | skeleton | outline",
      "auto",
    )
    .option("--always-full <globs>", "comma-separated globs to keep at full", "")
    .option("--list", "list ingested files only (M1 preview)")
    .option("--symbols", "list extracted symbols per file (M2 preview)")
    .action(
      async (
        repoPath: string,
        opts: {
          output?: string;
          format: OutputFormat;
          budget: string;
          strategy: "auto" | "full" | "skeleton" | "outline";
          alwaysFull: string;
          list?: boolean;
          symbols?: boolean;
        },
      ) => {
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
              console.log(
                `  ${s.kind.padEnd(10)} ${scope}${s.name}  (L${s.startLine}-${s.endLine})`,
              );
            }
          }
          console.error(
            `\n[cv pack] parsed ${parsed.length} files: ${symCount} symbols, ` +
              `${chunkCount} chunks, ${degraded} degraded`,
          );
          await engine.close();
          return;
        }

        // M4: layered pack.
        const alwaysFull = opts.alwaysFull
          ? opts.alwaysFull.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
        const result = await engine.pack({
          tokenBudget: Number(opts.budget),
          layerStrategy: opts.strategy,
          format: opts.format,
          alwaysFull,
        });

        if (opts.output) {
          await writeFile(opts.output, result.content, "utf8");
        } else {
          console.log(result.content);
        }

        // Layer summary → stderr (keeps stdout clean for piping).
        const counts: Record<Layer, number> = { full: 0, skeleton: 0, outline: 0, omit: 0 };
        for (const f of result.files) counts[f.layer]++;
        const cs = engine.getCacheStats();
        console.error(
          `\n[cv pack] ${result.fileCount} files packed, ${result.tokenCount} tokens ` +
            `(budget ${opts.budget}) — ` +
            `F:${counts.full} S:${counts.skeleton} O:${counts.outline} -:${counts.omit}` +
            (Object.keys(result.expandMap).length
              ? `, ${Object.keys(result.expandMap).length} expandable symbols`
              : "") +
            `\n[cv pack] parse cache: ${cs.hits} hits, ${cs.misses} misses / ${cs.total}`,
        );
        await engine.close();
      },
    );
}
