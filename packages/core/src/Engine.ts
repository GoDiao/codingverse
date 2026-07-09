import type {
  IndexStats,
  PackOptions,
  PackResult,
  SearchOptions,
  SearchHit,
  SymbolNode,
  DashboardStats,
  IngestConfig,
  IngestResult,
  ParsedFile,
  Chunk,
  TreemapNode,
  ExpandEntry,
} from "@codingverse/shared";
import fs from "node:fs/promises";
import { ingest } from "./ingest/index.js";
import { parseFiles, parseFilesCached } from "./parse/index.js";
import { TokenBudget, buildTokenTreemap, type FileTokenCount } from "./budget/index.js";
import { compress, render } from "./assemble/index.js";
import { ExpandMapStore, type ExpandMapSnapshot } from "./assemble/expand-store.js";
import { ParseCache } from "./cache/index.js";
import {
  CallGraph,
  IndexDb,
  IndexStore,
  PageRank,
  RefResolver,
  SearchEngine,
} from "./indexdb/index.js";
import type { RankOptions, RankStats, GraphResult } from "./indexdb/index.js";
import type { ParseCacheStats } from "@codingverse/shared";
import { DEFAULT_TOKEN_BUDGET, STATE_DIR } from "@codingverse/shared";

export interface EngineOptions {
  /** Where to store the index/cache. Defaults to `<repo>/.codingverse`. */
  stateDir?: string;
}

/**
 * v2-4: a top-N pagerank row with display metadata, returned by
 * `Engine.topRankedNodes(n)` for `cv rank` stdout and V2-6 MCP "top symbols".
 */
export interface RankedNode {
  id: string;
  pagerank: number;
  filePath: string;
  startLine: number;
  qualifiedName?: string;
  name: string;
}

interface RankedNodeRow {
  id: string;
  pagerank: number | null;
  file_path: string;
  start_line: number | null;
  qualified_name: string | null;
  name: string;
}

/**
 * Engine — the facade over the 4-stage pipeline (ingest / parse / index / assemble)
 * plus the two cross-cutting concerns (token budget, incremental cache).
 *
 * One engine, three output modes: pack (CLI), search (MCP), stats (Dashboard).
 *
 * NOTE: M0 scaffold — all methods are stubs. Implemented incrementally per MVP milestones.
 */
export class Engine {
  private readonly repoPath: string;
  private readonly options: EngineOptions;
  /** Last pack's expand map (skeleton id → source span), for expand(). */
  private lastExpandMap: Record<string, ExpandEntry> = {};
  /** Last pack's parse-cache hit/miss stats. */
  private lastCacheStats: ParseCacheStats = { hits: 0, misses: 0, total: 0 };
  /** Lazily-loaded persistent expand map (from `<repo>/.codingverse/expand-map.json`). */
  private expandStore: ExpandMapStore;
  /**
   * SQLite index connection, opened lazily by ensureIndexDb() only when
   * index()/search() is first called. pack()/sync()/tokenReport()/expand()
   * never touch the index, so `cv pack` / `cv status` / `cv expand` no longer
   * create a surprise `index.db` artifact or fail on an unwritable
   * `.codingverse/` directory.
   */
  private indexDb: IndexDb | null = null;
  private closed = false;

  private constructor(repoPath: string, options: EngineOptions) {
    this.repoPath = repoPath;
    this.options = options;
    this.expandStore = new ExpandMapStore(repoPath);
  }

  static async open(repoPath: string, opts: EngineOptions = {}): Promise<Engine> {
    return new Engine(repoPath, opts);
  }

