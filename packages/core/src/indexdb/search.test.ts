import { describe, it, expect, afterAll } from "vitest";
import type { FileEntry, ParsedFile } from "@codingverse/shared";
import { IndexDb } from "./db.js";
import { IndexStore } from "./store.js";
import { SearchEngine } from "./search.js";
import { symbolId } from "./ids.js";
import { parseFiles, disposeParsers } from "../parse/index.js";

const mk = (path: string, content: string): FileEntry => ({
  path,
  absPath: `/tmp/${path}`,
  content,
  size: content.length,
});

const srcMap = (
  parsed: ParsedFile[],
  contents: Record<string, string>,
): Map<string, string> => {
  const m = new Map<string, string>();
  for (const p of parsed) m.set(p.path, contents[p.path] ?? "");
  return m;
};

afterAll(() => disposeParsers());

interface SeedResult {
  db: IndexDb;
  parsed: ParsedFile[];
  engine: SearchEngine;
}

const seed = async (
  files: Array<{ path: string; content: string }>,
): Promise<SeedResult> => {
  const entries = files.map((f) => mk(f.path, f.content));
  const parsed = await parseFiles(entries);
  const contents: Record<string, string> = {};
  for (const f of files) contents[f.path] = f.content;
  const db = new IndexDb({ dbPath: ":memory:" });
  db.migrate();
  const store = new IndexStore(db);
  await store.write({ parsed, sources: srcMap(parsed, contents) });
  const engine = new SearchEngine(db);
  return { db, parsed, engine };
};

const chunkByFile = (parsed: ParsedFile[], filePath: string, startLine: number) =>
  parsed
    .find((p) => p.path === filePath)!
    .chunks.find((c) => c.startLine === startLine)!;

describe("SearchEngine — BM25 basic (CamelCase split)", () => {
  it("returns the TokenBudget chunk for 'token budget' (separate tokens via comment)", async () => {
    const src = `export class TokenBudget {
  /** Token budget for the model. */
  tokens: number;
  budget: number;
}
`;
    const { db, parsed, engine } = await seed([{ path: "tb.ts", content: src }]);
    const chunk = parsed[0]!.chunks[0]!;
    expect(chunk).toBeDefined();

    const res = engine.search({ query: "token budget" });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.chunkId).toBe(chunk.id);
    expect(res[0]!.scores.bm25).toBeGreaterThan(0);
    db.close();
  });

  it("splits CamelCase in the query: 'TokenBudget' matches the separate-token body", async () => {
    const src = `export class TokenBudget {
  /** Token budget for the model. */
  tokens: number;
}
`;
    const { db, parsed, engine } = await seed([{ path: "tb.ts", content: src }]);
    const chunk = parsed[0]!.chunks[0]!;
    const res = engine.search({ query: "TokenBudget" });
    expect(res.length).toBeGreaterThan(0);
    expect(res.find((r) => r.chunkId === chunk.id)).toBeDefined();
    db.close();
  });

  it("splits uppercase-then-lowercase boundary: 'parseFile' → 'parse File'", async () => {
    const src = `export function parseFile() {
  // parse file contents
  return 1;
}
`;
    const { db, parsed, engine } = await seed([{ path: "pf.ts", content: src }]);
    const chunk = parsed[0]!.chunks[0]!;
    const res = engine.search({ query: "parseFile" });
    expect(res.length).toBeGreaterThan(0);
    expect(res.find((r) => r.chunkId === chunk.id)).toBeDefined();
    db.close();
  });
});

describe("SearchEngine — trigram substring (CamelCase identifier, no separate words)", () => {
  // v1.1 acceptance criterion #2: a chunk whose body is only the CamelCase
  // identifier (no comment providing separate words) must be findable. The
  // trigram tokenizer indexes 3-char subsequences of `TokenBudget`, so the
  // body matches the substring queries "TokenBudget" / "tokenbudget" / "Token".
  const src = `export class TokenBudget {
  tokens: number;
  budget: number;
}
`;

  it("search('TokenBudget') finds the class chunk with no comment", async () => {
    const { db, parsed, engine } = await seed([{ path: "tb.ts", content: src }]);
    const chunk = parsed[0]!.chunks[0]!;
    expect(chunk).toBeDefined();
    const res = engine.search({ query: "TokenBudget" });
    expect(res.length).toBeGreaterThan(0);
    expect(res.find((r) => r.chunkId === chunk.id)).toBeDefined();
    db.close();
  });

  it("search('tokenbudget') (lowercase) finds the class chunk", async () => {
    const { db, parsed, engine } = await seed([{ path: "tb.ts", content: src }]);
    const chunk = parsed[0]!.chunks[0]!;
    const res = engine.search({ query: "tokenbudget" });
    expect(res.length).toBeGreaterThan(0);
    expect(res.find((r) => r.chunkId === chunk.id)).toBeDefined();
    db.close();
  });

  it("search('Token') finds the class chunk via substring", async () => {
    const { db, parsed, engine } = await seed([{ path: "tb.ts", content: src }]);
    const chunk = parsed[0]!.chunks[0]!;
    const res = engine.search({ query: "Token" });
    expect(res.length).toBeGreaterThan(0);
    expect(res.find((r) => r.chunkId === chunk.id)).toBeDefined();
    db.close();
  });
});

