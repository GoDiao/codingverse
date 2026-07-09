import fs from "node:fs";
import { createRequire } from "node:module";
import type { StatementSync } from "node:sqlite";
import type { IndexDb } from "./db.js";

/**
 * V2-5 ScipImporter — optional precise-edge import from a .scip index file.
 *
 * One responsibility: parse a .scip protobuf file (vendored
 * `@codingverse/shared/scip.proto` via the dynamically-imported `protobufjs`)
 * and insert `provenance='scip'` edges into the `edges` table, replacing the
 * `provenance='heuristic'` edges that `RefResolver` produced for files a .scip
 * document covers. No graph, no rank, no search.
 *
 * `protobufjs` is an **optionalDependency**: users who skip it run
 * `pnpm install --no-optional`, so the runtime `import("protobufjs")` is wrapped
 * in a try/catch that throws a clear install hint instead of an opaque
 * `ERR_MODULE_NOT_FOUND`.
 *
 * ── Two edge sources, both written as provenance='scip' ─────────────────────
 *
 * SCIP indexers expose references in one of two ways (rarely both):
 *
 * 1. **Occurrences** (scip-typescript): every reference is an `Occurrence` with
 *    a `symbol`, a `range`, and `symbol_roles` (no `Definition` bit for refs).
 *    The `relationships` field is left empty and `enclosing_range` is unset, so
 *    the enclosing function is recovered by **range containment** against the
 *    document's definition occurrences (innermost match wins). scip-typescript
 *    also writes positions to the deprecated `repeated int32 range` field
 *    (`[line, startChar, endChar]` or `[startLine, startChar, endLine,
 *    endChar]`), not the typed `single_line_range`/`multi_line_range` oneofs —
 *    both shapes are handled.
 *
 * 2. **Relationships** (scip-java and others): each `SymbolInformation` lists
 *    `relationships[]` with `is_reference`/`is_implementation` flags. No
 *    position, so the edge line is the source symbol's definition line.
 *
 * Both paths share the same node matching and dedup, so an indexer that emits
 * both doesn't double-insert.
 *
 * ── SCIP symbol → node matching (v2 heuristic) ──────────────────────────────
 *
 * A SCIP `symbol` string looks like
 *   `scip-typescript npm @scope/pkg 1.0.0 src/`pkg`/MyClass#myMethod().`
 * (scip-typescript concatenates descriptors without spaces; other indexers
 * space-separate them). The first four space-separated tokens are package
 * metadata; the rest are descriptors whose trailing suffix marks the kind
 * (`#` type, `().` method, `.` namespace, `/` term, `[]` typeparam).
 * `parseScipSymbolName` extracts the **last descriptor's bare name** (stripping
 * backtick-quoted path components and quotes) — e.g. `myMethod` from the above.
 *
 * A *source* (defined in this document) is matched first by **line**: the
 * definition occurrence's 0-based line + 1 equals our 1-based `nodes.start_line`
 * — robust and unambiguous. A *target* (referenced symbol, possibly in another
 * file) is matched by **name** globally (`ORDER BY file_path, start_line, id`).
 * When line matching fails (indexers with off-by-one positions, or symbols our
 * tree-sitter pass didn't capture at that line), the source falls back to a
 * same-file name match. Symbols that match no node are skipped — SCIP may cover
 * files/symbols we did not parse, and external symbols (library refs) are never
 * in our index.
 *
 * ── Edge kind (v2 simplification) ───────────────────────────────────────────
 *
 * All SCIP edges are written with `kind='calls'` so they flow into the V2-1
 * call graph and V2-2 PageRank (`WHERE kind='calls'`). SCIP does not cleanly
 * distinguish a call from a type reference at the occurrence level; a v2.5
 * refinement can split `references` vs `calls` using `symbol_roles`. SCIP edges
 * are distinguishable from heuristic ones via `provenance='scip'` regardless.
 *
 * ── Heuristic replacement ───────────────────────────────────────────────────
 *
 * Heuristic edges sourced from a document's file are deleted **only if** the
 * SCIP import produced ≥1 edge for that file — so a file the .scip covers but
 * yields no resolvable edges for keeps its heuristic call graph rather than
 * going silent. Edges *from other files* into this file's nodes are untouched
 * (they get re-resolved when their own file is SCIP-covered). The whole import
 * is one transaction (BEGIN/COMMIT/ROLLBACK), matching store.ts / resolve.ts.
 */

