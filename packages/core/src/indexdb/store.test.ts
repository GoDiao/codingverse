import { describe, it, expect, afterAll } from "vitest";
import type { FileEntry, ParsedFile, Chunk } from "@codingverse/shared";
import { IndexDb } from "./db.js";
import { IndexStore } from "./store.js";
import { symbolId } from "./ids.js";
import { gitBlobHash } from "../cache/index.js";
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

const count = (db: IndexDb, sql: string, ...params: unknown[]): number =>
  (db.db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get(...params) as { n: number }).n;

describe("IndexStore write — counts and FTS5", () => {
  it("persists nodes/chunks/files with correct counts and syncs FTS5", async () => {
    const A = `export function wizardry() { return "magic"; }\n`;
    const B = `export function sorcery() { return 42; }\n`;
    const parsed = await parseFiles([mk("a.ts", A), mk("b.ts", B)]);

    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    const stats = await store.write({ parsed, sources: srcMap(parsed, { "a.ts": A, "b.ts": B }) });

    expect(stats.files).toBe(2);
    expect(stats.nodes).toBe(parsed[0]!.symbols.length + parsed[1]!.symbols.length);
    expect(stats.chunks).toBe(parsed[0]!.chunks.length + parsed[1]!.chunks.length);
    expect(stats.unresolved).toBe(0);
    expect(stats.edges).toBe(0);

    expect(count(db, "nodes")).toBe(stats.nodes);
    expect(count(db, "chunks")).toBe(stats.chunks);
    expect(count(db, "files")).toBe(2);
    expect(count(db, "unresolved_refs")).toBe(0);

    const chunkHit = db.db
      .prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ?")
      .get("wizardry") as { id: string } | undefined;
    expect(chunkHit?.id).toBe(parsed[0]!.chunks[0]!.id);

    const nodeHit = db.db
      .prepare("SELECT id FROM nodes_fts WHERE nodes_fts MATCH ?")
      .get("wizardry") as { id: string } | undefined;
    expect(nodeHit?.id).toBe(symbolId("a.ts", "wizardry"));

    db.close();
  });
});

describe("IndexStore write — files table", () => {
  it("writes git_blob_hash matching gitBlobHash(content) and parse_status=ok", async () => {
    const A = `export function wizardry() { return "magic"; }\n`;
    const parsed = await parseFiles([mk("a.ts", A)]);
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "a.ts": A }) });

    const row = db.db
      .prepare("SELECT path, git_blob_hash, content_hash, language, size, node_count, parse_status FROM files WHERE path = ?")
      .get("a.ts") as {
        path: string;
        git_blob_hash: string;
        content_hash: string;
        language: string;
        size: number;
        node_count: number;
        parse_status: string;
      };
    expect(row.git_blob_hash).toBe(gitBlobHash(A));
    expect(row.content_hash).toBeTypeOf("string");
    expect(row.content_hash.length).toBeGreaterThan(0);
    expect(row.language).toBe("typescript");
    expect(row.size).toBe(Buffer.byteLength(A));
    expect(row.node_count).toBe(1);
    expect(row.parse_status).toBe("ok");
    db.close();
  });

  it("sets parse_status=degraded when parsed.degraded is true", async () => {
    const parsed = await parseFiles([mk("data.xyz", "some content\nhere\n")]);
    expect(parsed[0]!.degraded).toBe(true);
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "data.xyz": "some content\nhere\n" }) });

    const row = db.db
      .prepare("SELECT parse_status FROM files WHERE path = ?")
      .get("data.xyz") as { parse_status: string };
    expect(row.parse_status).toBe("degraded");
    db.close();
  });
});

