import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IndexDb } from "./db.js";
import { STATE_DIR } from "@codingverse/shared";

const EXPECTED_TABLES = [
  "nodes",
  "edges",
  "chunks",
  "files",
  "unresolved_refs",
  "nodes_fts",
  "chunks_fts",
  "meta",
] as const;

const tableNames = (db: IndexDb): string[] =>
  (db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (r) => r.name,
  );

const objectCount = (db: IndexDb): number =>
  (db.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as { n: number }).n;

describe("IndexDb migrate (memory)", () => {
  it("creates all expected tables", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const names = tableNames(db);
    for (const t of EXPECTED_TABLES) {
      expect(names).toContain(t);
    }
    db.close();
  });

  it("returns the number of schema objects created on first run", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    expect(db.migrate()).toBeGreaterThan(0);
    db.close();
  });

  it("is idempotent on repeated migrate()", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const after1 = objectCount(db);
    const created = db.migrate();
    const after2 = objectCount(db);
    expect(created).toBe(0);
    expect(after2).toBe(after1);
    db.close();
  });

  it("throws when neither dbPath nor repoRoot is provided", () => {
    expect(() => new IndexDb()).toThrow();
  });

  it("close() makes subsequent operations throw", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.close();
    expect(() => db.db.prepare("SELECT 1")).toThrow();
  });
});

describe("IndexDb file-backed", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-indexdb-"));
  });
  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("enables WAL journal mode on a file db", () => {
    const file = path.join(dir, "index.db");
    const db = new IndexDb({ dbPath: file });
    db.migrate();
    const mode = (
      db.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    ).journal_mode;
    expect(mode.toLowerCase()).toBe("wal");
    db.close();
  });

  it("computes <repoRoot>/.codingverse/index.db and creates the parent dir", () => {
    const db = new IndexDb({ repoRoot: dir });
    db.migrate();
    expect(fs.existsSync(path.join(dir, STATE_DIR, "index.db"))).toBe(true);
    db.close();
  });
});

describe("IndexDb FTS5 (external-content + triggers)", () => {
  it("syncs chunks_fts on insert / update / delete", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const ins = db.db.prepare(
      "INSERT INTO chunks (id, file_path, body) VALUES (?, ?, ?)",
    );
    ins.run("c1", "src/a.ts", "function helloWorld() { return 'magic'; }");

    const hit = db.db
      .prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ?")
      .get("magic") as { id: string } | undefined;
    expect(hit?.id).toBe("c1");

    db.db.prepare("UPDATE chunks SET body = ? WHERE id = ?").run(
      "function renamed() { return 'wizard'; }",
      "c1",
    );
    expect(
      (db.db.prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ?").get("wizard") as
        | { id: string }
        | undefined)?.id,
    ).toBe("c1");
    expect(
      db.db.prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ?").get("magic"),
    ).toBeUndefined();

    db.db.prepare("DELETE FROM chunks WHERE id = ?").run("c1");
    expect(db.db.prepare("SELECT id FROM chunks_fts").all()).toHaveLength(0);
    db.close();
  });

  it("syncs nodes_fts on insert", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    db.db
      .prepare("INSERT INTO nodes (id, kind, name, file_path) VALUES (?, ?, ?, ?)")
      .run("n1", "function", "helloWorld", "src/a.ts");
    const hit = db.db
      .prepare("SELECT id FROM nodes_fts WHERE nodes_fts MATCH ?")
      .get("helloWorld") as { id: string } | undefined;
    expect(hit?.id).toBe("n1");
    db.close();
  });
});

describe("IndexDb prepareStatements", () => {
  it("prepares countFiles / getMeta / setMeta and they work", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    db.prepareStatements();
    expect(db.statements.has("countFiles")).toBe(true);
    expect(db.statements.has("getMeta")).toBe(true);
    expect(db.statements.has("setMeta")).toBe(true);

    const count = db.statements.get("countFiles")!.get() as { n: number };
    expect(count.n).toBe(0);

    db.statements.get("setMeta")!.run("schema_version", "1");
    const row = db.statements.get("getMeta")!.get("schema_version") as { value: string };
    expect(row.value).toBe("1");
    db.close();
  });
});
