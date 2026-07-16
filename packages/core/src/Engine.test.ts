import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "./Engine.js";
import { disposeParsers } from "./parse/index.js";
import { symbolId } from "./indexdb/ids.js";
import { IndexDb } from "./indexdb/index.js";
import { STATE_DIR } from "@codingverse/shared";
import type { IndexStats, SearchHit, PackResult, DashboardStats } from "@codingverse/shared";

afterAll(() => disposeParsers());

const SAMPLE_A = `export function widgetMaker() {
  // widget helper marker
  return 1;
}
export function useWidget() {
  return widgetMaker();
}
`;

const SAMPLE_B = `export function sorcery() {
  return 42;
}
`;

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-engine-"));
  await fsp.writeFile(path.join(dir, "a.ts"), SAMPLE_A);
  await fsp.writeFile(path.join(dir, "b.ts"), SAMPLE_B);
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const indexPath = (repo: string): string => path.join(repo, STATE_DIR, "index.db");

describe("Engine.index — real SQLite write", () => {
  it("returns IndexStats with non-zero symbols/chunks and writes index.db", async () => {
    const engine = await Engine.open(dir);
    const stats = await engine.index();

    expect(stats.filesProcessed).toBeGreaterThan(0);
    expect(stats.symbols).toBeGreaterThan(0);
    expect(stats.chunks).toBeGreaterThan(0);
    expect(stats.edges).toBeGreaterThanOrEqual(0);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);

    expect(fs.existsSync(indexPath(dir))).toBe(true);
    await engine.close();
  });

  it("resolves at least one edge from useWidget → widgetMaker", async () => {
    const engine = await Engine.open(dir);
    const stats: IndexStats = await engine.index();
    expect(stats.edges).toBeGreaterThanOrEqual(1);
    await engine.close();
  });

  it("is idempotent: a second index() keeps counts stable", async () => {
    const engine = await Engine.open(dir);
    const first = await engine.index();
    const second = await engine.index();
    expect(second.symbols).toBe(first.symbols);
    expect(second.chunks).toBe(first.chunks);
    expect(second.edges).toBe(first.edges);
    await engine.close();
  });
});

describe("Engine.search — hits after index", () => {
  it("returns SearchHit[] with the correct shape for a term that exists", async () => {
    const engine = await Engine.open(dir);
    await engine.index();

    const hits = await engine.search("widget");
    expect(hits.length).toBeGreaterThan(0);

    const hit: SearchHit = hits[0]!;
    expect(typeof hit.chunkId).toBe("string");
    expect(hit.chunkId.length).toBeGreaterThan(0);
    expect(hit.filePath).toBe("a.ts");
    expect(typeof hit.startLine).toBe("number");
    expect(typeof hit.endLine).toBe("number");
    expect(typeof hit.body).toBe("string");
    expect(hit.scores.vector).toBe(0);
    expect(typeof hit.scores.bm25).toBe("number");
    expect(Number.isFinite(hit.scores.bm25)).toBe(true);
    expect(typeof hit.scores.graph).toBe("number");
    expect(Number.isFinite(hit.scores.graph)).toBe(true);
    expect(typeof hit.scores.rrf).toBe("number");
    expect(Number.isFinite(hit.scores.rrf)).toBe(true);
    expect(Array.isArray(hit.relatedNodes)).toBe(true);
    await engine.close();
  });

  it("respects topK", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    const hits = await engine.search("widget", { topK: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
    await engine.close();
  });
});

describe("Engine.search — empty / no-match", () => {
  it("returns [] for a term that does not exist", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    expect(await engine.search("nonexistentterm")).toEqual([]);
    await engine.close();
  });

  it("returns [] (not throw) on a fresh engine with an empty index", async () => {
    const engine = await Engine.open(dir);
    expect(await engine.search("widget")).toEqual([]);
    expect(await engine.search("anything")).toEqual([]);
    await engine.close();
  });
});

describe("Engine.index — pruning deleted files", () => {
  it("drops rows for files removed between index runs (no stale hits)", async () => {
    const engine = await Engine.open(dir);
    try {
      const first = await engine.index();
      expect(first.symbols).toBeGreaterThan(0);
      expect(await engine.search("widget")).not.toEqual([]);

      await fsp.rm(path.join(dir, "a.ts"));

      const second = await engine.index();
      expect(second.symbols).toBeLessThan(first.symbols);
      expect(await engine.search("widget")).toEqual([]);

      const remaining = await engine.search("sorcery");
      for (const hit of remaining) {
        expect(hit.filePath).not.toBe("a.ts");
      }
    } finally {
      await engine.close();
    }
  });
});

