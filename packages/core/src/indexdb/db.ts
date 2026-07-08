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
   * Run schema.sql (idempotent via IF NOT EXISTS) and apply WAL pragmas.
   * Returns the number of schema objects created by this call (tables + indexes +
   * triggers + FTS shadow tables); 0 on a no-op rerun.
   */
  migrate(): number {
    const before = this.objectCount();
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    const schema = fs.readFileSync(resolveSchemaPath(), "utf8");
    this.db.exec(schema);
    return this.objectCount() - before;
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