  /**
   * Open the SQLite index on first use. Throws a clear Engine-level error if
   * the engine is closed or the index cannot be opened (e.g. EACCES on
   * `.codingverse/`), so callers don't see opaque native sqlite/fs errors.
   */
  private ensureIndexDb(): IndexDb {
    if (this.closed) {
      throw new Error("Engine is closed; open a new Engine instance.");
    }
    if (!this.indexDb) {
      try {
        const db = new IndexDb({ repoRoot: this.repoPath });
        db.migrate();
        db.prepareStatements();
        this.indexDb = db;
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Failed to open index at ${this.repoPath}/${STATE_DIR}/index.db: ${cause}`,
        );
      }
    }
    return this.indexDb;
  }

  /** Stage ①: discover, read, decode, and validate files. */
  async ingest(config: IngestConfig = {}): Promise<IngestResult> {
    return ingest(this.repoPath, config);
  }

  /** Stage ②: parse files → symbols, refs, chunks. */
  async parse(config: IngestConfig = {}): Promise<ParsedFile[]> {
    const { files } = await ingest(this.repoPath, config);
    return parseFiles(files);
  }

  /**
   * Cross-cutting A: token accounting over the parsed repo.
   * Counts every chunk, aggregates per file, and builds a token treemap.
   */
  async tokenReport(
    config: IngestConfig = {},
  ): Promise<{ files: FileTokenCount[]; total: number; treemap: TreemapNode }> {
    const parsed = await this.parse(config);
    const budget = new TokenBudget({ repoRoot: this.repoPath });
    await budget.init();

    const byFile = new Map<string, Chunk[]>();
    for (const p of parsed) byFile.set(p.path, p.chunks);

    const files = budget.countFiles(byFile);
    await budget.flush();

    const total = files.reduce((sum, f) => sum + f.tokens, 0);
    const treemap = buildTokenTreemap(files);
    return { files, total, treemap };
  }

  /**
   * Stage ①-③: build / update the index.
   *
   * Pipeline: ingest → parseFilesCached (cross-cutting B parse cache) →
   * pruneFiles (drop rows for files no longer on disk) → IndexStore.write
   * (SQLite nodes/chunks/files + FTS5) → RefResolver.resolveAll
   * (unresolved_refs → edges). Returns aggregate counts.
   *
   * Pruning runs BEFORE the write so stale rows for deleted files don't
   * transiently linger inside the write transaction; without it, searching
   * would keep returning hits that point at non-existent filePaths.
   *
   * v1 uses a full store.write() rather than writeIncremental(changedPaths):
   * computing the exact set of cache-miss paths here would duplicate the
   * cache's own hit/miss logic. The parse cache already skips tree-sitter for
   * unchanged files, so re-indexing is still fast; only the SQLite write is
   * full. writeIncremental is a v1.5 refinement.
   */
  async index(): Promise<IndexStats> {
    const start = Date.now();
    const { files: ingested } = await ingest(this.repoPath, {});
    const sources = new Map(ingested.map((f) => [f.path, f.content]));
    const livePaths = new Set(ingested.map((f) => f.path));

    const cache = new ParseCache(this.repoPath);
    await cache.load();
    const { parsed, stats } = await parseFilesCached(ingested, cache);
    await cache.save();
    this.lastCacheStats = stats;

    const db = this.ensureIndexDb();
    const store = new IndexStore(db);
    store.pruneFiles(livePaths);
    const storeStats = store.write({ parsed, sources });

    const resolver = new RefResolver(db);
    const resolveStats = resolver.resolveAll();

    return {
      filesProcessed: stats.total,
      filesSkipped: stats.hits,
      symbols: storeStats.nodes,
      edges: resolveStats.resolved,
      chunks: storeStats.chunks,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Incremental sync: refresh the parse cache from disk without rendering.
   * Warms the cache so the next pack is fast; returns parse stats.
   */
  async sync(config: IngestConfig = {}): Promise<IndexStats> {
    const start = Date.now();
    const { files: ingested } = await ingest(this.repoPath, config);
    const cache = new ParseCache(this.repoPath);
    await cache.load();
    const { parsed, stats } = await parseFilesCached(ingested, cache);
    await cache.save();
    this.lastCacheStats = stats;

    let symbols = 0;
    let chunks = 0;
    for (const p of parsed) {
      symbols += p.symbols.length;
      chunks += p.chunks.length;
    }
    return {
      filesProcessed: stats.total,
      filesSkipped: stats.hits,
      symbols,
      edges: 0,
      chunks,
      durationMs: Date.now() - start,
    };
  }

  /** Parse-cache hit/miss stats from the last pack() or sync(). */
  getCacheStats(): ParseCacheStats {
    return this.lastCacheStats;
  }

  /**
   * Pack mode: layered compression into a single LLM context.
   * Uses the incremental parse cache (cross-cutting B): unchanged files skip
   * tree-sitter parsing entirely, making repeat packs fast.
   */
  async pack(opts: PackOptions = {}): Promise<PackResult> {
    const { files: ingested } = await ingest(this.repoPath, opts);
    const sources = new Map(ingested.map((f) => [f.path, f.content]));

    // Incremental parse via git-blob-hash cache.
    const cache = new ParseCache(this.repoPath);
    await cache.load();
    const { parsed, stats } = await parseFilesCached(ingested, cache);
    await cache.save();
    this.lastCacheStats = stats;

    // v2: pagerank-aware importance when the index is already open; else
    // undefined → compress falls back to v1 heuristics (lazy-IndexDb safe).
    const importanceProvider = this.pagerankImportanceProvider();

    const result = await compress(parsed, sources, opts, this.repoPath, importanceProvider);
    this.lastExpandMap = result.expandMap;

    // Persist the expand map so a separate `cv expand <id>` process can
    // resolve skeleton ids without re-packing.
    await this.expandStore.save(result.expandMap, {
      budget: opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      strategy: opts.layerStrategy ?? "auto",
      timestamp: Date.now(),
      fileCount: result.files.filter((f) => f.layer !== "omit").length,
      tokenCount: result.total,
    });

    // M5: render packed files into the requested format (default XML).
    const content = render(
      {
        files: result.files,
        tokenCount: result.total,
        expandableCount: Object.keys(result.expandMap).length,
      },
      opts.format ?? "xml",
    );

    return {
      content,
      tokenCount: result.total,
      layerMap: result.layerMap,
      fileCount: result.files.filter((f) => f.layer !== "omit").length,
      files: result.files,
      expandMap: result.expandMap,
    };
  }

  /**
   * Search mode: BM25 + co-location graph, fused via RRF.
   *
   * v1 has no vector path (embeddings land in v1.5), so SearchHit.scores.vector
   * is always 0. topK drives result truncation; minScore and graphExpand are
   * ignored in v1. Searching an empty (never-indexed) repo returns [] rather
   * than throwing — SearchEngine handles empty tables gracefully.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const db = this.ensureIndexDb();
    const engine = new SearchEngine(db);
    const rows = engine.search({
      query,
      topK: opts.topK ?? 20,
    });
    return rows.map((row) => ({
      chunkId: row.chunkId,
      filePath: row.filePath,
      startLine: row.startLine,
      endLine: row.endLine,
      body: row.body,
      scores: {
        vector: 0,
        bm25: row.scores.bm25,
        graph: row.scores.graph,
        rrf: row.scores.rrf,
      },
      relatedNodes: row.relatedNodes,
    }));
  }

  /**
   * Resolve a skeleton symbol id to its full source text.
   * Uses the in-memory expand map from this process's last pack(); if empty
   * (e.g. a fresh `cv expand` process), loads the persisted expand-map.json.
   */
  async expand(id: string): Promise<string> {
    const entry = await this.expandEntry(id);
    const absPath = `${this.repoPath}/${entry.path}`;
    const content = await fs.readFile(absPath, "utf8");
    return content.slice(entry.startByte, entry.endByte);
  }

  /** Resolve a skeleton id to its expand entry (metadata + span). */
  async expandEntry(id: string): Promise<ExpandEntry> {
    let map = this.lastExpandMap;
    if (Object.keys(map).length === 0) {
      const snap = await this.expandStore.load();
      map = snap?.entries ?? {};
      this.lastExpandMap = map;
    }
    const entry = map[id];
    if (!entry) {
      throw new Error(
        `Unknown expand id: ${id}. Run \`cv pack\` first, or the id is stale.`,
      );
    }
    return entry;
  }