describe("Engine.close — lifecycle", () => {
  it("is idempotent", async () => {
    const engine = await Engine.open(dir);
    await engine.close();
    await expect(engine.close()).resolves.toBeUndefined();
  });

  it("is a no-op when index() was never called (no IndexDb opened)", async () => {
    const engine = await Engine.open(dir);
    await expect(engine.close()).resolves.toBeUndefined();
    expect(fs.existsSync(indexPath(dir))).toBe(false);
  });

  it("makes subsequent search() throw a clear 'Engine is closed' error", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.close();
    await expect(engine.search("widget")).rejects.toThrow(/Engine is closed/);
  });

  it("makes subsequent index() throw a clear 'Engine is closed' error", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.close();
    await expect(engine.index()).rejects.toThrow(/Engine is closed/);
  });
});

describe("Engine.pack — regression guard (unaffected by index wiring)", () => {
  it("still produces a PackResult with content after the index changes", async () => {
    const engine = await Engine.open(dir);
    const result: PackResult = await engine.pack();
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.fileCount).toBeGreaterThan(0);
    await engine.close();
  });

  it("coexists with index(): index then pack on the same engine", async () => {
    const engine = await Engine.open(dir);
    const stats = await engine.index();
    expect(stats.symbols).toBeGreaterThan(0);

    const result = await engine.pack();
    expect(result.content.length).toBeGreaterThan(0);
    await engine.close();
  });

  it("pack() after index()+close() falls back to v1 (no opaque sqlite throw)", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.close();
    // After close, this.indexDb is non-null but the connection is closed and
    // this.closed=true → pagerankImportanceProvider returns undefined → v1
    // heuristic. pack() must not throw "database is not open".
    const result = await engine.pack();
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.fileCount).toBeGreaterThan(0);
  });

  it("close() after pack() does not throw", async () => {
    const engine = await Engine.open(dir);
    await engine.pack();
    await expect(engine.close()).resolves.toBeUndefined();
  });

  it("pack() does NOT create an index.db (lazy IndexDb)", async () => {
    const cleanDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-engine-noidx-"));
    try {
      const engine = await Engine.open(cleanDir);
      const result = await engine.pack();
      expect(result.content).toBeTypeOf("string");
      await engine.close();
      expect(fs.existsSync(indexPath(cleanDir))).toBe(false);
    } finally {
      await fsp.rm(cleanDir, { recursive: true, force: true });
    }
  });
});

const CHAIN = `function a() { return b(); }
function b() { return c(); }
function c() { return 1; }
`;

const HUB = `function f1() { return hub(); }
function f2() { return hub(); }
function f3() { return hub(); }
function hub() { return 1; }
function leaf() { return 1; }
`;

