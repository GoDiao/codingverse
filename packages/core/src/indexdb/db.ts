import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { STATE_DIR } from "@codingverse/shared";

const require = createRequire(import.meta.url);

/**
 * V1-1 IndexDb — SQLite connection + migration + WAL, backed by node:sqlite.
 *
 * FTS5 decision (V1-0 fold-in): a probe confirmed that FTS5 external-content
 * tables + AFTER INSERT/UPDATE/DELETE sync triggers work correctly under
 * node:sqlite (insert / update / delete all propagate to the FTS index). We
 * therefore keep the external-content approach defined in schema.sql — the FTS
 * tables do not duplicate body text, so storage stays lean — and rely on the
 * sync triggers that now live alongside the FTS definitions in schema.sql. The
 * standalone-FTS5 fallback (store text directly, no triggers) was not needed.
 *
 * The schema is resolved at runtime through the `@codingverse/shared/schema.sql`
 * subpath export (see packages/shared/package.json `exports`), which points at
 * the source schema.sql — the single source of truth, reachable both in the
 * workspace (via the symlinked node_modules) and in the published package.
 *
 * Note on ExperimentalWarning: node:sqlite emits its ExperimentalWarning at
 * native-module import time, which runs before any constructor can install a
 * listener, and cannot be silenced at runtime via `process.on('warning')`. To
 * suppress it, set `NODE_OPTIONS=--no-warnings=ExperimentalWarning` before Node starts.
 */

let schemaPathCache: string | null = null;

/**
 * Schema version stamp. Bumped whenever the FTS5 tokenizer (or any other
 * index-structure assumption) changes in an IF NOT EXISTS-incompatible way.
 * IndexDb.migrate() compares the persisted meta value against this constant
 * and drop+recreates the FTS tables + sync triggers on mismatch, so an existing
 * index.db self-upgrades without a manual `rm .codingverse/index.db`.
 *
 * v1.1-trigram: chunks_fts/nodes_fts switched from unicode61 to the trigram
 * tokenizer (CamelCase body substrings now match).
 */
const SCHEMA_VERSION = "v1.1-trigram";

export interface DbOptions {
  /** Override default path; tests use ':memory:'. */
  dbPath?: string;
  /** Repo root — used to derive the default path `<repoRoot>/.codingverse/index.db`. */
  repoRoot?: string;
}

export class IndexDb {
  readonly db: DatabaseSync;
  readonly statements = new Map<string, StatementSync>();

  constructor(opts: DbOptions = {}) {
    const dbPath = resolveDbPath(opts);
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
  }

  /**
   * Run schema.sql (idempotent via IF NOT EXISTS) and apply pragmas.
   * Returns the number of schema objects created by this call (tables + indexes +
   * triggers + FTS shadow tables); 0 on a no-op rerun.
   *
   * `PRAGMA foreign_keys=ON` is set outside any transaction (SQLite silently
   * no-ops the pragma inside one) so the schema's `ON DELETE CASCADE` clauses
   * on edges/unresolved_refs actually fire — without this, deleting a node
   * leaves orphan edges pointing at it, corrupting graph expansion.
   *
   * Schema-version migration: after schema.sql, if meta.schema_version !==
   * SCHEMA_VERSION, the FTS5 virtual tables and their sync triggers are dropped
   * and schema.sql is re-run to recreate them with the current tokenizer
   * (e.g. trigram as of v1.1). Because schema.sql uses IF NOT EXISTS, the base
   * tables/indexes are untouched on the second pass — only the dropped FTS
   * tables + triggers get recreated. This makes an existing index.db
   * self-upgrading when the tokenizer changes, without a manual rebuild.
   */
  migrate(): number {
    const before = this.objectCount();
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys=ON;",
    );
    const schema = fs.readFileSync(resolveSchemaPath(), "utf8");
    this.db.exec(schema);
    this.upgradeFtsIfStale(schema);
    return this.objectCount() - before;
  }

  /**
   * Drop+recreate the FTS5 tables + sync triggers when the persisted
   * schema_version does not match SCHEMA_VERSION. Covers both fresh installs
   * (meta.schema_version is NULL → tables just created by schema.sql are dropped
   * and recreated identically, which is wasteful but harmless) and upgrades from
   * a prior tokenizer (e.g. unicode61 → trigram). Triggers are dropped explicitly
   * because they live on the base tables (nodes/chunks) and would dangle once the
   * FTS table they reference is dropped. Re-running schema.sql recreates both the
   * FTS tables and the triggers (IF NOT EXISTS is satisfied for base tables, so
   * only the dropped FTS+trigger objects come back). The FTS5 'rebuild' command
   * then repopulates the new index from the base content tables so an upgraded
   * index stays searchable without a full re-index (no-op on a fresh empty db).
   */
  private upgradeFtsIfStale(schema: string): void {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(
      "schema_version",
    ) as { value: string } | undefined;
    if (row?.value === SCHEMA_VERSION) return;

    this.db.exec(
      `DROP TRIGGER IF EXISTS nodes_fts_ai;
       DROP TRIGGER IF EXISTS nodes_fts_ad;
       DROP TRIGGER IF EXISTS nodes_fts_au;
       DROP TRIGGER IF EXISTS chunks_fts_ai;
       DROP TRIGGER IF EXISTS chunks_fts_ad;
       DROP TRIGGER IF EXISTS chunks_fts_au;
       DROP TABLE IF EXISTS nodes_fts;
       DROP TABLE IF EXISTS chunks_fts;`,
    );
    this.db.exec(schema);
    this.db.exec(
      `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild');
       INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');`,
    );
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .run("schema_version", SCHEMA_VERSION);
  }

  /** Pre-compile high-frequency statements. Call after migrate(). */
  prepareStatements(): void {
    this.statements.set("countFiles", this.db.prepare("SELECT COUNT(*) AS n FROM files"));
    this.statements.set("getMeta", this.db.prepare("SELECT value FROM meta WHERE key = ?"));
    this.statements.set(
      "setMeta",
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),
    );
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  private objectCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }
}

function resolveDbPath(opts: DbOptions): string {
  if (opts.dbPath) return opts.dbPath;
  if (opts.repoRoot) return path.join(opts.repoRoot, STATE_DIR, "index.db");
  throw new Error("IndexDb: provide dbPath or repoRoot");
}

function resolveSchemaPath(): string {
  if (schemaPathCache) return schemaPathCache;
  schemaPathCache = require.resolve("@codingverse/shared/schema.sql");
  return schemaPathCache;
}
