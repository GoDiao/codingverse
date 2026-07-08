// Cross-cutting A · Token budget: tokenizer wrapper + content-addressed cache.

import path from "node:path";
import { STATE_DIR, type Chunk, type TreemapNode } from "@codingverse/shared";
import { Tokenizer, type TokenEncoding } from "./tokenizer.js";
import { TokenCache, contentCacheKey } from "./cache.js";

export { Tokenizer, type TokenEncoding } from "./tokenizer.js";
export { TokenCache, contentCacheKey, MAX_CACHE_ENTRIES } from "./cache.js";

export interface TokenBudgetOptions {
  encoding?: TokenEncoding;
  /** Repo root; cache lives at `<repoRoot>/.codingverse/token-cache.json`. */
  repoRoot?: string;
  /** Disable persistent cache (in-memory only). */
  noCache?: boolean;
}

export interface FileTokenCount {
  path: string;
  tokens: number;
}

/**
 * TokenBudget — counts tokens with a content-addressed persistent cache.
 * Instantiate once per run, call init(), count freely, then flush().
 */
export class TokenBudget {
  private readonly tokenizer: Tokenizer;
  private readonly cache: TokenCache | null;
  private ready = false;

  constructor(opts: TokenBudgetOptions = {}) {
    this.tokenizer = new Tokenizer(opts.encoding);
    this.cache =
      opts.noCache || !opts.repoRoot
        ? null
        : new TokenCache(path.join(opts.repoRoot, STATE_DIR));
  }

  async init(): Promise<void> {
    if (this.ready) return;
    await Promise.all([this.tokenizer.init(), this.cache?.load()]);
    this.ready = true;
  }

  /** Count tokens for a string, using the cache when available. */
  count(content: string): number {
    if (!this.ready) throw new Error("TokenBudget not initialized. Call init() first.");
    if (content.length === 0) return 0;

    if (!this.cache) return this.tokenizer.count(content);

    const key = contentCacheKey(this.tokenizer.encoding, content);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const tokens = this.tokenizer.count(content);
    this.cache.set(key, tokens);
    return tokens;
  }

  /** Count and annotate a chunk's tokenCount in place; returns the count. */
  countChunk(chunk: Chunk): number {
    const tokens = this.count(chunk.body);
    chunk.tokenCount = tokens;
    return tokens;
  }

  /** Aggregate tokens per file from a set of chunks. */
  countFiles(chunksByFile: Map<string, Chunk[]>): FileTokenCount[] {
    const out: FileTokenCount[] = [];
    for (const [filePath, chunks] of chunksByFile) {
      let tokens = 0;
      for (const c of chunks) tokens += this.countChunk(c);
      out.push({ path: filePath, tokens });
    }
    out.sort((a, b) => b.tokens - a.tokens);
    return out;
  }

  /** Persist the cache to disk. */
  async flush(): Promise<void> {
    await this.cache?.save();
  }

  get cacheSize(): number {
    return this.cache?.size ?? 0;
  }
}

/**
 * Build a directory treemap of token counts (Dashboard board ②).
 * Nests file token counts by path segments; parent tokens = sum of children.
 */
export const buildTokenTreemap = (files: FileTokenCount[]): TreemapNode => {
  const root: TreemapNode = { name: "", path: "", tokens: 0, children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        (node.children ??= []).push({ name: part, path: acc, tokens: file.tokens });
      } else {
        let child = node.children?.find((c) => c.path === acc && c.children);
        if (!child) {
          child = { name: part, path: acc, tokens: 0, children: [] };
          (node.children ??= []).push(child);
        }
        node = child;
      }
    }
  }

  // Roll up token sums bottom-up.
  const rollup = (n: TreemapNode): number => {
    if (!n.children || n.children.length === 0) return n.tokens;
    n.tokens = n.children.reduce((sum, c) => sum + rollup(c), 0);
    return n.tokens;
  };
  rollup(root);
  return root;
};
