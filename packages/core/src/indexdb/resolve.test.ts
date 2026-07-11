import { describe, it, expect, afterAll } from "vitest";
import type { FileEntry, ParsedFile } from "@codingverse/shared";
import { IndexDb } from "./db.js";
import { IndexStore } from "./store.js";
import { RefResolver } from "./resolve.js";
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

interface EdgeRow {
  source: string;
  target: string;
  kind: string;
  line: number | null;
  col: number | null;
  provenance: string;
}

const edges = (db: IndexDb): EdgeRow[] =>
  db.db
    .prepare("SELECT source, target, kind, line, col, provenance FROM edges ORDER BY id")
    .all() as EdgeRow[];

const edgeCount = (db: IndexDb): number =>
  (db.db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number }).n;

const unresolvedCount = (db: IndexDb): number =>
  (db.db.prepare("SELECT COUNT(*) AS n FROM unresolved_refs").get() as { n: number }).n;

const seed = async (
  files: Array<{ path: string; content: string }>,
): Promise<{ db: IndexDb; parsed: ParsedFile[] }> => {
  const entries = files.map((f) => mk(f.path, f.content));
  const parsed = await parseFiles(entries);
  const contents: Record<string, string> = {};
  for (const f of files) contents[f.path] = f.content;
  const db = new IndexDb({ dbPath: ":memory:" });
  db.migrate();
  const store = new IndexStore(db);
  await store.write({ parsed, sources: srcMap(parsed, contents) });
  return { db, parsed };
};

describe("RefResolver resolveAll — same-file resolution", () => {
  it("creates an edge from caller to callee in the same file with provenance=heuristic", async () => {
    const src = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const { db, parsed } = await seed([{ path: "calls.ts", content: src }]);
    const aId = symbolId("calls.ts", "a");
    const bId = symbolId("calls.ts", "b");
    expect(parsed[0]!.symbols.map((s) => s.name).sort()).toEqual(["a", "b"]);

    const resolver = new RefResolver(db);
    const stats = resolver.resolveAll();

    expect(stats.resolved).toBe(1);
    expect(stats.unresolved).toBe(0);
    expect(edgeCount(db)).toBe(1);
    const rows = edges(db);
    expect(rows[0]!.source).toBe(aId);
    expect(rows[0]!.target).toBe(bId);
    expect(rows[0]!.kind).toBe("calls");
    expect(rows[0]!.provenance).toBe("heuristic");
    expect(rows[0]!.line).toBe(1);
    db.close();
  });
});

describe("RefResolver resolveAll — cross-file same-language resolution", () => {
  it("falls back to a global same-language match when no same-file node exists", async () => {
    const file1 = `function a() { return b(); }\n`;
    const file2 = `export function b() { return 1; }\n`;
    const { db } = await seed([
      { path: "file1.ts", content: file1 },
      { path: "file2.ts", content: file2 },
    ]);
    const aId = symbolId("file1.ts", "a");
    const bId = symbolId("file2.ts", "b");

    const resolver = new RefResolver(db);
    const stats = resolver.resolveAll();

    expect(stats.resolved).toBe(1);
    expect(stats.unresolved).toBe(0);
    expect(edgeCount(db)).toBe(1);
    const rows = edges(db);
    expect(rows[0]!.source).toBe(aId);
    expect(rows[0]!.target).toBe(bId);
    expect(rows[0]!.kind).toBe("calls");
    expect(rows[0]!.provenance).toBe("heuristic");
    db.close();
  });
});

describe("RefResolver resolveAll — same-name disambiguation", () => {
  it("prefers the same-file definition over a global namesake", async () => {
    const file1 = `function format() { return 1; }\nfunction caller() { return format(); }\n`;
    const file2 = `export function format() { return 2; }\n`;
    const { db } = await seed([
      { path: "file1.ts", content: file1 },
      { path: "file2.ts", content: file2 },
    ]);
    const callerId = symbolId("file1.ts", "caller");
    const formatLocal = symbolId("file1.ts", "format");
    const formatRemote = symbolId("file2.ts", "format");

    const resolver = new RefResolver(db);
    const stats = resolver.resolveAll();

    expect(stats.resolved).toBe(1);
    expect(stats.unresolved).toBe(0);
    expect(edgeCount(db)).toBe(1);
    const rows = edges(db);
    expect(rows[0]!.source).toBe(callerId);
    expect(rows[0]!.target).toBe(formatLocal);
    expect(rows[0]!.target).not.toBe(formatRemote);
    db.close();
  });
});

