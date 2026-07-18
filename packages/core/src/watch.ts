// V3-4: continuous indexing. Watches a repo tree and re-indexes on change so
// `cv serve` / MCP stay hot without a manual `cv index`.
//
// Design: node:fs recursive watch (zero deps) → debounce a burst of change
// events → run a single re-index. The parse cache (git-blob-hash) makes a full
// index() cheap when only a few files changed — unchanged files are skipped at
// parse time — so we don't need per-file incremental writes here (that's a
// v1.5 store refinement). We DO re-run rank() after each index because a full
// index() resets pagerank to 0.
//
// Events for paths inside the state dir (.codingverse/), .git/, and
// node_modules are ignored so our own index writes don't trigger a loop.

import { watch as fsWatch, type FSWatcher } from "node:fs";
import nodePath from "node:path";
import { STATE_DIR } from "@codingverse/shared";
import type { Engine } from "./Engine.js";

export interface WatchOptions {
  /** Debounce window in ms for coalescing a burst of change events. Default 300. */
  debounceMs?: number;
  /** Re-run PageRank after each re-index (index() resets it). Default true. */
  rank?: boolean;
  /** Called after each successful re-index cycle. */
  onReindex?: (info: { changedPaths: string[]; durationMs: number }) => void;
  /** Called when a re-index cycle throws. */
  onError?: (err: unknown) => void;
}

export interface WatchHandle {
  /** Stop watching and release the FS watcher. Idempotent. */
  close: () => void;
}

const IGNORED_SEGMENTS = new Set([".git", "node_modules"]);

function isIgnoredPath(rel: string): boolean {
  if (!rel) return false;
  const norm = rel.replace(/\\/g, "/");
  if (norm === STATE_DIR || norm.startsWith(`${STATE_DIR}/`)) return true;
  for (const seg of norm.split("/")) {
    if (IGNORED_SEGMENTS.has(seg)) return true;
  }
  return false;
}

/**
 * Start watching `engine`'s repo. Returns a handle with close(). Re-indexes
 * (debounced) whenever a non-ignored file changes. The initial index is NOT
 * run here — callers that need a fresh index should call engine.index() first.
 */
export function watchRepo(engine: Engine, opts: WatchOptions = {}): WatchHandle {
  const debounceMs = opts.debounceMs ?? 300;
  const doRank = opts.rank !== false;
  const repoPath = engine.repoPathAbs;

  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let rerunQueued = false;
  let closed = false;

  const runReindex = async (): Promise<void> => {
    if (closed) return;
    if (running) {
      rerunQueued = true;
      return;
    }
    running = true;
    const changedPaths = [...pending];
    pending = new Set();
    const start = Date.now();
    try {
      await engine.index();
      if (doRank) await engine.rank();
      opts.onReindex?.({ changedPaths, durationMs: Date.now() - start });
    } catch (err) {
      opts.onError?.(err);
    } finally {
      running = false;
      // A change that arrived mid-reindex → run once more to catch it.
      if (rerunQueued && !closed) {
        rerunQueued = false;
        scheduleReindex();
      }
    }
  };

  const scheduleReindex = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runReindex();
    }, debounceMs);
  };

  let watcher: FSWatcher;
  try {
    watcher = fsWatch(repoPath, { recursive: true }, (_event, filename) => {
      if (closed || filename === null) return;
      const rel = String(filename);
      if (isIgnoredPath(rel)) return;
      pending.add(nodePath.normalize(rel).replace(/\\/g, "/"));
      scheduleReindex();
    });
  } catch (err) {
    // Recursive watch is unsupported on some platforms/filesystems.
    opts.onError?.(err);
    return { close: () => {} };
  }

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
