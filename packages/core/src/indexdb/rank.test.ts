import { describe, it, expect, afterAll } from "vitest";
import type { FileEntry, ParsedFile } from "@codingverse/shared";
import { IndexDb } from "./db.js";
import { IndexStore } from "./store.js";
import { RefResolver } from "./resolve.js";
import { PageRank } from "./rank.js";
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

const seed = async (
  files: Array<{ path: string; content: string }>,
): Promise<IndexDb> => {
  const entries = files.map((f) => mk(f.path, f.content));
  const parsed = await parseFiles(entries);
  const contents: Record<string, string> = {};
  for (const f of files) contents[f.path] = f.content;
  const db = new IndexDb({ dbPath: ":memory:" });
  db.migrate();
  const store = new IndexStore(db);
  await store.write({ parsed, sources: srcMap(parsed, contents) });
  const resolver = new RefResolver(db);
  resolver.resolveAll();
  return db;
};

const rawPagerank = (db: IndexDb, id: string): number => {
  const row = db.db
    .prepare("SELECT pagerank FROM nodes WHERE id = ?")
    .get(id) as { pagerank: number | null } | undefined;
  return row?.pagerank ?? 0;
};

describe("PageRank — convergence", () => {
  it("converges on A→B→C, A→C with iterations < maxIter", async () => {
    const src = `function a() { b(); c(); }
function b() { return c(); }
function c() { return 1; }
`;
    const db = await seed([{ path: "conv.ts", content: src }]);
    const pr = new PageRank(db);
    const stats = pr.rank();

    expect(stats.converged).toBe(true);
    expect(stats.iterations).toBeLessThan(100);
    expect(stats.iterations).toBeGreaterThan(0);
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(3);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    db.close();
  });
});

describe("PageRank — writeback", () => {
  it("persists pagerank > 0 to nodes for a node with out-degree", async () => {
    const src = `function a() { b(); c(); }
function b() { return c(); }
function c() { return 1; }
`;
    const db = await seed([{ path: "wb.ts", content: src }]);
    const aId = symbolId("wb.ts", "a");
    const pr = new PageRank(db);
    pr.rank();

    expect(rawPagerank(db, aId)).toBeGreaterThan(0);
    db.close();
  });
});

describe("PageRank — hub scores higher than leaf", () => {
  it("hub (called by 3) outranks leaf (no incoming)", async () => {
    const src = `function f1() { return hub(); }
function f2() { return hub(); }
function f3() { return hub(); }
function hub() { return 1; }
function leaf() { return 1; }
`;
    const db = await seed([{ path: "hub.ts", content: src }]);
    const hubId = symbolId("hub.ts", "hub");
    const leafId = symbolId("hub.ts", "leaf");
    const pr = new PageRank(db);
    pr.rank();

    expect(pr.get(hubId)).toBeGreaterThan(pr.get(leafId));
    db.close();
  });
});

describe("PageRank — private source down-weight", () => {
  it("target reachable only via _private ranks lower than via public fn", async () => {
    const src = `function caller() { publicFn(); _private(); }
function publicFn() { return target1(); }
function _private() { return target2(); }
function target1() { return 1; }
function target2() { return 1; }
`;
    const db = await seed([{ path: "priv.ts", content: src }]);
    const t1Id = symbolId("priv.ts", "target1");
    const t2Id = symbolId("priv.ts", "target2");
    const pr = new PageRank(db);
    pr.rank();

    expect(pr.get(t2Id)).toBeLessThan(pr.get(t1Id));
    db.close();
  });
});

describe("PageRank — over-heated name down-weight", () => {
  it("target called only by an over-heated name (6 files) ranks lower than by a unique name", async () => {
    const files: Array<{ path: string; content: string }> = [];
    for (let i = 1; i <= 6; i++) {
      files.push({
        path: `oh${i}.ts`,
        content:
          i === 1
            ? `function commonName() { return overheatedTarget(); }\nfunction overheatedTarget() { return 1; }\n`
            : `function commonName() { return overheatedTarget(); }\n`,
      });
    }
    files.push({
      path: "oh7.ts",
      content: `function uniqueName() { return uniqueTarget(); }\nfunction uniqueTarget() { return 1; }\n`,
    });
    const db = await seed(files);
    const ohTargetId = symbolId("oh1.ts", "overheatedTarget");
    const uniqTargetId = symbolId("oh7.ts", "uniqueTarget");
    const pr = new PageRank(db);
    pr.rank();

    expect(pr.get(ohTargetId)).toBeLessThan(pr.get(uniqTargetId));
    db.close();
  });
});

describe("PageRank — empty graph (no edges)", () => {
  it("assigns uniform 1/N to all nodes and converges on first iter", async () => {
    const src = `function a() { return 1; }
function b() { return 2; }
function c() { return 3; }
`;
    const db = await seed([{ path: "empty.ts", content: src }]);
    const aId = symbolId("empty.ts", "a");
    const bId = symbolId("empty.ts", "b");
    const cId = symbolId("empty.ts", "c");
    const pr = new PageRank(db);
    const stats = pr.rank();

    expect(stats.converged).toBe(true);
    expect(stats.edgeCount).toBe(0);
    expect(stats.nodeCount).toBe(3);
    expect(pr.get(aId)).toBeCloseTo(1 / 3, 10);
    expect(pr.get(bId)).toBeCloseTo(1 / 3, 10);
    expect(pr.get(cId)).toBeCloseTo(1 / 3, 10);
    db.close();
  });
});

