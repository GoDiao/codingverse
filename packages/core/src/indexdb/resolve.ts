import type { StatementSync } from "node:sqlite";
import type { IndexDb } from "./db.js";

/**
 * V1-3 RefResolver — heuristic name-matching from unresolved_refs to edges.
 *
 * One responsibility: read unresolved_refs, match each reference_name to a
 * node by name, and write edges with provenance='heuristic'. No store, no
 * search, no cross-language resolution (deferred to SCIP in v2).
 *
 * Matching priority (v1 heuristic):
 *   1. Same file + same language  — exact (name, file_path, language); on
 *      multiple same-file namesakes pick the smallest (start_line, id).
 *   2. Same language, global      — exact (name, language); on multiple
 *      matches pick the smallest (file_path, start_line, id). Deterministic,
 *      since v1 has no PageRank to prefer the "most important" target.
 *
 * Refs with from_node_id IS NULL (no enclosing symbol) are skipped — an edge
 * needs a source node — and counted as unresolved. Refs that match a target
 * but duplicate an existing (source, target, kind, line) edge are detected by
 * an indexed existence check and skipped, so resolveAll is idempotent across
 * re-runs (no natural-key uniqueness exists on the edges table). Resolved refs
 * are NOT deleted from unresolved_refs: that table remains the source of
 * pending/unresolved refs for Dashboard display and v2 SCIP re-resolution,
 * while the edges table is the source of truth for resolved relationships.
 *
 * Transaction model: manual BEGIN/COMMIT/ROLLBACK (node:sqlite has no
 * .transaction() helper), matching store.ts.
 */

export interface ResolveStats {
  /** Refs that matched a node by name (including dups that deduped against existing edges). */
  resolved: number;
  /** Refs that did not match any node, or had no enclosing symbol (null from_node_id). */
  unresolved: number;
}

interface UnresolvedRow {
  from_node_id: string | null;
  reference_name: string;
  reference_kind: string;
  line: number;
  col: number | null;
  file_path: string;
  language: string;
}

export class RefResolver {
  private readonly db: IndexDb;
  private readonly allUnresolved: StatementSync;
  private readonly matchSameFile: StatementSync;
  private readonly matchGlobal: StatementSync;
  private readonly edgeExists: StatementSync;
  private readonly insertEdge: StatementSync;

  constructor(db: IndexDb) {
    this.db = db;
    const d = db.db;
    this.allUnresolved = d.prepare(
      `SELECT from_node_id, reference_name, reference_kind, line, col, file_path, language
       FROM unresolved_refs`,
    );
    this.matchSameFile = d.prepare(
      `SELECT id FROM nodes
       WHERE name = ? AND file_path = ? AND language = ?
       ORDER BY start_line ASC, id ASC LIMIT 1`,
    );
    this.matchGlobal = d.prepare(
      `SELECT id FROM nodes
       WHERE name = ? AND language = ?
       ORDER BY file_path ASC, start_line ASC, id ASC LIMIT 1`,
    );
    this.edgeExists = d.prepare(
      `SELECT 1 AS hit FROM edges
       WHERE source = ? AND target = ? AND kind = ? AND line = ?
       LIMIT 1`,
    );
    this.insertEdge = d.prepare(
      `INSERT INTO edges (source, target, kind, line, col, provenance)
       VALUES (?, ?, ?, ?, ?, 'heuristic')`,
    );
  }

  /** Scan all unresolved_refs, match by name to nodes, write edges. */
  resolveAll(): ResolveStats {
    const stats: ResolveStats = { resolved: 0, unresolved: 0 };
    this.db.db.exec("BEGIN");
    try {
      const rows = this.allUnresolved.all() as unknown as UnresolvedRow[];
      for (const ref of rows) {
        if (ref.from_node_id === null) {
          stats.unresolved++;
          continue;
        }
        const target = this.resolveTarget(ref);
        if (target === undefined) {
          stats.unresolved++;
          continue;
        }
        stats.resolved++;
        const dup = this.edgeExists.get(
          ref.from_node_id,
          target,
          ref.reference_kind,
          ref.line,
        ) as { hit: number } | undefined;
        if (dup) continue;
        this.insertEdge.run(
          ref.from_node_id,
          target,
          ref.reference_kind,
          ref.line,
          ref.col,
        );
      }
      this.db.db.exec("COMMIT");
    } catch (e) {
      try {
        this.db.db.exec("ROLLBACK");
      } catch {
        // best-effort rollback; suppress secondary failure
      }
      throw e;
    }
    return stats;
  }

  /**
   * Same-file-first name lookup. Returns the matched node id, or undefined
   * when no candidate exists in either the same file or the same language.
   */
  private resolveTarget(ref: UnresolvedRow): string | undefined {
    const sameFile = this.matchSameFile.get(
      ref.reference_name,
      ref.file_path,
      ref.language,
    ) as { id: string } | undefined;
    if (sameFile) return sameFile.id;
    const global = this.matchGlobal.get(ref.reference_name, ref.language) as
      | { id: string }
      | undefined;
    return global?.id;
  }
}
