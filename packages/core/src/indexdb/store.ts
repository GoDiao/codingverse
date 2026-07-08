import { createHash } from "node:crypto";
import type { StatementSync } from "node:sqlite";
import type { ParsedFile, RawSymbol, Chunk, RawRef } from "@codingverse/shared";
import type { IndexDb } from "./db.js";
import { symbolId, qualifiedName } from "./ids.js";
import { gitBlobHash } from "../cache/index.js";

/**
 * V1-2 IndexStore — write layer that persists ParsedFile[] into SQLite.
 *
 * One responsibility: turn parsed files into rows. No search, no resolve,
 * no embedding — those belong to later stages (V1-3 resolve, V1-5 embed).
 *
 * Transaction model: node:sqlite has no high-level `.transaction()` helper,
 * so each public method wraps its writes in a manual `BEGIN` / `COMMIT` and
 * issues `ROLLBACK` on any thrown error, guaranteeing no partial writes leak
 * through. FK `ON DELETE CASCADE` (nodes→edges, nodes→unresolved_refs) plus
 * explicit per-file deletes on chunks/unresolved_refs keep the index
 * consistent when a file is re-indexed or pruned.
 *
 * FTS5: the external-content tables `nodes_fts` / `chunks_fts` are kept in
 * sync by AFTER INSERT/UPDATE/DELETE triggers defined in schema.sql. The
 * store therefore only ever inserts into the base tables — never the FTS
 * tables directly.
 */

export interface StoreInput {
  parsed: ParsedFile[];
  /** path → file content (used to compute gitBlobHash for the files table). */
  sources: Map<string, string>;
}

export interface StoreStats {
  nodes: number;
  /** Always 0 in V1-2; edges are produced by resolve.ts (V1-3). */
  edges: number;
  chunks: number;
  files: number;
  unresolved: number;
}

export class IndexStore {
  private readonly db: IndexDb;
  private readonly insertNode: StatementSync;
  private readonly insertChunk: StatementSync;
  private readonly insertUnresolved: StatementSync;
  private readonly insertFile: StatementSync;
  private readonly deleteNodesByFile: StatementSync;
  private readonly deleteChunksByFile: StatementSync;
  private readonly deleteUnresolvedByFile: StatementSync;
  private readonly deleteFileByPath: StatementSync;
  private readonly allFiles: StatementSync;

