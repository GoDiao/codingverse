import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ParseCache, gitBlobHash } from "./index.js";
import { parseFilesCached, disposeParsers } from "../parse/index.js";
import type { FileEntry, ParsedFile } from "@codingverse/shared";

afterAll(() => disposeParsers());

describe("gitBlobHash", () => {
  it("matches `git hash-object` output", () => {
    // git hash-object of "hello\n" is a well-known value.
    expect(gitBlobHash("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("is content-sensitive", () => {
    expect(gitBlobHash("a")).not.toBe(gitBlobHash("b"));
    expect(gitBlobHash("same")).toBe(gitBlobHash("same"));
  });

  it("optionally cross-checks against real git when available", () => {
    try {
      const out = execFileSync("git", ["hash-object", "--stdin"], {
        input: "codingverse\n",
      })
        .toString()
        .trim();
      expect(gitBlobHash("codingverse\n")).toBe(out);
    } catch {
      // git not available — skip silently
    }
  });
});

const mk = (p: string, content: string): FileEntry => ({
  path: p,
  absPath: `/tmp/${p}`,
  content,
  size: content.length,
});

describe("parseFilesCached", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-pcache-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("misses on first run, hits on second (unchanged)", async () => {
    const files = [mk("a.ts", "export const a = 1;\n"), mk("b.py", "def foo():\n    return 1\n")];

    const cache1 = new ParseCache(dir);
    await cache1.load();
    const r1 = await parseFilesCached(files, cache1);
    expect(r1.stats.hits).toBe(0);
    expect(r1.stats.misses).toBe(2);
    await cache1.save();

    const cache2 = new ParseCache(dir);
    await cache2.load();
    const r2 = await parseFilesCached(files, cache2);
    expect(r2.stats.hits).toBe(2);
    expect(r2.stats.misses).toBe(0);
    // cached parse identical to fresh
    expect(r2.parsed[0]!.symbols.map((s) => s.name)).toEqual(
      r1.parsed[0]!.symbols.map((s) => s.name),
    );
  });

  it("invalidates a changed file (content hash differs)", async () => {
    const cache = new ParseCache(dir);
    await cache.load();
    await parseFilesCached([mk("c.ts", "export const c = 1;\n")], cache);
    await cache.save();

    // change content → miss
    const changed = [mk("c.ts", "export const c = 2; // changed\n")];
    const r = await parseFilesCached(changed, cache);
    expect(r.stats.misses).toBe(1);
  });

  it("prunes deleted paths", async () => {
    const cache = new ParseCache(dir);
    await cache.load();
    await parseFilesCached([mk("x.ts", "const x=1;\n"), mk("y.ts", "const y=2;\n")], cache);
    const before = cache.size;
    expect(before).toBeGreaterThanOrEqual(2);

    // next run without y.ts → y pruned
    await parseFilesCached([mk("x.ts", "const x=1;\n")], cache);
    expect(cache.get("y.ts", "const y=2;\n")).toBeUndefined();
  });
});

describe("ParseCache persistence", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-pcache2-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("survives reload", async () => {
    const parsed: ParsedFile = {
      path: "z.ts",
      language: "typescript",
      symbols: [],
      refs: [],
      chunks: [],
      degraded: false,
    };
    const c1 = new ParseCache(dir);
    await c1.load();
    c1.set("z.ts", "content", parsed);
    await c1.save();

    const c2 = new ParseCache(dir);
    await c2.load();
    expect(c2.get("z.ts", "content")).toBeDefined();
    expect(c2.get("z.ts", "different")).toBeUndefined(); // hash mismatch
  });
});
