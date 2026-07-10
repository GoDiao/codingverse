import { describe, it, expect, afterAll } from "vitest";
import type { FileEntry, ParsedFile, SymbolNode } from "@codingverse/shared";
import { IndexDb } from "./db.js";
import { IndexStore } from "./store.js";
import { RefResolver } from "./resolve.js";
import { CallGraph } from "./graph.js";
import { symbolId } from "./ids.js";
import { parseFiles, disposeParsers } from "../parse/index.js";

const mk = (path: string, content: string): FileEntry => ({
  path,
  absPath: `/tmp/${path}`,
  content,
  size: content.length,
});

const srcMap = (parsed: ParsedFile[], contents: Record<string, string>): Map<string, string> => {
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
  store.write({ parsed, sources: srcMap(parsed, contents) });
  const resolver = new RefResolver(db);
  resolver.resolveAll();
  return db;
};

const ids = (nodes: SymbolNode[]): string[] => nodes.map((n) => n.id);

describe("CallGraph callers — simple chain", () => {
  it("returns [C, B, A] for callers(C, 2) in A→B→C with edges and byDepth", async () => {
    const src = `function a() { return b(); }\nfunction b() { return c(); }\nfunction c() { return 1; }\n`;
    const db = await seed([{ path: "chain.ts", content: src }]);
    const aId = symbolId("chain.ts", "a");
    const bId = symbolId("chain.ts", "b");
    const cId = symbolId("chain.ts", "c");
    const g = new CallGraph(db);

    const res = g.callers(cId, 2);

    expect(ids(res.nodes)).toEqual([cId, bId, aId]);
    expect(res.edges).toHaveLength(2);
    expect(res.byDepth).toHaveLength(3);
    expect(ids(res.byDepth[0]!)).toEqual([cId]);
    expect(ids(res.byDepth[1]!)).toEqual([bId]);
    expect(ids(res.byDepth[2]!)).toEqual([aId]);
    db.close();
  });
});

describe("CallGraph callees — simple chain", () => {
  it("returns [A, B, C] for callees(A, 2) in A→B→C with edges and byDepth", async () => {
    const src = `function a() { return b(); }\nfunction b() { return c(); }\nfunction c() { return 1; }\n`;
    const db = await seed([{ path: "chain.ts", content: src }]);
    const aId = symbolId("chain.ts", "a");
    const bId = symbolId("chain.ts", "b");
    const cId = symbolId("chain.ts", "c");
    const g = new CallGraph(db);

    const res = g.callees(aId, 2);

    expect(ids(res.nodes)).toEqual([aId, bId, cId]);
    expect(res.edges).toHaveLength(2);
    expect(res.byDepth).toHaveLength(3);
    expect(ids(res.byDepth[0]!)).toEqual([aId]);
    expect(ids(res.byDepth[1]!)).toEqual([bId]);
    expect(ids(res.byDepth[2]!)).toEqual([cId]);
    db.close();
  });
});

describe("CallGraph callers — depth truncation", () => {
  it("callers(C, 1) returns only [C, B], not A", async () => {
    const src = `function a() { return b(); }\nfunction b() { return c(); }\nfunction c() { return 1; }\n`;
    const db = await seed([{ path: "chain.ts", content: src }]);
    const bId = symbolId("chain.ts", "b");
    const cId = symbolId("chain.ts", "c");
    const g = new CallGraph(db);

    const res = g.callers(cId, 1);

    expect(ids(res.nodes)).toEqual([cId, bId]);
    expect(res.edges).toHaveLength(1);
    expect(res.byDepth).toHaveLength(2);
    expect(ids(res.byDepth[1]!)).toEqual([bId]);
    db.close();
  });
});

