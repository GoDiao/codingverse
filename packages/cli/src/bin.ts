#!/usr/bin/env node
import { Command } from "commander";
import { registerPack } from "./commands/pack.js";
import { registerIndex } from "./commands/index.js";
import { registerExpand } from "./commands/expand.js";
import { registerSearch } from "./commands/search.js";
import { registerStatus } from "./commands/status.js";
import { registerCallers } from "./commands/callers.js";
import { registerCallees } from "./commands/callees.js";
import { registerImpact } from "./commands/impact.js";
import { registerRank } from "./commands/rank.js";

const program = new Command();

program
  .name("cv")
  .description(
    "codingverse — unified Code RAG toolkit: index once, three-mode output (pack / search / observe)"
  )
  .version("0.0.0");

registerPack(program);
registerIndex(program);
registerExpand(program);
registerSearch(program);
registerStatus(program);
registerCallers(program);
registerCallees(program);
registerImpact(program);
registerRank(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