describe("IndexStore write — unresolved_refs", () => {
  it("records from_node_id of the containing symbol (simple)", async () => {
    const src = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const parsed = await parseFiles([mk("calls.ts", src)]);
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "calls.ts": src }) });

    const rows = db.db
      .prepare("SELECT from_node_id, reference_name, reference_kind, line FROM unresolved_refs")
      .all() as Array<{
        from_node_id: string | null;
        reference_name: string;
        reference_kind: string;
        line: number;
      }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const refB = rows.find((r) => r.reference_name === "b");
    expect(refB).toBeDefined();
    expect(refB!.reference_kind).toBe("calls");
    expect(refB!.from_node_id).toBe(symbolId("calls.ts", "a"));
    expect(refB!.line).toBe(1);
    db.close();
  });

  it("records the innermost containing symbol as from_node_id (nested)", async () => {
    const src = `class C { m() { return b(); } }\nfunction b() { return 1; }\n`;
    const parsed = await parseFiles([mk("nest.ts", src)]);
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "nest.ts": src }) });

    const rows = db.db
      .prepare("SELECT from_node_id, reference_name FROM unresolved_refs WHERE reference_name = ?")
      .all("b") as Array<{ from_node_id: string | null; reference_name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.from_node_id).toBe(symbolId("nest.ts", "C::m"));
    db.close();
  });

  it("handles a ref at line 1 inside a single-line top-level symbol (no off-by-one)", async () => {
    const src = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const parsed = await parseFiles([mk("l1.ts", src)]);
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "l1.ts": src }) });

    const row = db.db
      .prepare("SELECT from_node_id, line FROM unresolved_refs WHERE reference_name = ?")
      .get("b") as { from_node_id: string | null; line: number };
    expect(row.line).toBe(1);
    expect(row.from_node_id).toBe(symbolId("l1.ts", "a"));
    db.close();
  });

  it("sets from_node_id NULL for a ref in a filler region between symbols", async () => {
    const src = `function a() { return 1; }\nrunThing();\nfunction b() { return 2; }\n`;
    const parsed = await parseFiles([mk("filler.ts", src)]);
    const aSym = parsed[0]!.symbols.find((s) => s.name === "a");
    const bSym = parsed[0]!.symbols.find((s) => s.name === "b");
    expect(aSym?.startLine).toBe(1);
    expect(aSym?.endLine).toBe(1);
    expect(bSym?.startLine).toBe(3);
    expect(bSym?.endLine).toBe(3);

    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "filler.ts": src }) });

    const row = db.db
      .prepare("SELECT from_node_id, line FROM unresolved_refs WHERE reference_name = ?")
      .get("runThing") as { from_node_id: string | null; line: number };
    expect(row).toBeDefined();
    expect(row.line).toBe(2);
    expect(row.from_node_id).toBeNull();
    db.close();
  });

  it("sets from_node_id NULL for a top-level ref before any function definition", async () => {
    const src = `console.log("hi");\nexport function f() {}\n`;
    const parsed = await parseFiles([mk("top.ts", src)]);
    const fSym = parsed[0]!.symbols.find((s) => s.name === "f");
    expect(fSym?.startLine).toBe(2);

    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "top.ts": src }) });

    const row = db.db
      .prepare("SELECT from_node_id, line FROM unresolved_refs WHERE reference_name = ?")
      .get("log") as { from_node_id: string | null; line: number };
    expect(row).toBeDefined();
    expect(row.line).toBe(1);
    expect(row.from_node_id).toBeNull();
    db.close();
  });

  it("writes a degraded file with empty unresolved_refs and no symbols", async () => {
    const content = `# hi\nsome text\n`;
    const parsed = await parseFiles([mk("data.md", content)]);
    expect(parsed[0]!.degraded).toBe(true);
    expect(parsed[0]!.symbols).toHaveLength(0);
    expect(parsed[0]!.refs).toHaveLength(0);

    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    const stats = await store.write({ parsed, sources: srcMap(parsed, { "data.md": content }) });

    expect(stats.files).toBe(1);
    expect(stats.nodes).toBe(0);
    expect(stats.unresolved).toBe(0);
    expect(count(db, "unresolved_refs")).toBe(0);
    expect(count(db, "nodes")).toBe(0);
    expect(count(db, "files")).toBe(1);
    db.close();
  });
});

describe("IndexStore pruneFiles", () => {
  it("removes files not in livePaths and cascades to nodes/chunks", async () => {
    const A = `export function wizardry() { return "magic"; }\n`;
    const B = `export function sorcery() { return 42; }\n`;
    const parsed = await parseFiles([mk("a.ts", A), mk("b.ts", B)]);
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({ parsed, sources: srcMap(parsed, { "a.ts": A, "b.ts": B }) });

    const aNodeId = symbolId("a.ts", "wizardry");
    const bNodeId = symbolId("b.ts", "sorcery");
    expect(count(db, "nodes WHERE file_path = ?", "a.ts")).toBe(1);
    expect(count(db, "nodes WHERE file_path = ?", "b.ts")).toBe(1);

    const deleted = store.pruneFiles(new Set(["b.ts"]));
    expect(deleted).toBe(1);

    expect(count(db, "files")).toBe(1);
    expect(count(db, "files WHERE path = ?", "b.ts")).toBe(1);
    expect(count(db, "nodes WHERE file_path = ?", "a.ts")).toBe(0);
    expect(count(db, "chunks WHERE file_path = ?", "a.ts")).toBe(0);
    expect(count(db, "nodes WHERE id = ?", aNodeId)).toBe(0);
    expect(count(db, "nodes WHERE id = ?", bNodeId)).toBe(1);
    db.close();
  });
});