  /** List all expandable symbols from the last pack (loads from disk). */
  async listExpandable(): Promise<ExpandMapSnapshot | null> {
    if (Object.keys(this.lastExpandMap).length > 0) {
      // In-memory from a pack in this process — but we don't have the meta
      // here, so fall through to disk which has both.
    }
    return this.expandStore.load();
  }

  /** Call-hierarchy: who calls this node. */
  async callers(nodeId: string, depth = 1): Promise<SymbolNode[]> {
    const db = this.ensureIndexDb();
    return new CallGraph(db).callers(nodeId, depth).nodes;
  }

  /** Call-hierarchy: what this node calls. */
  async callees(nodeId: string, depth = 1): Promise<SymbolNode[]> {
    const db = this.ensureIndexDb();
    return new CallGraph(db).callees(nodeId, depth).nodes;
  }

  /** Impact radius: reverse BFS with container drill-down. */
  async impact(nodeId: string, depth = 3): Promise<SymbolNode[]> {
    const db = this.ensureIndexDb();
    return new CallGraph(db).impact(nodeId, depth).nodes;
  }

  /**
   * v2-fix: full impact result (nodes + edges + byDepth + truncated) for
   * CLI/MCP to surface the container-cap cut. `impact()` keeps the simple
   * SymbolNode[] contract from design.md; this is the richer variant V2-4
   * CLI's `cv impact` and V2-6 MCP call when they need to report truncation.
   */
  async impactGraph(nodeId: string, depth = 3): Promise<GraphResult> {
    const db = this.ensureIndexDb();
    return new CallGraph(db).impact(nodeId, depth);
  }