describe("CallGraph impact — container drill-down", () => {
  it("impact(helper, 2) includes caller2 via X::n sibling drill-down", async () => {
    // m and n on separate lines so v1's line-based findInnermostSymbol
    // assigns helper→X::m and other→X::n correctly (single-line class body
    // would collide both methods onto line 1 and mis-assign the helper ref).
    const src = `class X {
  m() { helper(); }
  n() { other(); }
}
function helper() { return 1; }
function other() { return 2; }
function caller2() { const x = new X(); return x.n(); }
`;
    const db = await seed([{ path: "cls.ts", content: src }]);
    const helperId = symbolId("cls.ts", "helper");
    const caller2Id = symbolId("cls.ts", "caller2");
    const xmId = symbolId("cls.ts", "X::m");
    const xnId = symbolId("cls.ts", "X::n");
    const g = new CallGraph(db);

    const res = g.impact(helperId, 2);

    const nodeIds = ids(res.nodes);
    expect(nodeIds).toContain(helperId);
    expect(nodeIds).toContain(xmId);
    expect(nodeIds).toContain(xnId);
    expect(nodeIds).toContain(caller2Id);
    // Same-depth invariant: the drill-down adds the sibling's caller at
    // the SAME depth it discovered the sibling (not depth+1). caller2 is
    // reached via X::n's drill-down at depth 1, so it must sit in
    // byDepth[1]. A regression that pushed it to byDepth[2] would still
    // pass the `toContain` above but break this pin.
    expect(ids(res.byDepth[1]!)).toContain(caller2Id);
    // Plain callers(helper, 2) would NOT reach caller2 — the drill-down is
    // what surfaces it. Assert the distinction explicitly.
    const plain = g.callers(helperId, 2);
    expect(ids(plain.nodes)).not.toContain(caller2Id);
    db.close();
  });

  it("impact(<container-method>, 2) surfaces siblings' callers at depth 1 via the start-node pre-step", async () => {
    // X::m has NO direct callers, so without the start-node pre-step the
    // BFS would stall at depth 0 and never reach X::n or userOfN. The
    // pre-step seeds X::m's siblings (X::n) into layer 1's reverse step,
    // so userOfN (who calls X::n) surfaces at depth 1.
    const src = `class X {
  m() {}
  n() { userOfN(); }
}
function userOfN() { const x = new X(); return x.n(); }
`;
    const db = await seed([{ path: "prestep.ts", content: src }]);
    const xmId = symbolId("prestep.ts", "X::m");
    const xnId = symbolId("prestep.ts", "X::n");
    const userOfNId = symbolId("prestep.ts", "userOfN");
    const g = new CallGraph(db);

    const res = g.impact(xmId, 2);

    const nodeIds = ids(res.nodes);
    expect(nodeIds).toContain(xmId);
    expect(nodeIds).toContain(xnId);
    expect(nodeIds).toContain(userOfNId);
    // Same-depth pin: X::n and userOfN both surface at depth 1 (the
    // pre-step + its reverse step), not depth 2.
    expect(ids(res.byDepth[1]!)).toContain(xnId);
    expect(ids(res.byDepth[1]!)).toContain(userOfNId);
    // Sanity: X::m genuinely has no direct callers, so a plain callers
    // traversal returns only X::m — proving this test exercises the
    // pre-step, not ordinary reverse BFS.
    const plain = g.callers(xmId, 2);
    expect(ids(plain.nodes)).toEqual([xmId]);
    db.close();
  });
});