describe("IndexStore writeIncremental", () => {
  it("only touches files in changedPaths; unchanged files keep their indexed_at", async () => {
    const A1 = `export function alpha() { return 1; }\n`;
    const A2 = `export function alpha() { return 1; }\nexport function beta() { return 2; }\n`;
    const B = `export function sorcery() { return 42; }\n`;
    const parsedA1 = await parseFiles([mk("a.ts", A1)]);
    const parsedB = await parseFiles([mk("b.ts", B)]);

    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);
    await store.write({
      parsed: [...parsedA1, ...parsedB],
      sources: srcMap([...parsedA1, ...parsedB], { "a.ts": A1, "b.ts": B }),
    });

    const bFileBefore = db.db
      .prepare("SELECT indexed_at FROM files WHERE path = ?")
      .get("b.ts") as { indexed_at: number };
    const bNodeBefore = db.db
      .prepare("SELECT updated_at FROM nodes WHERE id = ?")
      .get(symbolId("b.ts", "sorcery")) as { updated_at: number };

    await new Promise((r) => setTimeout(r, 15));

    const parsedA2 = await parseFiles([mk("a.ts", A2)]);
    await store.writeIncremental(
      {
        parsed: [...parsedA2, ...parsedB],
        sources: srcMap([...parsedA2, ...parsedB], { "a.ts": A2, "b.ts": B }),
      },
      new Set(["a.ts"]),
    );

    const bFileAfter = db.db
      .prepare("SELECT indexed_at FROM files WHERE path = ?")
      .get("b.ts") as { indexed_at: number };
    const bNodeAfter = db.db
      .prepare("SELECT updated_at FROM nodes WHERE id = ?")
      .get(symbolId("b.ts", "sorcery")) as { updated_at: number };

    expect(bFileAfter.indexed_at).toBe(bFileBefore.indexed_at);
    expect(bNodeAfter.updated_at).toBe(bNodeBefore.updated_at);

    expect(count(db, "nodes WHERE file_path = ?", "a.ts")).toBe(parsedA2[0]!.symbols.length);
    expect(count(db, "nodes WHERE id = ?", symbolId("a.ts", "beta"))).toBe(1);
    db.close();
  });
});

describe("IndexStore transaction safety", () => {
  it("rolls back on mid-write failure, leaving prior state intact", async () => {
    const A1 = `export function alpha() { return 1; }\n`;
    const A2 = `export function alpha() { return 1; }\nexport function beta() { return 2; }\n`;
    const B = `export function sorcery() { return 42; }\n`;

    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const store = new IndexStore(db);

    const parsedA1 = await parseFiles([mk("a.ts", A1)]);
    await store.write({ parsed: parsedA1, sources: srcMap(parsedA1, { "a.ts": A1 }) });
    expect(count(db, "nodes WHERE file_path = ?", "a.ts")).toBe(1);
    const alphaIdBefore = symbolId("a.ts", "alpha");
    expect(count(db, "nodes WHERE id = ?", alphaIdBefore)).toBe(1);

    const parsedA2 = await parseFiles([mk("a.ts", A2)]);
    const parsedB = await parseFiles([mk("b.ts", B)]);
    const brokenB: ParsedFile = {
      ...parsedB[0]!,
      chunks: [{ ...(parsedB[0]!.chunks[0] as Chunk), body: null as unknown as string }],
    };

    await expect(
      store.write({
        parsed: [...parsedA2, brokenB],
        sources: srcMap([...parsedA2, parsedB[0]!], { "a.ts": A2, "b.ts": B }),
      }),
    ).rejects.toThrow();

    expect(count(db, "nodes WHERE file_path = ?", "a.ts")).toBe(1);
    expect(count(db, "nodes WHERE id = ?", alphaIdBefore)).toBe(1);
    expect(count(db, "nodes WHERE id = ?", symbolId("a.ts", "beta"))).toBe(0);
    expect(count(db, "chunks WHERE file_path = ?", "b.ts")).toBe(0);
    db.close();
  });
});

describe("IndexStore chunks", () => {
  it("chunks from the parse pipeline have precomputed 16-char hex ids", async () => {
    const src = `export function wizardry() { return "magic"; }\n`;
    const parsed = await parseFiles([mk("a.ts", src)]);
    expect(parsed[0]!.chunks.length).toBeGreaterThan(0);
    for (const c of parsed[0]!.chunks) {
      expect(c.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
