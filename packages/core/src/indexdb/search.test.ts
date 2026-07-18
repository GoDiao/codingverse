import { describe, it, expect, afterAll } from "vitest";
import type { FileEntry, ParsedFile } from "@codingverse/shared";
import { IndexDb } from "./db.js";
import { IndexStore } from "./store.js";
import { RefResolver } from "./resolve.js";
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
  // v3: the graph path walks the real call graph, so resolve unresolved refs
  // into edges (Engine.index does this after store.write; tests must too).
  new RefResolver(db).resolveAll();
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

describe("SearchEngine — call-graph expansion (v3, real call graph)", () => {
  it("pulls in a CROSS-FILE caller of the matched symbol via the graph path", async () => {
    // helper.ts defines a uniquely-named symbol; consumer.ts (a different
    // file) calls it. A query matching ONLY helper.ts should still surface
    // consumer.ts's chunk through the call-graph path — impossible under the
    // old same-file-proximity heuristic.
    const helperSrc = `export function zephyrCompute() {
  return 1;
}
`;
    const consumerSrc = `import { zephyrCompute } from "./helper";
export function runConsumer() {
  return zephyrCompute() + 1;
}
`;
    const { db, parsed, engine } = await seed([
      { path: "helper.ts", content: helperSrc },
      { path: "consumer.ts", content: consumerSrc },
    ]);
    const helperChunk = chunkByFile(parsed, "helper.ts", 1);
    const consumerChunk = chunkByFile(parsed, "consumer.ts", 1);
    expect(helperChunk).toBeDefined();
    expect(consumerChunk).toBeDefined();

    const res = engine.search({ query: "zephyrCompute" });
    const ids = res.map((r) => r.chunkId);
    // BM25 finds helper.ts; call graph pulls in consumer.ts (cross-file caller).
    expect(ids).toContain(helperChunk.id);
    expect(ids).toContain(consumerChunk.id);
    db.close();
  });

  it("a matched symbol with NO call edges yields no graph neighbors", async () => {
    const src = `export function lonelyOrbit() {
  return 42;
}
`;
    const { db, engine } = await seed([{ path: "lonely.ts", content: src }]);
    const debug = engine.searchDebug({ query: "lonelyOrbit" });
    expect(debug.bm25.length).toBeGreaterThan(0);
    // no callers/callees → graph path empty.
    expect(debug.graph).toEqual([]);
    db.close();
  });
});

describe("SearchEngine — RRF ordering (call-graph presence boosts rank)", () => {
  it("a graph-connected callee is surfaced even though it lacks the query text", async () => {
    // seed.ts matches the query AND calls deepHelper. deepHelper's own body
    // has none of the query terms, so it can ONLY appear via the call-graph
    // path — proving graph presence, not text, brought it in.
    const seedSrc = `export function radiantSeed() {
  return deepHelper();
}
`;
    const helperSrc = `export function deepHelper() {
  return 123;
}
`;
    const { db, parsed, engine } = await seed([
      { path: "seed.ts", content: seedSrc },
      { path: "helper.ts", content: helperSrc },
    ]);
    const seedChunk = chunkByFile(parsed, "seed.ts", 1);
    const helperChunk = chunkByFile(parsed, "helper.ts", 1);

    const res = engine.search({ query: "radiantSeed" });
    const ids = res.map((r) => r.chunkId);
    expect(ids).toContain(seedChunk.id); // BM25 hit
    expect(ids).toContain(helperChunk.id); // graph-only (callee, no query text)
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
  it("bm25Weight=0 graphWeight=1 → only call-graph presence scores; an edgeless BM25 hit does not win", async () => {
    // seed.ts matches the query and calls emberCallee (a graph neighbor).
    // island.ts also matches the query (via trigram) but has NO call edges.
    // With bm25Weight=0, only the graph path scores → the edgeless island
    // must not be the top result; the graph-connected callee should appear.
    const seedSrc = `export function orbitPrime() {
  return emberCallee();
}
`;
    const calleeSrc = `export function emberCallee() {
  return 7;
}
`;
    const islandSrc = `export function orbitPrimeIsland() {
  return 9;
}
`;
    const { db, parsed, engine } = await seed([
      { path: "seed.ts", content: seedSrc },
      { path: "callee.ts", content: calleeSrc },
      { path: "island.ts", content: islandSrc },
    ]);
    const calleeChunk = chunkByFile(parsed, "callee.ts", 1);
    const islandChunk = chunkByFile(parsed, "island.ts", 1);

    const res = engine.search({ query: "orbitPrime", bm25Weight: 0, graphWeight: 1 });
    expect(res.length).toBeGreaterThan(0);
    const ids = res.map((r) => r.chunkId);
    // The graph-connected callee is present…
    expect(ids).toContain(calleeChunk.id);
    // …and the edgeless BM25-only island is not the winner.
    expect(res[0]!.chunkId).not.toBe(islandChunk.id);
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