describe("CallGraph impact — cap truncation flag", () => {
  it("sets truncated=true when a drill-down layer exceeds CONTAINER_DRILL_DOWN_CAP", async () => {
    // Build a class with 60 methods, each called by a distinct top-level
    // caller, plus one shared target helper called by method0. impact(helper)
    // reverse-steps to method0 (depth 1), drills into method0's container X
    // (60 siblings), and tries to pull each sibling's caller — well past the
    // 50-node cap, so `truncated` must be true.
    const methods: string[] = [];
    const callers: string[] = [];
    for (let i = 0; i < 60; i++) {
      methods.push(`  m${i}() { c${i}(); }`);
      callers.push(`function c${i}() { return ${i}; }`);
    }
    methods[0] = `  m0() { helper(); c0(); }`;
    const src = `class X {
${methods.join("\n")}
}
function helper() { return 1; }
${callers.join("\n")}
`;
    const db = await seed([{ path: "big.ts", content: src }]);
    const helperId = symbolId("big.ts", "helper");
    const g = new CallGraph(db);

    const res = g.impact(helperId, 2);

    expect(res.truncated).toBe(true);
    // Small-fixture control: the same call on the small impact fixture
    // (a few nodes, no cap hit) must NOT set truncated.
    const smallSrc = `class X {
  m() { helper(); }
  n() { other(); }
}
function helper() { return 1; }
function other() { return 2; }
function caller2() { const x = new X(); return x.n(); }
`;
    const smallDb = await seed([{ path: "small.ts", content: smallSrc }]);
    const smallRes = new CallGraph(smallDb).impact(symbolId("small.ts", "helper"), 2);
    expect(smallRes.truncated).toBeFalsy();
    db.close();
    smallDb.close();
  });
});

describe("CallGraph — dedup", () => {
  it("callers(B) returns [A] once with one edge for two same-line refs", async () => {
    const src = `function a() { b(); b(); }\nfunction b() { return 1; }\n`;
    const db = await seed([{ path: "dup.ts", content: src }]);
    const aId = symbolId("dup.ts", "a");
    const bId = symbolId("dup.ts", "b");
    const g = new CallGraph(db);

    const res = g.callers(bId, 1);

    expect(ids(res.nodes)).toEqual([bId, aId]);
    expect(res.edges).toHaveLength(1);
    expect(res.byDepth).toHaveLength(2);
    expect(ids(res.byDepth[1]!)).toEqual([aId]);
    db.close();
  });
});

describe("CallGraph — isolated node", () => {
  it("returns {nodes:[self], edges:[], byDepth:[[self]]} for a node with no edges", async () => {
    const src = `function lone() { return 1; }\n`;
    const db = await seed([{ path: "lone.ts", content: src }]);
    const loneId = symbolId("lone.ts", "lone");
    const g = new CallGraph(db);

    const res = g.callers(loneId, 3);

    expect(ids(res.nodes)).toEqual([loneId]);
    expect(res.edges).toHaveLength(0);
    expect(res.byDepth).toHaveLength(1);
    expect(ids(res.byDepth[0]!)).toEqual([loneId]);
    db.close();
  });
});

describe("CallGraph — unknown nodeId throws", () => {
  it("throws Unknown node id for a nodeId not in the nodes table", async () => {
    const src = `function a() { return 1; }\n`;
    const db = await seed([{ path: "a.ts", content: src }]);
    const g = new CallGraph(db);

    expect(() => g.callers("nonexistent1234567890abcdef", 1)).toThrow(/Unknown node id/);
    db.close();
  });
});

describe("CallGraph — SymbolNode shape (camelCase fields)", () => {
  it("returns nodes with filePath, startLine, qualifiedName in camelCase", async () => {
    const src = `class X { m() { helper(); } }
function helper() { return 1; }
`;
    const db = await seed([{ path: "shape.ts", content: src }]);
    const xmId = symbolId("shape.ts", "X::m");
    const g = new CallGraph(db);

    const res = g.callers(symbolId("shape.ts", "helper"), 1);

    const xmNode = res.nodes.find((n) => n.id === xmId);
    expect(xmNode).toBeDefined();
    expect(xmNode!.filePath).toBe("shape.ts");
    expect(xmNode!.startLine).toBeTypeOf("number");
    expect(xmNode!.qualifiedName).toBe("X::m");
    expect((xmNode as unknown as Record<string, unknown>).file_path).toBeUndefined();
    expect((xmNode as unknown as Record<string, unknown>).start_line).toBeUndefined();
    db.close();
  });
});