const require = createRequire(import.meta.url);

export interface ScipImportOptions {
  /** Path to the .scip file to import. */
  scipPath: string;
  /** Repo root — kept for parity with the API contract / future path resolution. */
  repoRoot: string;
}

export interface ScipImportStats {
  documents: number;
  occurrences: number;
  relationships: number;
  edgesInserted: number;
  /** heuristic edges replaced (deleted) by scip edges for covered files. */
  edgesReplaced: number;
}

// ── Decoded .scip shape (camelCase, as produced by protobufjs toObject) ──────

interface ScipSingleLineRange {
  line: number;
  startCharacter: number;
  endCharacter: number;
}
interface ScipMultiLineRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}
interface ScipOccurrence {
  symbol: string;
  symbolRoles: number;
  /** Deprecated `repeated int32 range` — used by scip-typescript. */
  range?: number[];
  singleLineRange?: ScipSingleLineRange;
  multiLineRange?: ScipMultiLineRange;
}
interface ScipRelationship {
  symbol: string;
  isReference: boolean;
  isImplementation: boolean;
  isTypeDefinition: boolean;
  isDefinition: boolean;
}
interface ScipSymbolInformation {
  symbol: string;
  relationships?: ScipRelationship[];
}
interface ScipDocument {
  relativePath: string;
  occurrences?: ScipOccurrence[];
  symbols?: ScipSymbolInformation[];
}
interface ScipIndex {
  documents?: ScipDocument[];
}

/** Definition bit of the SCIP `SymbolRole` bitset (scip.proto: Definition = 0x1). */
const SYMBOL_ROLE_DEFINITION = 0x1;

interface OccRange {
  /** 0-based start line. */
  startLine: number;
  /** 0-based end line (inclusive). */
  endLine: number;
}

interface DefOcc extends OccRange {
  symbol: string;
  /** 0-based line of the definition (start line). */
  line: number;
}

interface PendingEdge {
  source: string;
  target: string;
  /** 1-based edge line (call/reference site or source def line). */
  line: number | null;
}

let scipProtoPathCache: string | null = null;

function resolveScipProtoPath(): string {
  if (scipProtoPathCache) return scipProtoPathCache;
  scipProtoPathCache = require.resolve("@codingverse/shared/scip.proto");
  return scipProtoPathCache;
}

/**
 * Extract the last descriptor's bare name from a SCIP symbol string. Strips
 * package metadata (first 4 space tokens), backtick-quoted path components, and
 * surrounding quotes. Returns "" when no descriptor name can be recovered.
 */
