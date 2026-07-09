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

describe("IndexDb migrate (schema_version upgrade)", () => {
  it("stamps meta.schema_version on a fresh migrate()", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    db.prepareStatements();
    const row = db.statements.get("getMeta")!.get("schema_version") as
      | { value: string }
      | undefined;
    expect(row?.value).toBe("v1.1-trigram");
    db.close();
  });

  it("is idempotent: a second migrate() with a matching version does not drop FTS", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const ftsCount = (
      db.db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='chunks_fts'")
        .get() as { n: number }
    ).n;
    expect(ftsCount).toBe(1);
    // Second migrate() — schema_version matches, so upgradeFtsIfStale is a no-op.
    db.migrate();
    expect(
      (
        db.db
          .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='chunks_fts'")
          .get() as { n: number }
      ).n,
    ).toBe(1);
    db.close();
  });

  it("upgrades a stale (unicode61) index to trigram and keeps data searchable via rebuild", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    // Build a pre-v1.1 index by hand: base table + unicode61 FTS + trigger + data.
    db.db.exec(
      `CREATE TABLE chunks (id TEXT PRIMARY KEY, file_path TEXT, body TEXT, embedding_tokens TEXT);
       CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
       CREATE VIRTUAL TABLE chunks_fts USING fts5(id UNINDEXED, body, embedding_tokens, content='chunks', content_rowid='rowid');
       CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
         INSERT INTO chunks_fts(rowid, id, body, embedding_tokens) VALUES (new.rowid, new.id, new.body, new.embedding_tokens);
       END;`,
    );
    db.db
      .prepare("INSERT INTO chunks (id, file_path, body) VALUES (?, ?, ?)")
      .run("c1", "src/a.ts", "export class TokenBudget { tokens: number; }");
    db.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?)")
      .run("schema_version", "v1.0-unicode61");
    // Under unicode61 the body CamelCase is one token; 'token' substring does not match.
    expect(
      db.db.prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ?").get("token"),
    ).toBeUndefined();

    // migrate() detects the stale version, drops+recreates FTS with trigram, rebuilds.
    db.migrate();

    // The rebuilt trigram index now matches the 'token' substring for the existing row.
    const hit = db.db
      .prepare("SELECT id FROM chunks_fts WHERE chunks_fts MATCH ?")
      .get("token") as { id: string } | undefined;
    expect(hit?.id).toBe("c1");
    const version = db.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("schema_version") as { value: string } | undefined;
    expect(version?.value).toBe("v1.1-trigram");
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

describe("IndexDb FK cascades (foreign_keys=ON)", () => {
  const count = (db: IndexDb, sql: string, ...params: unknown[]): number =>
    (db.db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get(...params) as { n: number }).n;

  it("enables foreign_keys=ON for the connection after migrate()", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    const fk = (db.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
    expect(fk).toBe(1);
    db.close();
  });

  it("ON DELETE CASCADE removes edges and unresolved_refs whose from_node_id is the deleted node", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    db.db
      .prepare("INSERT INTO nodes (id, kind, name, file_path) VALUES (?, ?, ?, ?)")
      .run("n1", "function", "alpha", "src/a.ts");
    db.db
      .prepare("INSERT INTO nodes (id, kind, name, file_path) VALUES (?, ?, ?, ?)")
      .run("n2", "function", "beta", "src/b.ts");
    db.db
      .prepare(
        "INSERT INTO edges (source, target, kind, line, provenance) VALUES (?, ?, ?, ?, ?)",
      )
      .run("n1", "n2", "calls", 1, "heuristic");
    db.db
      .prepare(
        "INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, file_path, language) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("n1", "beta", "calls", 1, "src/a.ts", "typescript");

    expect(count(db, "edges")).toBe(1);
    expect(count(db, "unresolved_refs")).toBe(1);

    // Delete n1 → cascade removes the edge (n1 is source) and the ref (from_node_id=n1).
    db.db.prepare("DELETE FROM nodes WHERE id = ?").run("n1");
    expect(count(db, "edges")).toBe(0);
    expect(count(db, "unresolved_refs")).toBe(0);
    // n2 untouched.
    expect(count(db, "nodes WHERE id = ?", "n2")).toBe(1);
    db.close();
  });

  it("ON DELETE CASCADE removes edges where the deleted node is the target", () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    db.db
      .prepare("INSERT INTO nodes (id, kind, name, file_path) VALUES (?, ?, ?, ?)")
      .run("n1", "function", "alpha", "src/a.ts");
    db.db
      .prepare("INSERT INTO nodes (id, kind, name, file_path) VALUES (?, ?, ?, ?)")
      .run("n2", "function", "beta", "src/b.ts");
    db.db
      .prepare(
        "INSERT INTO edges (source, target, kind, line, provenance) VALUES (?, ?, ?, ?, ?)",
      )
      .run("n1", "n2", "calls", 1, "heuristic");

    // Delete n2 (the target) → edge cascade-deletes; n1 stays.
    db.db.prepare("DELETE FROM nodes WHERE id = ?").run("n2");
    expect(count(db, "edges")).toBe(0);
    expect(count(db, "nodes WHERE id = ?", "n1")).toBe(1);
    db.close();
  });
});