describe("PageRank — N=0 (no nodes)", () => {
  it("returns {iterations:0, converged:true, nodeCount:0}", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const pr = new PageRank(db);
    const stats = pr.rank();

    expect(stats.iterations).toBe(0);
    expect(stats.converged).toBe(true);
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    db.close();
  });
});

describe("PageRank — fallback signal", () => {
  it("get returns 0 before rank is computed", async () => {
    const src = `function a() { return b(); }
function b() { return 1; }
`;
    const db = await seed([{ path: "fb.ts", content: src }]);
    const aId = symbolId("fb.ts", "a");
    const pr = new PageRank(db);

    expect(pr.get(aId)).toBe(0);
    db.close();
  });
});

describe("PageRank — topN", () => {
  it("returns N nodes sorted by pagerank desc", async () => {
    const src = `function f1() { return hub(); }
function f2() { return hub(); }
function f3() { return hub(); }
function hub() { return 1; }
function leaf() { return 1; }
`;
    const db = await seed([{ path: "top.ts", content: src }]);
    const pr = new PageRank(db);
    pr.rank();

    const top = pr.topN(3);
    expect(top).toHaveLength(3);
    expect(top[0].pagerank).toBeGreaterThanOrEqual(top[1].pagerank);
    expect(top[1].pagerank).toBeGreaterThanOrEqual(top[2].pagerank);
    db.close();
  });

  it("topN scoped to a file returns only nodes in that file", async () => {
    const src = `function f1() { return hub(); }
function f2() { return hub(); }
function hub() { return 1; }
`;
    const db = await seed([{ path: "topf.ts", content: src }]);
    const pr = new PageRank(db);
    pr.rank();

    const top = pr.topN(10, "topf.ts");
    expect(top.length).toBe(3);
    for (const row of top) {
      expect(row.pagerank).toBeGreaterThanOrEqual(0);
    }
    db.close();
  });
});

describe("PageRank — idempotent", () => {
  it("rank twice yields consistent pagerank values", async () => {
    const src = `function a() { b(); c(); }
function b() { return c(); }
function c() { return 1; }
`;
    const db = await seed([{ path: "idem.ts", content: src }]);
    const aId = symbolId("idem.ts", "a");
    const bId = symbolId("idem.ts", "b");
    const cId = symbolId("idem.ts", "c");
    const pr = new PageRank(db);
    pr.rank();
    const r1 = { a: pr.get(aId), b: pr.get(bId), c: pr.get(cId) };
    pr.rank();
    const r2 = { a: pr.get(aId), b: pr.get(bId), c: pr.get(cId) };

    expect(r2.a).toBeCloseTo(r1.a, 10);
    expect(r2.b).toBeCloseTo(r1.b, 10);
    expect(r2.c).toBeCloseTo(r1.c, 10);
    db.close();
  });
});

// ── Direct-insert helpers for rank edge-case fixtures ───────────────────────
// These tests construct specific graph shapes (self-loops, orphan edges,
// multi-edges) that are easier to insert directly via SQL than to produce
// via real TS parsing. PageRank reads from nodes/edges tables regardless.

function insertRankNode(
  db: IndexDb,
  filePath: string,
  name: string,
  startLine: number,
): string {
  const id = symbolId(filePath, name);
  db.db
    .prepare(
      `INSERT INTO nodes
        (id, kind, name, qualified_name, file_path, language,
         start_line, end_line, start_byte, end_byte,
         signature, docstring, visibility, pagerank, updated_at)
       VALUES (?, 'function', ?, ?, ?, 'typescript', ?, ?, 0, 0, NULL, NULL, NULL, 0, ?)`,
    )
    .run(id, name, name, filePath, startLine, startLine, Date.now());
  return id;
}

function insertRankEdge(
  db: IndexDb,
  source: string,
  target: string,
  line = 1,
): void {
  db.db
    .prepare(
      `INSERT INTO edges (source, target, kind, line, col, provenance)
       VALUES (?, ?, 'calls', ?, NULL, 'test')`,
    )
    .run(source, target, line);
}