describe("RefResolver resolveAll — unmatched ref", () => {
  it("leaves a ref with no matching node unresolved and creates no edge", async () => {
    const src = `function a() { return nonexistent(); }\n`;
    const { db } = await seed([{ path: "unmatched.ts", content: src }]);

    const resolver = new RefResolver(db);
    const stats = resolver.resolveAll();

    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
    expect(edgeCount(db)).toBe(0);
    // The ref is retained in unresolved_refs for Dashboard / v2 SCIP.
    expect(unresolvedCount(db)).toBe(1);
    db.close();
  });
});

describe("RefResolver resolveAll — null from_node_id skipped", () => {
  it("skips a ref whose from_node_id is NULL even when the name matches a node", async () => {
    const src = `function runThing() { return 1; }\nrunThing();\n`;
    const { db } = await seed([{ path: "nullsrc.ts", content: src }]);
    // Confirm the standalone call is outside the function range → NULL source.
    const refRow = db.db
      .prepare("SELECT from_node_id FROM unresolved_refs WHERE reference_name = ?")
      .get("runThing") as { from_node_id: string | null } | undefined;
    expect(refRow).toBeDefined();
    expect(refRow!.from_node_id).toBeNull();

    const resolver = new RefResolver(db);
    const stats = resolver.resolveAll();

    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
    expect(edgeCount(db)).toBe(0);
    db.close();
  });
});

describe("RefResolver resolveAll — dedup", () => {
  it("writes only one edge for two identical refs (same source/target/kind/line)", async () => {
    const src = `function a() { b(); b(); }\nfunction b() { return 1; }\n`;
    const { db } = await seed([{ path: "dup.ts", content: src }]);

    const resolver = new RefResolver(db);
    const stats = resolver.resolveAll();

    // Both refs match (a→b, calls, line 1) → resolved=2, but one edge row.
    expect(stats.resolved).toBe(2);
    expect(stats.unresolved).toBe(0);
    expect(edgeCount(db)).toBe(1);
    const rows = edges(db);
    expect(rows[0]!.source).toBe(symbolId("dup.ts", "a"));
    expect(rows[0]!.target).toBe(symbolId("dup.ts", "b"));
    expect(rows[0]!.kind).toBe("calls");
    expect(rows[0]!.provenance).toBe("heuristic");
    expect(rows[0]!.line).toBe(1);
    db.close();
  });
});

describe("RefResolver resolveAll — idempotent re-run", () => {
  it("does not duplicate edges when resolveAll is called twice", async () => {
    const src = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const { db } = await seed([{ path: "idem.ts", content: src }]);

    const resolver = new RefResolver(db);
    const stats1 = resolver.resolveAll();
    const stats2 = resolver.resolveAll();

    expect(stats1.resolved).toBe(1);
    expect(edgeCount(db)).toBe(1);
    // Second run: ref still matches → resolved, but edge exists → no dup.
    expect(stats2.resolved).toBe(1);
    expect(stats2.unresolved).toBe(0);
    expect(edgeCount(db)).toBe(1);
    db.close();
  });
});

describe("RefResolver resolveAll — transaction safety (ROLLBACK on mid-loop failure)", () => {
  it("rethrows and rolls back pending inserts when an edge INSERT fails mid-loop", async () => {
    const file1 = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const file2 = `export function c() { return 2; }\n`;
    const { db } = await seed([
      { path: "file1.ts", content: file1 },
      { path: "file2.ts", content: file2 },
    ]);
    const aId = symbolId("file1.ts", "a");

    // Append a synthetic ref (a→c, kind='boom') whose edge INSERT aborts via a
    // trigger. The real ref a→b (kind='calls', lower rowid) is processed first:
    // it resolves and inserts an edge that stays pending (uncommitted) inside
    // the resolver's BEGIN…COMMIT. The synthetic ref a→c resolves to node c,
    // then its INSERT fires RAISE(ABORT) → the catch branch must ROLLBACK,
    // discarding the pending a→b edge. Proves the ROLLBACK path actually undoes
    // partial writes rather than silently leaving dangling rows.
    db.db
      .prepare(
        "INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, file_path, language) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(aId, "c", "boom", 1, "file1.ts", "typescript");
    db.db.exec(
      "CREATE TRIGGER fail_boom BEFORE INSERT ON edges WHEN new.kind = 'boom' BEGIN SELECT RAISE(ABORT, 'synthetic mid-loop failure'); END",
    );

    const resolver = new RefResolver(db);
    expect(() => resolver.resolveAll()).toThrow();

    // ROLLBACK must have discarded the pending a→b edge → zero edges.
    expect(edgeCount(db)).toBe(0);
    // resolve never mutates unresolved_refs → both the real and synthetic ref remain.
    expect(unresolvedCount(db)).toBe(2);
    db.close();
  });
});