describe("Engine.callers/callees/impact — CallGraph wiring (v2)", () => {
  it("callers(cId, 2) returns [c, b, a] as SymbolNode[]", async () => {
    await fsp.writeFile(path.join(dir, "chain.ts"), CHAIN);
    const engine = await Engine.open(dir);
    await engine.index();
    const cId = symbolId("chain.ts", "c");
    const bId = symbolId("chain.ts", "b");
    const aId = symbolId("chain.ts", "a");
    const nodes = await engine.callers(cId, 2);
    expect(nodes.map((n) => n.id)).toEqual([cId, bId, aId]);
    expect(nodes[0]).toMatchObject({ id: cId, name: "c", filePath: "chain.ts" });
    await engine.close();
  });

  it("callees(aId, 2) returns [a, b, c]", async () => {
    await fsp.writeFile(path.join(dir, "chain.ts"), CHAIN);
    const engine = await Engine.open(dir);
    await engine.index();
    const aId = symbolId("chain.ts", "a");
    const bId = symbolId("chain.ts", "b");
    const cId = symbolId("chain.ts", "c");
    const nodes = await engine.callees(aId, 2);
    expect(nodes.map((n) => n.id)).toEqual([aId, bId, cId]);
    await engine.close();
  });

  it("impact(cId, 3) returns a non-empty SymbolNode[] starting at c", async () => {
    await fsp.writeFile(path.join(dir, "chain.ts"), CHAIN);
    const engine = await Engine.open(dir);
    await engine.index();
    const cId = symbolId("chain.ts", "c");
    const nodes = await engine.impact(cId, 3);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0]!.id).toBe(cId);
    await engine.close();
  });

  it("impactGraph(cId, 3) returns a GraphResult with nodes/edges/byDepth/truncated", async () => {
    await fsp.writeFile(path.join(dir, "chain.ts"), CHAIN);
    const engine = await Engine.open(dir);
    await engine.index();
    const cId = symbolId("chain.ts", "c");
    const res = await engine.impactGraph(cId, 3);
    expect(Array.isArray(res.nodes)).toBe(true);
    expect(res.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(res.edges)).toBe(true);
    expect(Array.isArray(res.byDepth)).toBe(true);
    expect(res.byDepth[0]).toHaveLength(1);
    expect(res.byDepth[0]![0]!.id).toBe(cId);
    expect(typeof res.truncated).toBe("boolean");
    await engine.close();
  });

  it("callersGraph(cId, 2) returns a GraphResult with byDepth[0]=start, byDepth[1]=depth-1 callers", async () => {
    await fsp.writeFile(path.join(dir, "chain.ts"), CHAIN);
    const engine = await Engine.open(dir);
    await engine.index();
    const cId = symbolId("chain.ts", "c");
    const bId = symbolId("chain.ts", "b");
    const res = await engine.callersGraph(cId, 2);
    expect(Array.isArray(res.nodes)).toBe(true);
    expect(Array.isArray(res.edges)).toBe(true);
    expect(Array.isArray(res.byDepth)).toBe(true);
    expect(res.byDepth[0]).toHaveLength(1);
    expect(res.byDepth[0]![0]!.id).toBe(cId);
    expect(res.byDepth[1]!.map((n) => n.id)).toEqual([bId]);
    expect(typeof res.truncated).toBe("boolean");
    expect(res.truncated).toBe(false);
    await engine.close();
  });

  it("calleesGraph(aId, 2) returns a GraphResult with byDepth[0]=start, byDepth[1]=depth-1 callees", async () => {
    await fsp.writeFile(path.join(dir, "chain.ts"), CHAIN);
    const engine = await Engine.open(dir);
    await engine.index();
    const aId = symbolId("chain.ts", "a");
    const bId = symbolId("chain.ts", "b");
    const res = await engine.calleesGraph(aId, 2);
    expect(Array.isArray(res.nodes)).toBe(true);
    expect(Array.isArray(res.edges)).toBe(true);
    expect(Array.isArray(res.byDepth)).toBe(true);
    expect(res.byDepth[0]).toHaveLength(1);
    expect(res.byDepth[0]![0]!.id).toBe(aId);
    expect(res.byDepth[1]!.map((n) => n.id)).toEqual([bId]);
    expect(typeof res.truncated).toBe("boolean");
    expect(res.truncated).toBe(false);
    await engine.close();
  });

  it("callers/callees/impact throw on an unknown node id", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    await expect(engine.callers("no-such-id", 2)).rejects.toThrow(/Unknown node id/);
    await expect(engine.callees("no-such-id", 2)).rejects.toThrow(/Unknown node id/);
    await expect(engine.impact("no-such-id", 3)).rejects.toThrow(/Unknown node id/);
    await engine.close();
  });
});

describe("Engine.rank — PageRank wiring (v2)", () => {
  it("rank() converges and writes pagerank > 0 to caller nodes", async () => {
    await fsp.writeFile(path.join(dir, "hub.ts"), HUB);
    const engine = await Engine.open(dir);
    await engine.index();
    const stats = await engine.rank();
    expect(stats.converged).toBe(true);
    expect(stats.iterations).toBeGreaterThan(0);
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.edgeCount).toBeGreaterThan(0);
    const hubId = symbolId("hub.ts", "hub");
    const callers = await engine.callers(hubId, 1);
    expect(callers.length).toBeGreaterThan(0);
    for (const n of callers) {
      expect(n.pagerank).toBeGreaterThan(0);
    }
    await engine.close();
  });

  it("close() after rank() does not throw", async () => {
    await fsp.writeFile(path.join(dir, "hub.ts"), HUB);
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.rank();
    await expect(engine.close()).resolves.toBeUndefined();
  });
});

