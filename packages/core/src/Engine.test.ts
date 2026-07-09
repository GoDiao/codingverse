import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "./Engine.js";
import { disposeParsers } from "./parse/index.js";
import { symbolId } from "./indexdb/ids.js";
import { STATE_DIR } from "@codingverse/shared";
import type { IndexStats, SearchHit, PackResult } from "@codingverse/shared";

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