describe("PageRank — multi-edge conservation", () => {
  it("B's pagerank is ~equal whether A→B has 1 edge or 2 (multiplicity conservation)", () => {
    // rank.ts:161 out-degree counts multiplicity: A→B twice → outDegree[A]=2,
    // each edge weight = mul/2, B receives 2*(mul/2)*d*rank[A] = mul*d*rank[A]
    // — same total as a single edge. This pins the conservation so a future
    // refactor can't silently switch to dedupe.

    // Scenario (a): one edge A→B.
    const dbA = new IndexDb({ dbPath: ":memory:" });
    dbA.migrate();
    const aIdA = insertRankNode(dbA, "mul.ts", "a", 1);
    const bIdA = insertRankNode(dbA, "mul.ts", "b", 2);
    insertRankEdge(dbA, aIdA, bIdA, 1);
    const prA = new PageRank(dbA);
    prA.rank();
    const rankBSingle = prA.get(bIdA);
    dbA.close();

    // Scenario (b): two edges A→B (same pair, different lines).
    const dbB = new IndexDb({ dbPath: ":memory:" });
    dbB.migrate();
    const aIdB = insertRankNode(dbB, "mul.ts", "a", 1);
    const bIdB = insertRankNode(dbB, "mul.ts", "b", 2);
    insertRankEdge(dbB, aIdB, bIdB, 1);
    insertRankEdge(dbB, aIdB, bIdB, 2);
    const prB = new PageRank(dbB);
    const statsB = prB.rank();
    const rankBDouble = prB.get(bIdB);
    dbB.close();

    // edgeCount counts multiplicity (2 edges in scenario b).
    expect(statsB.edgeCount).toBe(2);
    // B's pagerank is conserved — same total regardless of multiplicity.
    expect(rankBDouble).toBeCloseTo(rankBSingle, 5);
  });
});

describe("PageRank — edge cases", () => {
  it("N=1: single node, no edges → pagerank=1.0, converged=true", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const aId = insertRankNode(db, "single.ts", "a", 1);
    const pr = new PageRank(db);
    const stats = pr.rank();

    expect(stats.nodeCount).toBe(1);
    expect(stats.edgeCount).toBe(0);
    expect(stats.converged).toBe(true);
    // 1/N = 1/1 = 1.0, and with no out-edges A is dangling so it receives
    // the full dangling redistribution → stays at 1.0.
    expect(pr.get(aId)).toBeCloseTo(1.0, 10);
    db.close();
  });

  it("self-loop (A→A): rank() converges with a finite pagerank (no NaN/inf)", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const aId = insertRankNode(db, "loop.ts", "a", 1);
    insertRankEdge(db, aId, aId, 1);
    const pr = new PageRank(db);
    const stats = pr.rank();

    expect(stats.nodeCount).toBe(1);
    // Must not infinite-loop or produce NaN/Infinity.
    expect(Number.isFinite(pr.get(aId))).toBe(true);
    db.close();
  });

  it("disconnected components (A→B, C→D): converges, all nodes non-zero", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const aId = insertRankNode(db, "disc.ts", "a", 1);
    const bId = insertRankNode(db, "disc.ts", "b", 2);
    const cId = insertRankNode(db, "disc.ts", "c", 4);
    const dId = insertRankNode(db, "disc.ts", "d", 5);
    insertRankEdge(db, aId, bId, 1);
    insertRankEdge(db, cId, dId, 4);
    const pr = new PageRank(db);
    const stats = pr.rank();

    expect(stats.converged).toBe(true);
    expect(stats.nodeCount).toBe(4);
    expect(pr.get(aId)).toBeGreaterThan(0);
    expect(pr.get(bId)).toBeGreaterThan(0);
    expect(pr.get(cId)).toBeGreaterThan(0);
    expect(pr.get(dId)).toBeGreaterThan(0);
    db.close();
  });

  it("orphan edge: skips edges whose source/target is not in nodes, reports filtered edgeCount", () => {
    // rank.ts:160 `if (!indexById.has(src) || !indexById.has(tgt)) continue`
    // filters edges referencing non-existent nodes. With FK ON such edges
    // can't normally exist, but we insert one via PRAGMA foreign_keys=OFF to
    // verify the defensive filter.
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const aId = insertRankNode(db, "orphan.ts", "a", 1);
    const bId = insertRankNode(db, "orphan.ts", "b", 2);
    insertRankEdge(db, aId, bId, 1);

    // Insert an orphan edge: disable FK, insert, re-enable. The edge
    // references node ids that don't exist in the nodes table.
    db.db.exec("PRAGMA foreign_keys=OFF");
    db.db
      .prepare(
        `INSERT INTO edges (source, target, kind, line, col, provenance)
         VALUES (?, ?, 'calls', 1, NULL, 'test')`,
      )
      .run("nonexistent_src_12345", "nonexistent_tgt_67890");
    db.db.exec("PRAGMA foreign_keys=ON");

    const rawCount = (
      db.db.prepare("SELECT COUNT(*) AS n FROM edges WHERE kind = 'calls'").get() as
        { n: number }
    ).n;
    expect(rawCount).toBe(2);

    const pr = new PageRank(db);
    const stats = pr.rank();
    // edgeCount is the FILTERED count (only the valid A→B edge), less than
    // the raw count. This pins the orphan-filter behavior.
    expect(stats.edgeCount).toBe(1);
    expect(stats.edgeCount).toBeLessThan(rawCount);
    // rank() must not crash — it completes.
    expect(stats.nodeCount).toBe(2);
    db.close();
  });
});