describe("Engine.topRankedNodes — v2-4", () => {
  it("returns top-N nodes ordered by pagerank desc with display metadata", async () => {
    await fsp.writeFile(path.join(dir, "hub.ts"), HUB);
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.rank();

    const top = await engine.topRankedNodes(3);
    expect(top).toHaveLength(3);
    // desc ordering
    expect(top[0]!.pagerank).toBeGreaterThanOrEqual(top[1]!.pagerank);
    expect(top[1]!.pagerank).toBeGreaterThanOrEqual(top[2]!.pagerank);
    // shape
    const hubId = symbolId("hub.ts", "hub");
    const hubRow = top.find((r) => r.id === hubId);
    expect(hubRow).toBeDefined();
    expect(hubRow!.pagerank).toBeGreaterThan(0);
    expect(hubRow!.filePath).toBe("hub.ts");
    expect(typeof hubRow!.startLine).toBe("number");
    expect(hubRow!.name).toBe("hub");
    await engine.close();
  });

  it("hub outranks leaf in topRankedNodes", async () => {
    await fsp.writeFile(path.join(dir, "hub.ts"), HUB);
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.rank();
    const top = await engine.topRankedNodes(10);
    const hubRank = top.find((r) => r.name === "hub")!.pagerank;
    const leafRank = top.find((r) => r.name === "leaf")!.pagerank;
    expect(hubRank).toBeGreaterThan(leafRank);
    await engine.close();
  });

  it("resolves a name to its node id, and passes hex ids through", async () => {
    await fsp.writeFile(path.join(dir, "hub.ts"), HUB);
    const engine = await Engine.open(dir);
    await engine.index();
    const hubId = symbolId("hub.ts", "hub");
    expect(await engine.resolveNodeId("hub")).toBe(hubId);
    expect(await engine.resolveNodeId(hubId)).toBe(hubId);
    await engine.close();
  });

  it("resolveNodeId throws 'no node named ...' for an unknown name", async () => {
    await fsp.writeFile(path.join(dir, "hub.ts"), HUB);
    const engine = await Engine.open(dir);
    await engine.index();
    await expect(engine.resolveNodeId("doesNotExist")).rejects.toThrow(
      /no node named 'doesNotExist' found/,
    );
    await engine.close();
  });

  it("resolveNodeId is deterministic when multiple symbols share a name (ORDER BY id ASC)", async () => {
    // Two files each define `sharedName`. Without ORDER BY, SQLite's row
    // order is unspecified → non-deterministic which id wins. With
    // ORDER BY id ASC, the smaller id is returned every time, stable
    // across calls and across re-indexes (id is content-stable).
    await fsp.writeFile(
      path.join(dir, "a.ts"),
      "export function sharedName() { return 1; }\n",
    );
    await fsp.writeFile(
      path.join(dir, "b.ts"),
      "export function sharedName() { return 2; }\n",
    );
    const engine = await Engine.open(dir);
    await engine.index();

    const idA = symbolId("a.ts", "sharedName");
    const idB = symbolId("b.ts", "sharedName");
    const smaller = idA < idB ? idA : idB;

    // Two independent resolves return the same id (determinism).
    const first = await engine.resolveNodeId("sharedName");
    const second = await engine.resolveNodeId("sharedName");
    expect(first).toBe(second);
    // And it is the smallest id (ORDER BY id ASC).
    expect(first).toBe(smaller);
    await engine.close();
  });
});

describe("Engine.pack — pagerank-aware layer selection (v2)", () => {
  it("pack() without rank falls back to v1 heuristics (no regression)", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-pack-v1-"));
    try {
      await fsp.writeFile(path.join(clean, "hub.ts"), "function hub() { return 1; }\n");
      await fsp.writeFile(
        path.join(clean, "callers.ts"),
        "function c1() { return hub(); }\nfunction c2() { return hub(); }\n",
      );
      const engine = await Engine.open(clean);
      await engine.index();
      // No rank() → pagerank all 0 → provider returns 0 → v1 heuristic.
      const result = await engine.pack();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.fileCount).toBeGreaterThan(0);
      await engine.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });

  it("pack() with no prior index use does NOT create index.db (lazy invariant)", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-lazy-"));
    try {
      const engine = await Engine.open(clean);
      await engine.pack();
      await engine.close();
      expect(fs.existsSync(indexPath(clean))).toBe(false);
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });

  it("pack() after rank keeps the high-pagerank hub file full under a tight budget", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-pr-pack-"));
    try {
      await fsp.writeFile(path.join(clean, "hub.ts"), "function hub() { return 1; }\n");
      await fsp.writeFile(path.join(clean, "leaf.ts"), "function leaf() { return 1; }\n");
      await fsp.writeFile(
        path.join(clean, "callers.ts"),
        "function c1() { return hub(); }\nfunction c2() { return hub(); }\nfunction c3() { return hub(); }\n",
      );
      const engine = await Engine.open(clean);
      await engine.index();
      await engine.rank();

      // Probe with the default (large) budget → every file lands at full;
      // read the full token costs to set a deterministic tight budget.
      const probe = await engine.pack();
      const hubFull = probe.files.find((f) => f.path === "hub.ts")!.tokens;
      const leafFull = probe.files.find((f) => f.path === "leaf.ts")!.tokens;
      const tight = Math.max(hubFull, leafFull);

      const result = await engine.pack({ tokenBudget: tight });
      expect(result.layerMap["hub.ts"]).toBe("full");
      expect(result.layerMap["leaf.ts"]).not.toBe("full");
      await engine.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });
});

