#!/usr/bin/env node
import { startServer } from "./server.js";

const port = process.env.CV_PORT ? Number(process.env.CV_PORT) : 7331;

startServer({ repoPath: ".", port }).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
