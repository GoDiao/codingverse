import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { STATE_DIR, type ParsedFile, type ParseCacheEntry } from "@codingverse/shared";

/**
 * Cross-cutting B — incremental parse cache.
 *
 * Cache key = git blob hash of the file content: sha1("blob <len>\0<content>").
 * This is a pure function of content (identical to `git hash-object`), so a
 * file whose content is unchanged keeps the same key and its parse result is
 * reused — no git binary required, works on any directory.
 *
 * Ported in spirit from Tabby's SourceFileId (git blob oid as incremental key),
 * but computed in-process from the already-read content.
 */

const CACHE_VERSION = 2;
const CACHE_FILE_NAME = "parse-cache.json";

/** Compute the git blob hash for a piece of content (matches `git hash-object`). */
export const gitBlobHash = (content: string): string => {
  const bytes = Buffer.from(content, "utf8");
  const header = `blob ${bytes.length}\0`;
  return createHash("sha1").update(header).update(bytes).digest("hex");
};

interface CacheData {
  version: number;
  // path → { blobHash, parsed }
  entries: Record<string, ParseCacheEntry>;
}

/**
 * Persistent parse cache keyed by path, validated by content blob hash.
 * A path hits only when its stored blobHash matches the current content.
 */
export class ParseCache {
  private entries = new Map<string, ParseCacheEntry>();
  private dirty = false;
  private loaded = false;
  private readonly filePath: string;

  constructor(repoRoot: string) {
    this.filePath = path.join(repoRoot, STATE_DIR, CACHE_FILE_NAME);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as CacheData;
      if (data?.version !== CACHE_VERSION || !data.entries) return;
      for (const p in data.entries) {
        const e = data.entries[p];
        if (e && typeof e.blobHash === "string" && e.parsed) {
          this.entries.set(p, e);
        }
      }
    } catch {
      // fresh start
    }
  }

  /**
   * Look up a cached parse for `path` whose blobHash matches `content`.
   * Returns undefined on miss (new file, changed content, or not cached).
   */
  get(filePath: string, content: string): ParsedFile | undefined {
    const entry = this.entries.get(filePath);
    if (!entry) return undefined;
    if (entry.blobHash !== gitBlobHash(content)) return undefined;
    return entry.parsed;
  }

  /** Store a fresh parse result for `path`. */
  set(filePath: string, content: string, parsed: ParsedFile): void {
    this.entries.set(filePath, { blobHash: gitBlobHash(content), parsed });
    this.dirty = true;
  }

  /**
   * Drop cache entries for paths no longer present (garbage collection).
   * @param livePaths the set of paths that currently exist.
   */
  prune(livePaths: Set<string>): void {
    for (const p of [...this.entries.keys()]) {
      if (!livePaths.has(p)) {
        this.entries.delete(p);
        this.dirty = true;
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /** Persist to disk via atomic tmp+rename. No-op if unchanged. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const data: CacheData = {
        version: CACHE_VERSION,
        entries: Object.fromEntries(this.entries),
      };
      const tmp = `${this.filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await fs.rename(tmp, this.filePath);
      this.dirty = false;
    } catch {
      // degrade silently — cache is an optimization, not correctness
    }
  }
}