describe("Engine.search — relatedNodes pagerank ordering (v2)", () => {
  it("after rank, the highest-pagerank node leads relatedNodes for its file", async () => {
    await fsp.writeFile(path.join(dir, "hub.ts"), HUB);
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.rank();
    const hits = await engine.search("hub");
    expect(hits.length).toBeGreaterThan(0);
    const hubHits = hits.filter((h) => h.filePath === "hub.ts");
    expect(hubHits.length).toBeGreaterThan(0);
    const hubId = symbolId("hub.ts", "hub");
    for (const h of hubHits) {
      expect(h.relatedNodes[0]).toBe(hubId);
    }
    await engine.close();
  });
});

describe("Engine.pack — transient read-only pagerank for one-shot CLI pack (v2-polish Item 1)", () => {
  it("a fresh Engine (indexDb null) reads pagerank from an existing index.db via a transient read-only open", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-transient-pr-"));
    try {
      await fsp.writeFile(path.join(clean, "hub.ts"), "function hub() { return 1; }\n");
      await fsp.writeFile(path.join(clean, "leaf.ts"), "function leaf() { return 1; }\n");
      await fsp.writeFile(
        path.join(clean, "callers.ts"),
        "function c1() { return hub(); }\nfunction c2() { return hub(); }\nfunction c3() { return hub(); }\n",
      );
      // Process 1: index + rank + close → index.db exists on disk with
      // pagerank but no live rw connection.
      const e1 = await Engine.open(clean);
      await e1.index();
      await e1.rank();
      await e1.close();
      expect(fs.existsSync(indexPath(clean))).toBe(true);

      // Process 2: a fresh Engine (indexDb null) packs. The provider must
      // transiently open the existing index.db read-only and read MAX pagerank,
      // so the high-pagerank hub stays full under a tight budget — same
      // outcome as the in-process test, but via the transient path.
      const e2 = await Engine.open(clean);
      const probe = await e2.pack();
      const hubFull = probe.files.find((f) => f.path === "hub.ts")!.tokens;
      const leafFull = probe.files.find((f) => f.path === "leaf.ts")!.tokens;
      const tight = Math.max(hubFull, leafFull);
      const result = await e2.pack({ tokenBudget: tight });
      expect(result.layerMap["hub.ts"]).toBe("full");
      expect(result.layerMap["leaf.ts"]).not.toBe("full");
      await e2.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });

  it("a fresh Engine on a never-indexed repo still does NOT create index.db (lazy invariant holds)", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-transient-lazy-"));
    try {
      const engine = await Engine.open(clean);
      await engine.pack();
      await engine.close();
      expect(fs.existsSync(indexPath(clean))).toBe(false);
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });

  it("transient dbs are closed after pack — a second pack on the same engine does not throw", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-transient-repack-"));
    try {
      await fsp.writeFile(path.join(clean, "hub.ts"), HUB);
      const e1 = await Engine.open(clean);
      await e1.index();
      await e1.rank();
      await e1.close();

      const e2 = await Engine.open(clean);
      await e2.pack();
      // Second pack re-opens a fresh transient read-only db (the first was
      // closed in the first pack's finally). Must not throw "database is
      // closed" or leak a locked handle.
      await expect(e2.pack()).resolves.toBeDefined();
      await e2.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });
});

