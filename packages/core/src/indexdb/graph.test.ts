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
    // Plain callers(helper, 2) would NOT reach caller2 — the drill-down is
    // what surfaces it. Assert the distinction explicitly.
    const plain = g.callers(helperId, 2);
    expect(ids(plain.nodes)).not.toContain(caller2Id);
    db.close();
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
