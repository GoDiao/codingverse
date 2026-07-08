import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TokenEncoding } from "./tokenizer.js";

/**
 * Cross-cutting A — content-addressed token-count cache.
 * Ported (leaner) from Repomix tokenCountCache:
 * - key = `${encoding}:${byteLength}:${md5_16}` (collision-tolerant, compact)
 * - FIFO eviction at MAX_CACHE_ENTRIES
 * - atomic write (tmp + rename) so concurrent saves / interrupts can't tear the file
 * - per-repo location: `<stateDir>/token-cache.json`
 */

const CACHE_VERSION = 1;
export const MAX_CACHE_ENTRIES = 100_000;
const CACHE_FILE_NAME = "token-cache.json";

interface CacheData {
  version: number;
  entries: Record<string, number>;
}

/** Build a content cache key under a specific encoding. */
export const contentCacheKey = (encoding: TokenEncoding, content: string): string => {
  const byteLength = Buffer.byteLength(content);
  const digest = createHash("md5").update(content).digest("hex").slice(0, 16);
  return `${encoding}:${byteLength}:${digest}`;
};

/**
 * A persistent token-count cache scoped to one repo's state directory.
 * Load once, mutate in memory, save at the end.
 */
export class TokenCache {
  private entries = new Map<string, number>();
  private dirty = false;
  private loaded = false;
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, CACHE_FILE_NAME);
  }

  /** Load cache from disk. Corrupt/missing/version-mismatch → empty (silent). */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as CacheData;
      if (data?.version !== CACHE_VERSION || !data.entries) return;
      for (const key in data.entries) {
        const v = data.entries[key];
        if (typeof v === "number") this.entries.set(key, v);
      }
    } catch {
      // fresh start
    }
  }

  get(key: string): number | undefined {
    return this.entries.get(key);
  }

  set(key: string, tokenCount: number): void {
    // FIFO eviction when inserting a new key over the cap.
    if (!this.entries.has(key) && this.entries.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, tokenCount);
    this.dirty = true;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Persist to disk via atomic tmp+rename. No-op if unchanged. */
  async save(): Promise<void> {
    if (!this.dirty || this.entries.size === 0) return;
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
