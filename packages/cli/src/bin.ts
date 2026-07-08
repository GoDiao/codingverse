#!/usr/bin/env node
import { Command } from "commander";
import { registerPack } from "./commands/pack.js";
import { registerIndex } from "./commands/index.js";
import { registerExpand } from "./commands/expand.js";
import { registerSearch } from "./commands/search.js";
import { registerStatus } from "./commands/status.js";

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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