describe("SearchEngine — empty / short query", () => {
  it("returns [] for empty string", async () => {
    const { db, engine } = await seed([
      { path: "a.ts", content: "export function foo() { return 1; }\n" },
    ]);
    expect(engine.search({ query: "" })).toEqual([]);
    db.close();
  });

  it("returns [] for a single-character query", async () => {
    const { db, engine } = await seed([
      { path: "a.ts", content: "export function foo() { return 1; }\n" },
    ]);
    expect(engine.search({ query: "a" })).toEqual([]);
    db.close();
  });

  it("returns [] for a whitespace-only query", async () => {
    const { db, engine } = await seed([
      { path: "a.ts", content: "export function foo() { return 1; }\n" },
    ]);
    expect(engine.search({ query: "   " })).toEqual([]);
    db.close();
  });
});

describe("SearchEngine — no results", () => {
  it("returns [] when no chunk matches", async () => {
    const { db, engine } = await seed([
      {
        path: "a.ts",
        content: "export function widget() { return 1; }\n",
      },
    ]);
    expect(engine.search({ query: "nonexistentterm" })).toEqual([]);
    db.close();
  });
});

describe("SearchEngine — co-location graph (same-file proximity)", () => {
  it("returns the BM25 chunk AND a same-file neighbor", async () => {
    const src = `export function alphaWidget() {
  // alpha widget marker
  return 1;
}
export function betaThing() {
  return 2;
}
export function gammaStuff() {
  return 3;
}
`;
    const { db, parsed, engine } = await seed([{ path: "coloc.ts", content: src }]);
    const aChunk = chunkByFile(parsed, "coloc.ts", 1);
    const bChunk = chunkByFile(parsed, "coloc.ts", 5);
    expect(aChunk).toBeDefined();
    expect(bChunk).toBeDefined();

    const res = engine.search({ query: "alpha widget" });
    const ids = res.map((r) => r.chunkId);
    expect(ids).toContain(aChunk.id);
    expect(ids).toContain(bChunk.id);
    db.close();
  });
});

describe("SearchEngine — RRF ordering (graph presence boosts rank)", () => {
  it("ranks a BM25-rank-2 + graph-rank-1 chunk above a BM25-rank-1 chunk with no graph", async () => {
    const ySrc = `export function widget() { return widget(); }\n`;
    const xSrc = `export function widget() {
  return 1;
}
export function helperFunc() {
  const value = widget();
  return value + 1;
}
`;
    const { db, parsed, engine } = await seed([
      { path: "y.ts", content: ySrc },
      { path: "x.ts", content: xSrc },
    ]);

    const yChunk = chunkByFile(parsed, "y.ts", 1);
    const xChunk = chunkByFile(parsed, "x.ts", 1);
    expect(yChunk).toBeDefined();
    expect(xChunk).toBeDefined();

    const res = engine.search({ query: "widget" });
    const ids = res.map((r) => r.chunkId);
    expect(ids).toContain(yChunk.id);
    expect(ids).toContain(xChunk.id);
    const yIdx = ids.indexOf(yChunk.id);
    const xIdx = ids.indexOf(xChunk.id);
    expect(xIdx).toBeLessThan(yIdx);
    db.close();
  });
});

describe("SearchEngine — topK truncation", () => {
  it("returns at most topK results", async () => {
    const files = [1, 2, 3, 4, 5].map((n) => ({
      path: `f${n}.ts`,
      content: `export function f${n}() { /* unique term */ return ${n}; }\n`,
    }));
    const { db, engine } = await seed(files);
    const res = engine.search({ query: "unique term", topK: 3 });
    expect(res.length).toBeLessThanOrEqual(3);
    expect(res.length).toBeGreaterThan(0);
    db.close();
  });
});