  /**
   * v2: Personalized PageRank power iteration over the call graph, written
   * back to nodes.pagerank. Run after index() so nodes/edges are populated;
   * pack()/search() then read nodes.pagerank (with a v1 fallback when
   * unranked). Returns convergence stats.
   */
  async rank(opts?: RankOptions): Promise<RankStats> {
    const db = this.ensureIndexDb();
    return new PageRank(db).rank(opts);
  }

  /**
   * v2-4: top-N nodes by pagerank with display metadata (file, line, name),
   * for `cv rank` stdout and V2-6 MCP "top symbols". Ordered by pagerank
   * desc, then id asc for determinism. When the index was never ranked
   * (all pagerank = 0), rows still come back in id order — callers can
   * detect that case via pagerank === 0 and surface a "run `cv rank` first"
   * hint. n is clamped to >=1.
   */
  async topRankedNodes(n: number): Promise<RankedNode[]> {
    const db = this.ensureIndexDb();
    const stmt = db.db.prepare(
      `SELECT id, pagerank, file_path, start_line, qualified_name, name
       FROM nodes
       ORDER BY pagerank DESC, id ASC
       LIMIT ?`,
    );
    const rows = stmt.all(Math.max(1, n)) as unknown as RankedNodeRow[];
    return rows.map((r) => ({
      id: r.id,
      pagerank: r.pagerank ?? 0,
      filePath: r.file_path,
      startLine: r.start_line ?? 0,
      qualifiedName: r.qualified_name ?? undefined,
      name: r.name,
    }));
  }

  /**
   * v2-4: resolve a CLI argument to a node id. Accepts either a 16-char
   * hex id (used directly) or a symbol name (looked up via the first
   * `nodes.name = ?` match). Throws `no node named '<arg>' found` when a
   * name argument matches nothing, so the CLI catch block surfaces it on
   * stderr with exit 1. A hex-shaped id is NOT existence-checked here —
   * downstream CallGraph.callers/callees/impact throw `Unknown node id`
   * if it doesn't exist, which the CLI also surfaces.
   */
  async resolveNodeId(arg: string): Promise<string> {
    if (/^[0-9a-f]{16}$/.test(arg)) return arg;
    const db = this.ensureIndexDb();
    const stmt = db.db.prepare("SELECT id FROM nodes WHERE name = ? LIMIT 1");
    const row = stmt.get(arg) as { id: string } | undefined;
    if (!row) throw new Error(`no node named '${arg}' found`);
    return row.id;
  }

  /**
   * Build a file-importance provider that reads persisted pagerank from the
   * SQLite index, for compress()'s layer selection. Returns undefined when
   * the index was never opened in this process, so a standalone `cv pack`
   * falls back to v1 heuristics and never creates index.db (lazy-IndexDb
   * invariant). When the index IS open, the provider returns the file's
   * average pagerank (0 if unranked → compress falls back to v1 per-file).
   */
  private pagerankImportanceProvider(): ((path: string) => number) | undefined {
    if (this.closed || !this.indexDb) return undefined;
    const stmt = this.indexDb.db.prepare(
      "SELECT AVG(pagerank) AS avg FROM nodes WHERE file_path = ?",
    );
    return (filePath: string): number => {
      const row = stmt.get(filePath) as { avg: number | null } | undefined;
      const avg = row?.avg ?? 0;
      return avg > 0 ? avg : 0;
    };
  }

  /** Dashboard data source: all observation state in one call. */
  async stats(): Promise<DashboardStats> {
    throw new Error("Engine.stats not implemented (v2.5)");
  }

  /**
   * Close the SQLite index connection if it was opened. Idempotent — safe to
   * call multiple times, and safe to call when index()/search() were never
   * used (no IndexDb to close). After close(), index()/search() throw a clear
   * "Engine is closed" error via ensureIndexDb(); pack()/expand() are
   * unaffected since they never touch the index.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      this.indexDb?.close();
    } finally {
      this.closed = true;
    }
  }

  /** Exposed for early CLI wiring / debugging. */
  getRepoPath(): string {
    return this.repoPath;
  }

  getStateDir(): string | undefined {
    return this.options.stateDir;
  }
}
