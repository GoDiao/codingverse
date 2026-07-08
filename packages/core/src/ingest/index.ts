// Stage ① Ingest: file discovery, ignore filtering, decode, validity filtering.
// Orchestrates walker → reader → validate with bounded concurrency.

import path from "node:path";
import {
  MAX_FILE_SIZE,
  type IngestConfig,
  type IngestResult,
  type FileEntry,
  type SkippedFile,
} from "@codingverse/shared";
import { walk } from "./walker.js";
import { readRawFile } from "./reader.js";
import { isValidFile } from "./validate.js";

export { walk, buildIgnorePatterns, parseIgnoreContent } from "./walker.js";
export { readRawFile } from "./reader.js";
export { isValidFile, computeMetrics } from "./validate.js";
export type { FileReadResult } from "./reader.js";
export type { FileMetrics } from "./validate.js";

/** Run tasks with a bounded concurrency pool. Preserves input order in output. */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Ingest a repository: discover → read/decode → validate.
 * Returns valid text files plus a list of skipped files with reasons.
 */
export const ingest = async (
  rootDir: string,
  config: IngestConfig = {},
): Promise<IngestResult> => {
  const maxFileSize = config.maxFileSize ?? MAX_FILE_SIZE;
  const concurrency = config.concurrency ?? 64;
  const doValidate = config.validate !== false;

  const relPaths = await walk(rootDir, config);

  const files: FileEntry[] = [];
  const skipped: SkippedFile[] = [];

  await mapWithConcurrency(relPaths, concurrency, async (relPath) => {
    const absPath = path.join(rootDir, relPath);
    const { content, size, skippedReason } = await readRawFile(absPath, maxFileSize);

    if (content === null) {
      skipped.push({ path: relPath, reason: skippedReason ?? "encoding-error" });
      return;
    }

    if (doValidate && !isValidFile(content, relPath)) {
      skipped.push({ path: relPath, reason: "invalid-file" });
      return;
    }

    files.push({ path: relPath, absPath, content, size });
  });

  // mapWithConcurrency preserves task order, but pushes race across workers;
  // sort deterministically by path for stable output.
  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));

  return { files, skipped };
};