describe("SearchEngine — relatedNodes", () => {
  it("populates relatedNodes with node ids from the result's file", async () => {
    const src = `export function widget() {
  return 1;
}
export function helperFunc() {
  return 2;
}
`;
    const { db, engine } = await seed([{ path: "rel.ts", content: src }]);
    const res = engine.search({ query: "widget" });
    expect(res.length).toBeGreaterThan(0);
    const row = res[0]!;
    expect(row.relatedNodes.length).toBeGreaterThan(0);
    expect(row.relatedNodes).toContain(symbolId("rel.ts", "widget"));
    expect(row.relatedNodes).toContain(symbolId("rel.ts", "helperFunc"));
    db.close();
  });
});

describe("SearchEngine — scores populated", () => {
  it("bm25, graph, and rrf are finite numbers", async () => {
    const src = `export function widget() {
  // widget helper
  return 1;
}
export function otherFunc() {
  return 2;
}
`;
    const { db, engine } = await seed([{ path: "sc.ts", content: src }]);
    const res = engine.search({ query: "widget" });
    expect(res.length).toBeGreaterThan(0);
    for (const row of res) {
      expect(typeof row.scores.bm25).toBe("number");
      expect(typeof row.scores.graph).toBe("number");
      expect(typeof row.scores.rrf).toBe("number");
      expect(Number.isFinite(row.scores.bm25)).toBe(true);
      expect(Number.isFinite(row.scores.graph)).toBe(true);
      expect(Number.isFinite(row.scores.rrf)).toBe(true);
    }
    db.close();
  });
});

describe("SearchEngine — weights apply", () => {
  it("bm25Weight=0 graphWeight=1 → graph path dominates, BM25-only chunk does not win", async () => {
    const ySrc = `export function widget() { return widget(); }\n`;
    const xSrc = `export function widget() {
  return 1;
}
export function helperFunc() {
  const value = widget();
  return value + 1;
}
`;
    const { db, parsed, engine } = await seed([
      { path: "y.ts", content: ySrc },
      { path: "x.ts", content: xSrc },
    ]);

    const yChunk = chunkByFile(parsed, "y.ts", 1);
    const xChunk = chunkByFile(parsed, "x.ts", 1);

    const res = engine.search({
      query: "widget",
      bm25Weight: 0,
      graphWeight: 1,
    });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.chunkId).not.toBe(yChunk.id);
    const ids = res.map((r) => r.chunkId);
    expect(ids).toContain(xChunk.id);
    if (ids.includes(yChunk.id)) {
      expect(ids.indexOf(xChunk.id)).toBeLessThan(ids.indexOf(yChunk.id));
    }
    db.close();
  });
});

describe("SearchEngine.searchDebug — board ④ per-path breakdown (v2.5-V6)", () => {
  it("returns bm25 / graph / fused paths that agree with search()", async () => {
    const src = `export class TokenBudget {
  /** Token budget for the model. */
  tokens: number;
  budget: number;
}
`;
    const { db, engine } = await seed([{ path: "budget.ts", content: src }]);

    const debug = engine.searchDebug({ query: "token budget" });
    expect(debug.query).toBe("token budget");
    expect(debug.ftsQuery.length).toBeGreaterThan(0);
    expect(debug.rrfK).toBe(60);
    expect(debug.weights).toEqual({ bm25: 1, graph: 1 });

    // BM25 path is non-empty and ranks are 1-indexed & contiguous.
    expect(debug.bm25.length).toBeGreaterThan(0);
    expect(debug.bm25[0]!.rank).toBe(1);
    for (let i = 0; i < debug.bm25.length; i++) {
      expect(debug.bm25[i]!.rank).toBe(i + 1);
    }

    // Fused top-k matches search()'s chunk ordering exactly.
    const rows = engine.search({ query: "token budget" });
    expect(debug.fused.map((f) => f.chunkId)).toEqual(rows.map((r) => r.chunkId));

    // Each fused row's per-path ranks agree with the standalone path lists.
    for (const f of debug.fused) {
      const b = debug.bm25.find((x) => x.chunkId === f.chunkId);
      expect(f.bm25Rank).toBe(b ? b.rank : 0);
      const g = debug.graph.find((x) => x.chunkId === f.chunkId);
      expect(f.graphRank).toBe(g ? g.rank : 0);
    }
    db.close();
  });

  it("returns all-empty (no throw) for an empty / too-short query", async () => {
    const { db, engine } = await seed([
      { path: "a.ts", content: "export function foo() { return 1; }\n" },
    ]);
    const debug = engine.searchDebug({ query: "" });
    expect(debug.bm25).toEqual([]);
    expect(debug.graph).toEqual([]);
    expect(debug.fused).toEqual([]);
    expect(debug.ftsQuery).toBe("");
    db.close();
  });
});