function parseScipSymbolName(symbol: string): string {
  const descriptor = symbol.split(" ").slice(4).join(" ");
  if (!descriptor) return "";
  const stripped = descriptor.replace(/`[^`]*`/g, "");
  const lastParen = stripped.lastIndexOf("(");
  if (lastParen !== -1) {
    return lastSegmentName(stripped.slice(0, lastParen));
  }
  if (stripped.endsWith("[]")) {
    return lastSegmentName(stripped.slice(0, -2));
  }
  const last = stripped.length > 0 ? stripped[stripped.length - 1] : "";
  if (last === "#" || last === "/" || last === ".") {
    return lastSegmentName(stripped.slice(0, -1));
  }
  return lastSegmentName(stripped);
}

/** Text after the last suffix marker (`#` / `/` / `.`), trimmed and unquoted. */
function lastSegmentName(s: string): string {
  let lastMarkerIdx = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === "#" || c === "/" || c === ".") {
      lastMarkerIdx = i;
      break;
    }
  }
  const seg = lastMarkerIdx === -1 ? s : s.slice(lastMarkerIdx + 1);
  return seg.trim().replace(/^["']+|["']+$/g, "");
}

/** Resolve an occurrence's 0-based line range from typed oneofs or deprecated `range`. */
function occurrenceRange(occ: ScipOccurrence): OccRange | null {
  if (occ.singleLineRange) {
    const line = occ.singleLineRange.line;
    return { startLine: line, endLine: line };
  }
  if (occ.multiLineRange) {
    return {
      startLine: occ.multiLineRange.startLine,
      endLine: occ.multiLineRange.endLine,
    };
  }
  const r = occ.range;
  if (r && r.length >= 3) {
    if (r.length >= 4) {
      return { startLine: r[0]!, endLine: r[2]! };
    }
    return { startLine: r[0]!, endLine: r[0]! };
  }
  return null;
}

export class ScipImporter {
  private readonly db: IndexDb;
  private readonly countNodes: StatementSync;
  private readonly matchNodeByLine: StatementSync;
  private readonly matchNodeByNameInFile: StatementSync;
  private readonly matchNodeByNameGlobal: StatementSync;
  private readonly countHeuristicEdgesFromFile: StatementSync;
  private readonly deleteHeuristicEdgesFromFile: StatementSync;
  private readonly insertEdge: StatementSync;

  constructor(db: IndexDb) {
    this.db = db;
    const d = db.db;
    this.countNodes = d.prepare("SELECT COUNT(*) AS n FROM nodes");
    this.matchNodeByLine = d.prepare(
      "SELECT id FROM nodes WHERE file_path = ? AND start_line = ? ORDER BY id ASC LIMIT 1",
    );
    this.matchNodeByNameInFile = d.prepare(
      "SELECT id FROM nodes WHERE file_path = ? AND name = ? ORDER BY start_line ASC, id ASC LIMIT 1",
    );
    this.matchNodeByNameGlobal = d.prepare(
      "SELECT id FROM nodes WHERE name = ? ORDER BY file_path ASC, start_line ASC, id ASC LIMIT 1",
    );
    this.countHeuristicEdgesFromFile = d.prepare(
      `SELECT COUNT(*) AS n FROM edges
       WHERE provenance = 'heuristic'
         AND source IN (SELECT id FROM nodes WHERE file_path = ?)`,
    );
    this.deleteHeuristicEdgesFromFile = d.prepare(
      `DELETE FROM edges
       WHERE provenance = 'heuristic'
         AND source IN (SELECT id FROM nodes WHERE file_path = ?)`,
    );
    this.insertEdge = d.prepare(
      `INSERT INTO edges (source, target, kind, line, col, provenance)
       VALUES (?, ?, 'calls', ?, NULL, 'scip')`,
    );
  }

  async import(opts: ScipImportOptions): Promise<ScipImportStats> {
    const nodeCount = (this.countNodes.get() as { n: number }).n;
    if (nodeCount === 0) {
      throw new Error("No indexed nodes — run `cv index` before `--scip`.");
    }
    if (!fs.existsSync(opts.scipPath)) {
      throw new Error(`SCIP file not found: ${opts.scipPath}`);
    }

    const protobuf = await loadProtobufjs();
    const root = await protobuf.load(resolveScipProtoPath());
    const IndexType = root.lookupType("scip.Index");
    const buf = fs.readFileSync(opts.scipPath);
    const decoded = IndexType.toObject(IndexType.decode(buf), {
      enums: String,
      longs: Number,
      defaults: true,
    }) as unknown as ScipIndex;

    const documents = decoded.documents ?? [];
    const stats: ScipImportStats = {
      documents: documents.length,
      occurrences: 0,
      relationships: 0,
      edgesInserted: 0,
      edgesReplaced: 0,
    };

    const seen = new Set<string>();

    this.db.db.exec("BEGIN");
    try {
      for (const doc of documents) {
        const filePath = normalizePath(doc.relativePath);
        const occurrences = doc.occurrences ?? [];
        const symbols = doc.symbols ?? [];
        stats.occurrences += occurrences.length;

        const pending: PendingEdge[] = [];

        // Definition occurrences: line index for source matching + containment
        // ranges for the occurrence path's enclosing-function recovery.
        const defLineBySymbol = new Map<string, number>();
        const defs: DefOcc[] = [];
        for (const occ of occurrences) {
          if ((occ.symbolRoles & SYMBOL_ROLE_DEFINITION) !== 0) {
            const range = occurrenceRange(occ);
            if (!range) continue;
            const def: DefOcc = {
              symbol: occ.symbol,
              line: range.startLine,
              startLine: range.startLine,
              endLine: range.endLine,
            };
            defs.push(def);
            if (!defLineBySymbol.has(occ.symbol)) {
              defLineBySymbol.set(occ.symbol, range.startLine);
            }
          }
        }

        // Path 1: relationships (scip-java-style).
        for (const symInfo of symbols) {
          const relationships = symInfo.relationships ?? [];
          stats.relationships += relationships.length;
          const sourceLine0 = defLineBySymbol.get(symInfo.symbol) ?? null;
          const sourceNodeId = this.resolveSourceNode(
            filePath,
            sourceLine0,
            symInfo.symbol,
          );
          if (!sourceNodeId) continue;
          for (const rel of relationships) {
            if (!rel.isReference && !rel.isImplementation) continue;
            const targetNodeId = this.resolveTargetNode(rel.symbol);
            if (!targetNodeId) continue;
            pending.push({
              source: sourceNodeId,
              target: targetNodeId,
              line: sourceLine0 !== null ? sourceLine0 + 1 : null,
            });
          }
        }

        // Path 2: reference occurrences (scip-typescript-style). The enclosing
        // definition is recovered by innermost range containment.
        for (const occ of occurrences) {
          if ((occ.symbolRoles & SYMBOL_ROLE_DEFINITION) !== 0) continue;
          const refRange = occurrenceRange(occ);
          if (!refRange) continue;
          const enclosing = innermostContaining(defs, refRange.startLine);
          if (!enclosing) continue;
          const sourceNodeId = this.resolveSourceNode(
            filePath,
            enclosing.line,
            enclosing.symbol,
          );
          if (!sourceNodeId) continue;
          const targetNodeId = this.resolveTargetNode(occ.symbol);
          if (!targetNodeId) continue;
          pending.push({
            source: sourceNodeId,
            target: targetNodeId,
            line: refRange.startLine + 1,
          });
        }

        // Dedup within this import and against earlier documents.
        let insertedForFile = 0;
        for (const edge of pending) {
          const dedupKey = `${edge.source}\0${edge.target}\0${edge.line ?? ""}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          this.insertEdge.run(edge.source, edge.target, edge.line);
          insertedForFile++;
          stats.edgesInserted++;
        }

        // Replace heuristic edges for this file only if SCIP contributed edges.
        if (insertedForFile > 0) {
          const replaced = (
            this.countHeuristicEdgesFromFile.get(filePath) as { n: number }
          ).n;
          if (replaced > 0) {
            this.deleteHeuristicEdgesFromFile.run(filePath);
            stats.edgesReplaced += replaced;
          }
        }
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
   * Resolve a SCIP symbol (defined in `filePath`) to a node id. Line match
   * first (0-based SCIP line → 1-based start_line), then same-file name match.
   */
  private resolveSourceNode(
    filePath: string,
    defLine0: number | null,
    scipSymbol: string,
  ): string | null {
    if (defLine0 !== null) {
      const byLine = this.matchNodeByLine.get(filePath, defLine0 + 1) as
        | { id: string }
        | undefined;
      if (byLine) return byLine.id;
    }
    const lastName = parseScipSymbolName(scipSymbol);
    if (!lastName) return null;
    const byName = this.matchNodeByNameInFile.get(filePath, lastName) as
      | { id: string }
      | undefined;
    return byName?.id ?? null;
  }

  /** Resolve a referenced SCIP symbol to a node id anywhere in the index. */
  private resolveTargetNode(scipSymbol: string): string | null {
    const lastName = parseScipSymbolName(scipSymbol);
    if (!lastName) return null;
    const row = this.matchNodeByNameGlobal.get(lastName) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }
}

/** Innermost definition occurrence whose 0-based line range contains `line`. */
function innermostContaining(defs: DefOcc[], line: number): DefOcc | null {
  let best: DefOcc | null = null;
  for (const def of defs) {
    if (def.startLine <= line && line <= def.endLine) {
      if (
        !best ||
        def.endLine - def.startLine < best.endLine - best.startLine
      ) {
        best = def;
      }
    }
  }
  return best;
}

async function loadProtobufjs(): Promise<typeof import("protobufjs")> {
  try {
    return await import("protobufjs");
  } catch {
    throw new Error(
      "SCIP support requires protobufjs. Install: pnpm --filter @codingverse/core add protobufjs",
    );
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