  constructor(db: IndexDb) {
    this.db = db;
    const d = db.db;
    this.insertNode = d.prepare(
      `INSERT OR REPLACE INTO nodes
        (id, kind, name, qualified_name, file_path, language,
         start_line, end_line, start_byte, end_byte,
         signature, docstring, visibility, pagerank, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
    );
    this.insertChunk = d.prepare(
      `INSERT OR REPLACE INTO chunks
        (id, file_path, language, start_line, end_line, body, token_count, embedding, embedding_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    );
    this.insertUnresolved = d.prepare(
      `INSERT INTO unresolved_refs
        (from_node_id, reference_name, reference_kind, line, col, file_path, language)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertFile = d.prepare(
      `INSERT OR REPLACE INTO files
        (path, git_blob_hash, content_hash, language, size, node_count, indexed_at, parse_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteNodesByFile = d.prepare("DELETE FROM nodes WHERE file_path = ?");
    this.deleteChunksByFile = d.prepare("DELETE FROM chunks WHERE file_path = ?");
    this.deleteUnresolvedByFile = d.prepare(
      "DELETE FROM unresolved_refs WHERE file_path = ?",
    );
    this.deleteFileByPath = d.prepare("DELETE FROM files WHERE path = ?");
    this.allFiles = d.prepare("SELECT path FROM files");
  }

  /** Full write: clear old rows per file, insert new. Single transaction. */
  write(input: StoreInput): StoreStats {
    return this.writeWithFilter(input, () => true);
  }

  /** Incremental write: only process changedPaths. Unchanged files untouched. */
  writeIncremental(input: StoreInput, changedPaths: Set<string>): StoreStats {
    return this.writeWithFilter(input, (p) => changedPaths.has(p.path));
  }

  /**
   * Delete rows for files no longer present. The schema has no FK from
   * nodes/chunks.file_path to files.path, so we explicitly delete nodes
   * (cascades to edges + unresolved_refs.from_node_id), chunks, and
   * remaining unresolved_refs (those with from_node_id = NULL) per file.
   */
  // Plan assumed FK cascade from files→nodes/chunks; schema has no such FK, so we delete explicitly by file_path.
  pruneFiles(livePaths: Set<string>): number {
    let deleted = 0;
    this.db.db.exec("BEGIN");
    try {
      const rows = this.allFiles.all() as Array<{ path: string }>;
      for (const row of rows) {
        if (livePaths.has(row.path)) continue;
        this.deleteNodesByFile.run(row.path);
        this.deleteChunksByFile.run(row.path);
        this.deleteUnresolvedByFile.run(row.path);
        this.deleteFileByPath.run(row.path);
        deleted++;
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
    return deleted;
  }

  private writeWithFilter(
    input: StoreInput,
    shouldProcess: (p: ParsedFile) => boolean,
  ): StoreStats {
    const stats: StoreStats = { nodes: 0, edges: 0, chunks: 0, files: 0, unresolved: 0 };
    this.db.db.exec("BEGIN");
    try {
      for (const p of input.parsed) {
        if (!shouldProcess(p)) continue;
        const counts = this.writeParsedFile(p);
        const content = input.sources.get(p.path) ?? "";
        const fp = this.fileParams(p, content);
        this.insertFile.run(
          fp.path,
          fp.gitBlobHash,
          fp.contentHash,
          fp.language,
          fp.size,
          fp.nodeCount,
          fp.indexedAt,
          fp.parseStatus,
        );
        stats.files++;
        stats.nodes += counts.symbols;
        stats.chunks += counts.chunks;
        stats.unresolved += counts.refs;
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

  private writeParsedFile(p: ParsedFile): {
    symbols: number;
    chunks: number;
    refs: number;
  } {
    this.deleteNodesByFile.run(p.path);
    this.deleteChunksByFile.run(p.path);
    this.deleteUnresolvedByFile.run(p.path);

    const now = Date.now();

    // Precompute per-symbol qualifiedName + id once, so node insertion and
    // ref lookup never recompute the sha1 hash. The sorted mirror carries the
    // precomputed id alongside the line range, so findInnermostSymbol is a
    // plain linear scan with no hashing per comparison.
    const qnBySym = new Map<RawSymbol, string>();
    const idBySym = new Map<RawSymbol, string>();
    for (const sym of p.symbols) {
      const qn = qualifiedName(sym);
      qnBySym.set(sym, qn);
      idBySym.set(sym, symbolId(p.path, qn));
    }
    const sortedForLookup = [...p.symbols]
      .map((sym) => ({
        sym,
        id: idBySym.get(sym)!,
        lineRange: sym.endLine - sym.startLine,
        byteRange: sym.endByte - sym.startByte,
      }))
      // Plan said "startLine asc, endLine desc" (outermost-first); corrected to smallest-range-first so the first line-containment match is the innermost enclosing symbol.
      .sort(
        (a, b) =>
          a.lineRange - b.lineRange ||
          a.byteRange - b.byteRange,
      );

    let symbols = 0;
    for (const sym of p.symbols) {
      const np = this.nodeParams(p, sym, now, qnBySym.get(sym)!, idBySym.get(sym)!);
      this.insertNode.run(
        np.id,
        np.kind,
        np.name,
        np.qualifiedName,
        np.filePath,
        np.language,
        np.startLine,
        np.endLine,
        np.startByte,
        np.endByte,
        np.signature,
        np.docstring,
        np.updatedAt,
      );
      symbols++;
    }

    let chunks = 0;
    for (const chunk of p.chunks) {
      const cp = this.chunkParams(p, chunk);
      this.insertChunk.run(
        cp.id,
        cp.filePath,
        cp.language,
        cp.startLine,
        cp.endLine,
        cp.body,
        cp.tokenCount,
      );
      chunks++;
    }

    let refs = 0;
    for (const ref of p.refs) {
      const fromNodeId = this.findInnermostSymbol(sortedForLookup, ref);
      const up = this.unresolvedParams(p, ref, fromNodeId);
      this.insertUnresolved.run(
        up.fromNodeId,
        up.referenceName,
        up.referenceKind,
        up.line,
        up.col,
        up.filePath,
        up.language,
      );
      refs++;
    }

    return { symbols, chunks, refs };
  }

  /**
   * Find the innermost enclosing symbol for a ref by linear scan over the
   * smallest-range-first sorted list. Returns the precomputed id (no hashing
   * here) or null when the ref lives outside any symbol range.
   */
  private findInnermostSymbol(
    sortedForLookup: Array<{ sym: RawSymbol; id: string; lineRange: number; byteRange: number }>,
    ref: RawRef,
  ): string | null {
    for (const entry of sortedForLookup) {
      if (entry.sym.startLine <= ref.startLine && ref.startLine <= entry.sym.endLine) {
        return entry.id;
      }
    }
    return null;
  }

  private nodeParams(
    p: ParsedFile,
    sym: RawSymbol,
    now: number,
    qualifiedName: string,
    id: string,
  ) {
    return {
      id,
      kind: sym.kind,
      name: sym.name,
      qualifiedName,
      filePath: p.path,
      language: p.language,
      startLine: sym.startLine,
      endLine: sym.endLine,
      startByte: sym.startByte,
      endByte: sym.endByte,
      signature: sym.signature ?? null,
      docstring: sym.docstring ?? null,
      updatedAt: now,
    };
  }

  private chunkParams(p: ParsedFile, chunk: Chunk) {
    return {
      id: chunk.id,
      filePath: p.path,
      language: p.language,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      body: chunk.body,
      tokenCount: chunk.tokenCount ?? null,
    };
  }

  private unresolvedParams(p: ParsedFile, ref: RawRef, fromNodeId: string | null) {
    return {
      fromNodeId,
      referenceName: ref.name,
      referenceKind: ref.kind,
      line: ref.startLine,
      col: null,
      filePath: p.path,
      language: p.language,
    };
  }

  private fileParams(p: ParsedFile, content: string) {
    return {
      path: p.path,
      gitBlobHash: gitBlobHash(content),
      contentHash: createHash("sha1").update(content).digest("hex"),
      language: p.language,
      size: Buffer.byteLength(content),
      nodeCount: p.symbols.length,
      indexedAt: Date.now(),
      parseStatus: p.degraded ? "degraded" : "ok",
    };
  }
}