describe("Engine.index — re-index hint counts (v2-polish Item 2)", () => {
  it("index() reports scipEdgesBefore and rankedNodesBefore before a full re-index resets them", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-reindex-hint-"));
    try {
      await fsp.writeFile(path.join(clean, "hub.ts"), HUB);
      const engine = await Engine.open(clean);
      await engine.index();
      await engine.rank();
      await engine.close();

      // Seed a scip-provenance edge directly (simulates `cv index --scip`).
      const seed = new IndexDb({ dbPath: path.join(clean, STATE_DIR, "index.db") });
      seed.migrate();
      const hubId = symbolId("hub.ts", "hub");
      const f1Id = symbolId("hub.ts", "f1");
      seed.db
        .prepare(
          "INSERT INTO edges (source, target, kind, provenance) VALUES (?, ?, 'calls', 'scip')",
        )
        .run(f1Id, hubId);
      seed.close();

      // Re-index: counts must reflect the pre-index state (scip edge + ranked nodes).
      const e2 = await Engine.open(clean);
      const stats = await e2.index();
      expect(stats.scipEdgesBefore).toBeGreaterThan(0);
      expect(stats.rankedNodesBefore).toBeGreaterThan(0);
      await e2.close();

      // After the full re-index, scip edges (FK cascade on node delete) +
      // pagerank (nodes inserted with pagerank=0) are gone — a subsequent
      // index() reports neither.
      const e3 = await Engine.open(clean);
      const stats2 = await e3.index();
      expect(stats2.scipEdgesBefore ?? 0).toBe(0);
      expect(stats2.rankedNodesBefore ?? 0).toBe(0);
      await e3.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });

  it("index() on a fresh repo reports no scip edges and no ranked nodes", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-reindex-fresh-"));
    try {
      await fsp.writeFile(path.join(clean, "a.ts"), SAMPLE_A);
      const engine = await Engine.open(clean);
      const stats = await engine.index();
      expect(stats.scipEdgesBefore ?? 0).toBe(0);
      expect(stats.rankedNodesBefore ?? 0).toBe(0);
      await engine.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });
});

describe("Engine.pack — MAX pagerank aggregate (v2-polish Item 3)", () => {
  it("a file with 1 high-pagerank hub + 5 leaf helpers outranks a medium-hub-only file under a tight budget (MAX, not AVG)", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-v2-max-agg-"));
    try {
      // ahub.ts: one high-pagerank hub (called by 4 external callers) plus 5
      // low-pagerank leaf helpers nobody calls. MAX = aHub's high pagerank;
      // AVG would be pulled down by the 5 leaves → ahub would rank below bhub.
      await fsp.writeFile(
        path.join(clean, "ahub.ts"),
        "function aHub() { return 1; }\n" +
          "function aLeaf1() { return 1; }\n" +
          "function aLeaf2() { return 1; }\n" +
          "function aLeaf3() { return 1; }\n" +
          "function aLeaf4() { return 1; }\n" +
          "function aLeaf5() { return 1; }\n",
      );
      // bhub.ts: one medium-pagerank hub called by only 1 caller.
      await fsp.writeFile(path.join(clean, "bhub.ts"), "function bHub() { return 1; }\n");
      // External callers: 4 → aHub (high pagerank), 1 → bHub (medium).
      await fsp.writeFile(
        path.join(clean, "callers.ts"),
        "function ac1() { return aHub(); }\n" +
          "function ac2() { return aHub(); }\n" +
          "function ac3() { return aHub(); }\n" +
          "function ac4() { return aHub(); }\n" +
          "function bc1() { return bHub(); }\n",
      );

      const engine = await Engine.open(clean);
      await engine.index();
      await engine.rank();

      const probe = await engine.pack();
      const ahubFull = probe.files.find((f) => f.path === "ahub.ts")!.tokens;
      const bhubFull = probe.files.find((f) => f.path === "bhub.ts")!.tokens;
      // Budget fits exactly one of the two hub files at full (the larger one),
      // so the higher-importance file wins the full slot.
      const tight = Math.max(ahubFull, bhubFull);
      const result = await engine.pack({ tokenBudget: tight });
      expect(result.layerMap["ahub.ts"]).toBe("full");
      expect(result.layerMap["bhub.ts"]).not.toBe("full");
      await engine.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });
});

