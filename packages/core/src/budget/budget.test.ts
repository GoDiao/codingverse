import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TokenBudget, buildTokenTreemap, contentCacheKey, TokenCache } from "./index.js";
import type { Chunk } from "@codingverse/shared";

describe("TokenBudget.count", () => {
  it("counts tokens and treats empty as 0", async () => {
    const tb = new TokenBudget({ noCache: true });
    await tb.init();
    expect(tb.count("")).toBe(0);
    expect(tb.count("hello world")).toBeGreaterThan(0);
  });

  it("throws if used before init", () => {
    const tb = new TokenBudget({ noCache: true });
    expect(() => tb.count("x")).toThrow(/not initialized/);
  });

  it("annotates chunk.tokenCount in place", async () => {
    const tb = new TokenBudget({ noCache: true });
    await tb.init();
    const chunk: Chunk = {
      id: "c1",
      filePath: "a.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1,
      body: "const x = 1;",
    };
    const n = tb.countChunk(chunk);
    expect(n).toBeGreaterThan(0);
    expect(chunk.tokenCount).toBe(n);
  });

  it("aggregates per-file token counts, sorted desc", async () => {
    const tb = new TokenBudget({ noCache: true });
    await tb.init();
    const byFile = new Map<string, Chunk[]>([
      ["big.ts", [{ id: "1", filePath: "big.ts", language: "typescript", startLine: 1, endLine: 1, body: "a".repeat(200) }]],
      ["small.ts", [{ id: "2", filePath: "small.ts", language: "typescript", startLine: 1, endLine: 1, body: "x" }]],
    ]);
    const counts = tb.countFiles(byFile);
    expect(counts[0]!.path).toBe("big.ts");
    expect(counts[0]!.tokens).toBeGreaterThanOrEqual(counts[1]!.tokens);
  });
});

describe("contentCacheKey", () => {
  it("is stable and content-sensitive", () => {
    const a = contentCacheKey("o200k_base", "hello");
    const b = contentCacheKey("o200k_base", "hello");
    const c = contentCacheKey("o200k_base", "world");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^o200k_base:\d+:[0-9a-f]{16}$/);
  });
});

describe("TokenCache persistence", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-tokcache-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("persists and reloads entries", async () => {
    const key = contentCacheKey("o200k_base", "some content");
    const c1 = new TokenCache(dir);
    await c1.load();
    expect(c1.get(key)).toBeUndefined();
    c1.set(key, 42);
    await c1.save();

    const c2 = new TokenCache(dir);
    await c2.load();
    expect(c2.get(key)).toBe(42);
  });
});

describe("TokenBudget cache reuse", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-budget-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reuses cached counts across instances", async () => {
    const tb1 = new TokenBudget({ repoRoot: dir });
    await tb1.init();
    const n1 = tb1.count("function foo() { return 42; }");
    await tb1.flush();
    expect(tb1.cacheSize).toBeGreaterThan(0);

    const tb2 = new TokenBudget({ repoRoot: dir });
    await tb2.init();
    expect(tb2.cacheSize).toBeGreaterThan(0);
    const n2 = tb2.count("function foo() { return 42; }");
    expect(n2).toBe(n1);
  });
});

describe("buildTokenTreemap", () => {
  it("nests by path and rolls up sums", () => {
    const tree = buildTokenTreemap([
      { path: "src/core/a.ts", tokens: 100 },
      { path: "src/core/b.ts", tokens: 50 },
      { path: "src/cli/c.ts", tokens: 25 },
      { path: "README.md", tokens: 10 },
    ]);
    expect(tree.tokens).toBe(185);
    const src = tree.children?.find((c) => c.path === "src");
    expect(src?.tokens).toBe(175);
    const core = src?.children?.find((c) => c.path === "src/core");
    expect(core?.tokens).toBe(150);
  });
});
