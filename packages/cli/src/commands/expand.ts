import path from "node:path";
import type { Command } from "commander";
import { Engine } from "@codingverse/core";

/**
 * `cv expand` — resolve a skeleton symbol id (cv:<id>) back to its full
 * source text, or list all expandable ids from the last pack.
 *
 *   cv expand --list [path]          list expandable ids from last pack
 *   cv expand <id> [path]            print the full body of a symbol
 *   cv expand <id> [path] --meta     show metadata (path/name/lines) only
 *
 * The id may be given with or without the `cv:` prefix.
 *
 * Note: commander fills the first positional slot regardless of --list, so
 * when --list is set the first positional arg is actually the repo path.
 */
export function registerExpand(program: Command): void {
  program
    .command("expand")
    .description("Expand a skeleton symbol by id, or list expandable ids")
    .argument("[id]", "skeleton symbol id (cv:<id>)")
    .argument("[path]", "repository path", ".")
    .option("--list", "list all expandable ids from the last pack")
    .option("--meta", "show symbol metadata instead of body")
    .action(
      async (
        id: string | undefined,
        repoPath: string,
        opts: { list?: boolean; meta?: boolean },
      ) => {
        // When --list is set, the first positional arg is the repo path
        // (not a symbol id), and the second positional is unused.
        const resolvedRepo = opts.list ? (id ?? repoPath) : repoPath;
        const symbolId = opts.list ? undefined : id;
        const absRepo = path.resolve(resolvedRepo);
        const engine = await Engine.open(absRepo);

        try {
          if (opts.list) {
            const snap = await engine.listExpandable();
            if (!snap || Object.keys(snap.entries).length === 0) {
              console.error(
                "[cv expand] no expandable symbols. Run `cv pack` with a token budget first.",
              );
              process.exitCode = 1;
              return;
            }
            const { entries, meta } = snap;
            console.error(
              `[cv expand] ${meta.expandableCount} expandable symbols ` +
                `(from pack: budget ${meta.budget}, strategy ${meta.strategy}, ` +
                `${meta.fileCount} files, ${meta.tokenCount} tokens)`,
            );
            for (const [sid, entry] of Object.entries(entries)) {
              console.log(
                `${sid}  ${entry.path}  ${entry.name}  (L${entry.startLine}-${entry.endLine})`,
              );
            }
            return;
          }

          if (!symbolId) {
            console.error(
              "[cv expand] id required (or use --list). See `cv expand --help`.",
            );
            process.exitCode = 1;
            return;
          }

          const cleanId = symbolId.startsWith("cv:") ? symbolId.slice(3) : symbolId;

          if (opts.meta) {
            const entry = await engine.expandEntry(cleanId);
            console.log(`id:     ${entry.id}`);
            console.log(`path:   ${entry.path}`);
            console.log(`name:   ${entry.name}`);
            console.log(`lines:  L${entry.startLine}-L${entry.endLine}`);
            console.log(
              `bytes:  ${entry.startByte}-${entry.endByte} (${entry.endByte - entry.startByte} bytes)`,
            );
            return;
          }

          const body = await engine.expand(cleanId);
          console.log(body);
        } catch (err: unknown) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        } finally {
          await engine.close();
        }
      },
    );
}