describe("Engine.stats — Dashboard data source (v2.5)", () => {
  it("returns full DashboardStats with correct counts after index()", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    const stats: DashboardStats = await engine.stats();

    expect(stats.index.files).toBeGreaterThan(0);
    expect(stats.index.symbols).toBeGreaterThan(0);
    expect(stats.index.edges).toBeGreaterThanOrEqual(0);
    expect(stats.index.chunks).toBeGreaterThan(0);
    expect(stats.index.dbSize).toBeGreaterThan(0);
    expect(stats.index.lastSync).toBeGreaterThan(0);
    await engine.close();
  });

  it("health: counts ok/degraded/failed/skipped correctly", async () => {
    await fsp.writeFile(path.join(dir, "data.md"), "# title\nsome prose\n");
    const engine = await Engine.open(dir);
    await engine.index();
    const stats = await engine.stats();

    expect(stats.health.ok).toBeGreaterThan(0);
    expect(stats.health.degraded).toBeGreaterThanOrEqual(1);
    expect(stats.health.failed).toBe(0);
    expect(stats.health.skipped).toBe(0);

    const total = stats.health.ok + stats.health.degraded + stats.health.failed + stats.health.skipped;
    expect(total).toBe(stats.index.files);
    await engine.close();
  });

  it("languages: groups files by language", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    const stats = await engine.stats();

    expect(stats.languages.typescript).toBeGreaterThan(0);
    const totalFiles = Object.values(stats.languages).reduce((a, b) => a + b, 0);
    expect(totalFiles).toBe(stats.index.files);
    await engine.close();
  });

  it("tokenMap: treemap root has non-zero tokens from chunks.token_count", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    const stats = await engine.stats();

    expect(stats.tokenMap).toBeDefined();
    expect(stats.tokenMap.tokens).toBeGreaterThan(0);
    expect(stats.tokenMap.children).toBeDefined();
    expect(stats.tokenMap.children!.length).toBeGreaterThan(0);
    await engine.close();
  });

  it("syncQueue lists the changed (re-parsed) files after a first index()", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    const stats = await engine.stats();
    // First index() is an all-miss run, so every ingested file was parsed
    // and appears in syncQueue marked "parsed".
    expect(stats.syncQueue.length).toBeGreaterThan(0);
    for (const item of stats.syncQueue) {
      expect(item.status).toBe("parsed");
      expect(typeof item.path).toBe("string");
    }
    await engine.close();
  });

  it("syncState() persists across processes via the meta table", async () => {
    const e1 = await Engine.open(dir);
    await e1.index();
    await e1.close();

    // A fresh engine (new process would be the same) reads the persisted state.
    const e2 = await Engine.open(dir);
    const state = await e2.syncState();
    expect(state).not.toBeNull();
    expect(state!.filesProcessed).toBeGreaterThan(0);
    expect(state!.parseCacheMisses).toBeGreaterThan(0);
    expect(state!.durationMs).toBeGreaterThanOrEqual(0);
    expect(state!.timestamp).toBeGreaterThan(0);
    expect(Array.isArray(state!.changedFiles)).toBe(true);
    await e2.close();
  });

  it("second index() is all-hits: syncState reports 0 misses, empty changedFiles", async () => {
    const e1 = await Engine.open(dir);
    await e1.index();
    await e1.close();

    const e2 = await Engine.open(dir);
    await e2.index();
    const state = await e2.syncState();
    expect(state!.parseCacheMisses).toBe(0);
    expect(state!.parseCacheHits).toBeGreaterThan(0);
    expect(state!.changedFiles).toEqual([]);
    const stats = await e2.stats();
    expect(stats.syncQueue).toEqual([]);
    await e2.close();
  });

  it("returns zeros/empty on a fresh engine with no index() (no throw)", async () => {
    const clean = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-stats-empty-"));
    try {
      const engine = await Engine.open(clean);
      const stats = await engine.stats();

      expect(stats.index.files).toBe(0);
      expect(stats.index.symbols).toBe(0);
      expect(stats.index.edges).toBe(0);
      expect(stats.index.chunks).toBe(0);
      expect(stats.index.lastSync).toBe(0);
      expect(stats.health.ok).toBe(0);
      expect(stats.health.degraded).toBe(0);
      expect(stats.health.failed).toBe(0);
      expect(stats.health.skipped).toBe(0);
      expect(stats.languages).toEqual({});
      expect(stats.tokenMap.tokens).toBe(0);
      expect(stats.syncQueue).toEqual([]);
      await engine.close();
    } finally {
      await fsp.rm(clean, { recursive: true, force: true });
    }
  });
});