// ── Direct-insert helpers for qualified_name-specific fixtures ──────────────
// Real TS parsing doesn't easily produce nested-class qualified names or
// `_`-containing class names, so A1/A2 insert nodes + edges directly via SQL
// (same pattern as scip.test.ts). The CallGraph reads from nodes/edges tables
// regardless of how they were populated.

function insertGraphNode(
  db: IndexDb,
  filePath: string,
  qualifiedName: string,
  startLine: number,
): string {
  const id = symbolId(filePath, qualifiedName);
  const name = qualifiedName.split("::").pop() ?? qualifiedName;
  db.db
    .prepare(
      `INSERT INTO nodes
        (id, kind, name, qualified_name, file_path, language,
         start_line, end_line, start_byte, end_byte,
         signature, docstring, visibility, pagerank, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?)`,
    )
    .run(
      id,
      qualifiedName.includes("::") ? "method" : "function",
      name,
      qualifiedName,
      filePath,
      "typescript",
      startLine,
      startLine,
      0,
      0,
      Date.now(),
    );
  return id;
}

function insertGraphEdge(
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

describe("CallGraph impact — nested scope (lastIndexOf ::)", () => {
  it("impact(Outer::Inner::m, 2) drills into Outer::Inner siblings, not Outer::Other", () => {
    // graph.ts:219 uses lastIndexOf("::") to extract the scope from a
    // qualified_name with multiple `::` separators. For `Outer::Inner::m`
    // the scope is `Outer::Inner` (pattern `Outer::Inner::%`), NOT `Outer`
    // (pattern `Outer::%`). The decoy `Outer::Other::p` would be a false
    // sibling if indexOf("::") were used instead — assert it's absent.
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const mId = insertGraphNode(db, "nest.ts", "Outer::Inner::m", 2);
    const nId = insertGraphNode(db, "nest.ts", "Outer::Inner::n", 3);
    const pId = insertGraphNode(db, "nest.ts", "Outer::Other::p", 5);
    const callerNId = insertGraphNode(db, "nest.ts", "callerN", 7);
    insertGraphEdge(db, callerNId, nId, 7);

    const g = new CallGraph(db);
    const res = g.impact(mId, 2);
    const nodeIds = ids(res.nodes);

    expect(nodeIds).toContain(mId);
    expect(nodeIds).toContain(nId);
    expect(nodeIds).toContain(callerNId);
    // Decoy: `Outer::Other::p` shares the outer `Outer::` prefix but a
    // different inner scope. With lastIndexOf it's NOT a sibling; with
    // indexOf it would be. Asserting absence pins lastIndexOf.
    expect(nodeIds).not.toContain(pId);
    db.close();
  });
});

describe("CallGraph impact — LIKE escape (escapeLike)", () => {
  it("impact(My_Class::a, 2) finds My_Class::b sibling, not MyxClass::c", () => {
    // graph.ts:291 escapeLike escapes `_` so it matches literally in the
    // `LIKE ... ESCAPE '\'` siblings query. Without escaping, `_` is a
    // wildcard matching any single char, so `MyxClass::c` would be a false
    // sibling of `My_Class::a`.
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const aId = insertGraphNode(db, "esc.ts", "My_Class::a", 2);
    const bId = insertGraphNode(db, "esc.ts", "My_Class::b", 3);
    const myxClassCId = insertGraphNode(db, "esc.ts", "MyxClass::c", 5);
    const callerBId = insertGraphNode(db, "esc.ts", "callerB", 7);
    insertGraphEdge(db, callerBId, bId, 7);

    const g = new CallGraph(db);
    const res = g.impact(aId, 2);
    const nodeIds = ids(res.nodes);

    expect(nodeIds).toContain(aId);
    expect(nodeIds).toContain(bId);
    expect(nodeIds).toContain(callerBId);
    // Decoy: `MyxClass::c` would match `My_Class::%` if `_` were unescaped
    // (x matches the wildcard `_`). With escaping it's excluded.
    expect(nodeIds).not.toContain(myxClassCId);
    db.close();
  });
});
