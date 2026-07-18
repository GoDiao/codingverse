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
  ParseStatus,
  SyncState,
  GraphData,
  NodeDetail,
  PackPreview,
  PackScopeResult,
  Layer,
} from "@codingverse/shared";
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import nodePath from "node:path";
import { ingest } from "./ingest/index.js";
import { parseFiles, parseFilesCached } from "./parse/index.js";
import { TokenBudget, buildTokenTreemap, type FileTokenCount } from "./budget/index.js";
import { compress, render } from "./assemble/index.js";
import { ExpandMapStore, type ExpandMapSnapshot } from "./assemble/expand-store.js";
import { ParseCache, changedFilesSinceHead, changedFilesSince } from "./cache/index.js";
import {
  CallGraph,
  IndexDb,
  IndexStore,
  PageRank,
  RefResolver,
  ScipImporter,
  SearchEngine,
} from "./indexdb/index.js";
import type {
  RankOptions,
  RankStats,
  GraphResult,
  SearchDebugResult,
  ScipImportOptions,
  ScipImportStats,
} from "./indexdb/index.js";
import type { ParseCacheStats } from "@codingverse/shared";
import { DEFAULT_TOKEN_BUDGET, STATE_DIR } from "@codingverse/shared";

export interface EngineOptions {
  /** Where to store the index/cache. Defaults to `<repo>/.codingverse`. */
  stateDir?: string;
}

/**
 * v2-4: a top-N pagerank row with display metadata, returned by
 * `Engine.topRankedNodes(n)` for `cv rank` stdout and V2-6 MCP "top symbols".
 * V2-polish: extended with `kind` and `endLine` so `cv rank` can reuse the
 * shared CLI `formatNode` (which prints `filePath:startLine-endLine  kind
 * qualifiedName  [pagerank=...]`), putting rank's output line shape on par
 * with callers / callees / impact.
 */
export interface RankedNode {
  id: string;
  pagerank: number;
  filePath: string;
  startLine: number;
  endLine: number;
  kind: string;
  qualifiedName?: string;
  name: string;
}

interface RankedNodeRow {
  id: string;
  pagerank: number | null;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  kind: string | null;
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
  /**
   * v2.5-V8: per-db-connection caches for the read-side query objects. Each
   * of CallGraph / SearchEngine / PageRank prepares ~3-8 statements in its
   * constructor; a dashboard polling callers/callees/search-debug rebuilt them
   * on every request. They're stateless over a fixed db handle, so cache one
   * instance per Engine (reset only if the db handle is replaced, which it
   * never is after ensureIndexDb — close() nulls them for GC). Keyed nowhere:
   * the single indexDb handle is the only connection these read from.
   */
  private callGraphCache: CallGraph | null = null;
  private searchEngineCache: SearchEngine | null = null;
  private pageRankCache: PageRank | null = null;
  /**
   * v2-polish: transient read-only IndexDb connections opened by
   * `pagerankImportanceProvider()` when a one-shot `cv pack` finds an
   * existing index.db on disk (from a prior `cv index`/`cv rank`) but
   * `this.indexDb` is null (pack never opens the rw index). Closed after
   * compress() finishes in pack() and in close().
   */
  private transientDbs: IndexDb[] = [];
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

  /** v2.5-V8: cached CallGraph over the open index (see cache field docs). */
  private callGraph(): CallGraph {
    if (!this.callGraphCache) this.callGraphCache = new CallGraph(this.ensureIndexDb());
    return this.callGraphCache;
  }

  /** v2.5-V8: cached SearchEngine over the open index. */
  private searchEngine(): SearchEngine {
    if (!this.searchEngineCache) this.searchEngineCache = new SearchEngine(this.ensureIndexDb());
    return this.searchEngineCache;
  }

  /** v2.5-V8: cached PageRank over the open index. */
  private pageRank(): PageRank {
    if (!this.pageRankCache) this.pageRankCache = new PageRank(this.ensureIndexDb());
    return this.pageRankCache;
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
    const { parsed, stats, changedPaths } = await parseFilesCached(ingested, cache);
    await cache.save();
    this.lastCacheStats = stats;

    const db = this.ensureIndexDb();
    // v2-polish: snapshot pre-index scip-edge + ranked-node counts so the
    // CLI can warn that a full re-index resets them. Queried BEFORE
    // pruneFiles/store.write() — a full write deletes nodes per file (FK
    // cascade drops ALL edges incl. provenance='scip') and inserts
    // pagerank=0 for every node, so these counts reflect what will be lost.
    const scipEdgesBefore = (
      db.db
        .prepare("SELECT COUNT(*) AS n FROM edges WHERE provenance = 'scip'")
        .get() as { n: number } | undefined
    )?.n ?? 0;
    const rankedNodesBefore = (
      db.db
        .prepare("SELECT COUNT(*) AS n FROM nodes WHERE pagerank > 0")
        .get() as { n: number } | undefined
    )?.n ?? 0;
    const store = new IndexStore(db, this.repoPath);
    store.pruneFiles(livePaths);
    const storeStats = await store.write({ parsed, sources });

    const resolver = new RefResolver(db);
    const resolveStats = resolver.resolveAll();

    const durationMs = Date.now() - start;

    // v2.5-V4: persist the run's sync state into `meta` so a separate
    // `cv serve` process (which never runs index() itself) can surface
    // board ⑥. changedFiles is capped to keep the meta row bounded on
    // large first-time indexes; parseCacheMisses still reports the true count.
    const syncState: SyncState = {
      timestamp: Date.now(),
      durationMs,
      filesProcessed: stats.total,
      parseCacheHits: stats.hits,
      parseCacheMisses: stats.misses,
      changedFiles: changedPaths.slice(0, 200),
    };
    db.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .run("sync_state", JSON.stringify(syncState));

    return {
      filesProcessed: stats.total,
      filesSkipped: stats.hits,
      symbols: storeStats.nodes,
      edges: resolveStats.resolved,
      chunks: storeStats.chunks,
      durationMs,
      scipEdgesBefore,
      rankedNodesBefore,
    };
  }

  /**
   * v2.5-V4: the persisted SyncState from the last index() run (board ⑥),
   * or null if the repo was never indexed. Read from the `meta` table so it
   * survives across processes — `cv serve` shows the last `cv index`'s stats.
   */
  async syncState(): Promise<SyncState | null> {
    const db = this.ensureIndexDb();
    const row = db
      .prepareCached("SELECT value FROM meta WHERE key = ?")
      .get("sync_state") as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as SyncState;
    } catch {
      return null;
    }
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
    const { files: ingestedAll } = await ingest(this.repoPath, opts);
    // v3: diff/query-scoped packing restricts the file set to a computed
    // whitelist (exact repo-relative paths), applied here so all downstream
    // stages (parse → compress → render) only see the scoped files.
    const ingested = opts.restrictTo
      ? (() => {
          const keep = new Set(opts.restrictTo.map((p) => p.replace(/\\/g, "/")));
          return ingestedAll.filter((f) => keep.has(f.path.replace(/\\/g, "/")));
        })()
      : ingestedAll;
    const sources = new Map(ingested.map((f) => [f.path, f.content]));

    // Incremental parse via git-blob-hash cache.
    const cache = new ParseCache(this.repoPath);
    await cache.load();
    const { parsed, stats } = await parseFilesCached(ingested, cache);
    await cache.save();
    this.lastCacheStats = stats;

    // v2: pagerank-aware importance when the index is already open; else
    // undefined → compress falls back to v1 heuristics (lazy-IndexDb safe).
    // v2-polish: a one-shot pack may also transiently open a read-only
    // prior index.db (registered in transientDbs) — closed after compress.
    const importanceProvider = this.pagerankImportanceProvider();

    let result;
    try {
      result = await compress(
        parsed,
        sources,
        opts,
        this.repoPath,
        importanceProvider,
      );
    } finally {
      this.closeTransientDbs();
    }
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
   * v2.5-V7: pack-preview summary for Dashboard board ⑤. Runs the full pack()
   * pipeline but returns ONLY the layer decisions + per-file tokens + counts,
   * dropping the (potentially huge) rendered content so a budget slider can
   * poll cheaply. `fits` is whether the total came in at/under the budget;
   * layerCounts tallies files per layer for the summary badges.
   */
  async packPreview(opts: PackOptions = {}): Promise<PackPreview> {
    const budget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const result = await this.pack(opts);

    const layerCounts: Record<Layer, number> = {
      full: 0,
      skeleton: 0,
      outline: 0,
      omit: 0,
    };
    for (const f of result.files) layerCounts[f.layer]++;

    return {
      budget,
      total: result.tokenCount,
      fits: result.tokenCount <= budget,
      strategy: opts.layerStrategy ?? "auto",
      files: result.files.map((f) => ({
        path: f.path,
        layer: f.layer,
        tokens: f.tokens,
      })),
      layerCounts,
      expandableCount: Object.keys(result.expandMap).length,
    };
  }

  /**
   * v3 (V3-1): diff-scoped pack. Packs the changed files PLUS everything their
   * changes could affect (reverse call-graph impact), so the output is exactly
   * "this change + its blast radius" — the context an agent needs to reason
   * about a diff. `since` compares against a git ref; otherwise the working
   * tree vs HEAD. Returns a PackScopeResult carrying seed/expanded provenance.
   *
   * When the repo isn't a git repo (or git is unavailable), throws so the CLI
   * can report clearly. When the tree is clean, returns an empty pack.
   */
  async packScoped(
    opts: PackOptions & { since?: string; depth?: number } = {},
  ): Promise<PackScopeResult> {
    const { since, depth = 2, ...packOpts } = opts;

    const changed = since
      ? await changedFilesSince(this.repoPath, since)
      : await changedFilesSinceHead(this.repoPath);
    if (changed === null) {
      throw new Error(
        since
          ? `git diff against '${since}' failed — not a git repo, bad ref, or git unavailable`
          : "git change detection failed — not a git repo or git unavailable",
      );
    }

    // Restrict seeds to text files we would actually ingest (drop deleted
    // files and binaries). We compute the expanded set via call-graph impact.
    const seedFiles = [...changed].sort((a, b) => a.localeCompare(b));
    const expandedFiles = await this.expandFilesByImpact(seedFiles, depth);

    const restrictTo = [...new Set([...seedFiles, ...expandedFiles])];
    const result = await this.pack({ ...packOpts, restrictTo });

    return {
      ...result,
      scope: since ? "since" : "changed",
      scopeArg: since,
      seedFiles,
      expandedFiles,
    };
  }

  /**
   * v3 helper: given a set of repo-relative file paths, return the ADDITIONAL
   * files reachable by reverse call-graph impact from the symbols in those
   * files (callers / affected nodes), up to `depth`. Used by packScoped to
   * pull in the blast radius of a change. Files already in `seedFiles` are not
   * repeated. Safe on a never-indexed repo (returns []).
   */
  private async expandFilesByImpact(
    seedFiles: string[],
    depth: number,
  ): Promise<string[]> {
    if (seedFiles.length === 0 || depth <= 0) return [];
    if (!existsSync(nodePath.join(this.repoPath, STATE_DIR, "index.db"))) return [];

    const db = this.ensureIndexDb();
    const seedSet = new Set(seedFiles.map((p) => p.replace(/\\/g, "/")));

    // Symbols defined in the seed files → their node ids.
    const placeholders = seedFiles.map(() => "?").join(",");
    const seedNodes = db.db
      .prepare(`SELECT id FROM nodes WHERE file_path IN (${placeholders})`)
      .all(...seedFiles) as Array<{ id: string }>;

    const cg = this.callGraph();
    const affectedFiles = new Set<string>();
    for (const { id } of seedNodes) {
      const res = cg.impact(id, depth);
      for (const n of res.nodes) {
        const fp = n.filePath.replace(/\\/g, "/");
        if (!seedSet.has(fp)) affectedFiles.add(fp);
      }
    }
    return [...affectedFiles].sort((a, b) => a.localeCompare(b));
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
    const engine = this.searchEngine();
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
   * v2.5-V6: search inspector data for Dashboard board ④. Returns each
   * retrieval path (BM25 / co-location) independently plus the fused top-k
   * with per-path ranks and the RRF constants, so the UI can show how the
   * paths combine. Thin pass-through to SearchEngine.searchDebug (which
   * reuses the same recall() as search(), so the debug view can't drift from
   * real results).
   */
  async searchDebug(
    query: string,
    opts: SearchOptions = {},
  ): Promise<SearchDebugResult> {
    const engine = this.searchEngine();
    return engine.searchDebug({ query, topK: opts.topK ?? 20 });
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
    return this.callGraph().callers(nodeId, depth).nodes;
  }

  /** Call-hierarchy: what this node calls. */
  async callees(nodeId: string, depth = 1): Promise<SymbolNode[]> {
    return this.callGraph().callees(nodeId, depth).nodes;
  }

  /** Impact radius: reverse BFS with container drill-down. */
  async impact(nodeId: string, depth = 3): Promise<SymbolNode[]> {
    return this.callGraph().impact(nodeId, depth).nodes;
  }

  /**
   * v2-final-fix: full callers result (nodes + edges + byDepth + truncated)
   * for CLI/MCP to print depth-grouped output (mirrors `cv impact`). The
   * simple `callers()` keeps the SymbolNode[] contract from design.md and
   * V2-6 MCP; this is the richer variant `cv callers` calls when it needs
   * `--- depth N ---` grouping. callers/callees do no container drill-down,
   * so `truncated` is always false, but the field is present for symmetry.
   */
  async callersGraph(nodeId: string, depth = 1): Promise<GraphResult> {
    return this.callGraph().callers(nodeId, depth);
  }

  /** v2-final-fix: full callees result — see {@link callersGraph}. */
  async calleesGraph(nodeId: string, depth = 1): Promise<GraphResult> {
    return this.callGraph().callees(nodeId, depth);
  }

  /**
   * v2-fix: full impact result (nodes + edges + byDepth + truncated) for
   * CLI/MCP to surface the container-cap cut. `impact()` keeps the simple
   * SymbolNode[] contract from design.md; this is the richer variant V2-4
   * CLI's `cv impact` and V2-6 MCP call when they need to report truncation.
   */
  async impactGraph(nodeId: string, depth = 3): Promise<GraphResult> {
    return this.callGraph().impact(nodeId, depth);
  }

  /**
   * v2: Personalized PageRank power iteration over the call graph, written
   * back to nodes.pagerank. Run after index() so nodes/edges are populated;
   * pack()/search() then read nodes.pagerank (with a v1 fallback when
   * unranked). Returns convergence stats.
   */
  async rank(opts?: RankOptions): Promise<RankStats> {
    return this.pageRank().rank(opts);
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
    const stmt = db.prepareCached(
      `SELECT id, pagerank, file_path, start_line, end_line, kind, qualified_name, name
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
      endLine: r.end_line ?? 0,
      kind: r.kind ?? "",
      qualifiedName: r.qualified_name ?? undefined,
      name: r.name,
    }));
  }

  /**
   * v2.5-V5: graph data for Dashboard board ③ (code graph). Returns the top
   * `limit` nodes by pagerank plus the edges among ONLY those nodes (so the
   * frontend never gets a dangling edge referencing an off-screen node). The
   * cap keeps a big repo's graph from freezing the browser; `truncated` tells
   * the UI the full graph is larger than what's shown. `maxPagerank` drives
   * the node color/size scale. limit is clamped to >=1.
   */
  async graphData(limit = 200): Promise<GraphData> {
    const db = this.ensureIndexDb();
    const d = db.db;
    const cap = Math.max(1, limit);

    const totalNodes =
      (db.prepareCached("SELECT COUNT(*) AS n FROM nodes").get() as
        | { n: number }
        | undefined)?.n ?? 0;

    const nodeRows = db
      .prepareCached(
        `SELECT id, name, qualified_name, file_path, kind, pagerank
         FROM nodes
         ORDER BY pagerank DESC, id ASC
         LIMIT ?`,
      )
      .all(cap) as Array<{
      id: string;
      name: string;
      qualified_name: string | null;
      file_path: string;
      kind: string | null;
      pagerank: number | null;
    }>;

    const nodes = nodeRows.map((r) => ({
      id: r.id,
      name: r.name,
      qualifiedName: r.qualified_name ?? undefined,
      filePath: r.file_path,
      kind: r.kind ?? "",
      pagerank: r.pagerank ?? 0,
    }));

    const ids = new Set(nodes.map((n) => n.id));
    let maxPagerank = 0;
    for (const n of nodes) if (n.pagerank > maxPagerank) maxPagerank = n.pagerank;

    // Edges among the selected nodes only. Pull all edges whose source is in
    // the set (via a dynamic IN-list, same pattern as graph.ts), then filter
    // to those whose target is also selected — avoids a huge cross-product and
    // any dangling edge into an off-screen node.
    const edges: { source: string; target: string; kind: string }[] = [];
    if (ids.size > 0) {
      const idList = [...ids];
      const placeholders = idList.map(() => "?").join(",");
      const edgeRows = d
        .prepare(
          `SELECT source, target, kind FROM edges WHERE source IN (${placeholders})`,
        )
        .all(...idList) as Array<{ source: string; target: string; kind: string }>;
      for (const e of edgeRows) {
        if (ids.has(e.target)) {
          edges.push({ source: e.source, target: e.target, kind: e.kind });
        }
      }
    }

    return {
      nodes,
      edges,
      maxPagerank,
      totalNodes,
      truncated: totalNodes > nodes.length,
    };
  }

  /**
   * Board ③ click-detail: full metadata for one symbol node plus its global
   * pagerank rank (1 = highest in the repo). Returns null when the id is
   * unknown so the caller can 404 rather than throw.
   */
  async nodeDetail(id: string): Promise<NodeDetail | null> {
    const db = this.ensureIndexDb();

    const row = db
      .prepareCached(
        `SELECT id, name, qualified_name, kind, file_path, language,
                start_line, end_line, signature, docstring, visibility, pagerank
         FROM nodes WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          name: string;
          qualified_name: string | null;
          kind: string | null;
          file_path: string;
          language: string | null;
          start_line: number | null;
          end_line: number | null;
          signature: string | null;
          docstring: string | null;
          visibility: string | null;
          pagerank: number | null;
        }
      | undefined;

    if (!row) return null;

    const totalNodes =
      (db.prepareCached("SELECT COUNT(*) AS n FROM nodes").get() as
        | { n: number }
        | undefined)?.n ?? 0;

    // Global rank = how many nodes outrank this one by pagerank, + 1.
    const pagerank = row.pagerank ?? 0;
    const ahead =
      (db
        .prepareCached("SELECT COUNT(*) AS n FROM nodes WHERE pagerank > ?")
        .get(pagerank) as { n: number } | undefined)?.n ?? 0;

    return {
      id: row.id,
      name: row.name,
      qualifiedName: row.qualified_name ?? undefined,
      kind: row.kind ?? "",
      filePath: row.file_path,
      language: row.language ?? undefined,
      startLine: row.start_line ?? undefined,
      endLine: row.end_line ?? undefined,
      signature: row.signature ?? undefined,
      docstring: row.docstring ?? undefined,
      visibility: row.visibility ?? undefined,
      pagerank,
      pagerankRank: ahead + 1,
      totalNodes,
    };
  }

  /**
   * v2-5: import precise edges from a .scip index file (Sourcegraph SCIP),
   * replacing heuristic edges for the files the .scip covers. Delegates to
   * ScipImporter against the lazily-opened index. Requires the optional
   * `protobufjs` dependency; throws a clear install hint when it is missing.
   * Run after `index()` so nodes exist to match SCIP symbols against.
   */
  async importScip(opts: ScipImportOptions): Promise<ScipImportStats> {
    const db = this.ensureIndexDb();
    return new ScipImporter(db).import(opts);
  }

  /**
   * v2-4: resolve a CLI argument to a node id. Accepts either a 16-char
   * hex id (used directly) or a symbol name (looked up via the first
   * `nodes.name = ?` match). Throws `no node named '<arg>' found` when a
   * name argument matches nothing, so the CLI catch block surfaces it on
   * stderr with exit 1. A hex-shaped id is NOT existence-checked here —
   * downstream CallGraph.callers/callees/impact throw `Unknown node id`
   * if it doesn't exist, which the CLI also surfaces.
   *
   * Determinism: the name lookup uses `ORDER BY id ASC LIMIT 1` so that
   * when multiple symbols share a name (~5% of nodes in a typical repo),
   * the same id is returned every run. Without ORDER BY, SQLite's row
   * order is unspecified → non-deterministic CLI targeting. id is
   * `hash(file_path + qualified_name)`, content-stable across re-indexes,
   * so the smallest-id pick is stable across rebuilds too.
   */
  async resolveNodeId(arg: string): Promise<string> {
    if (/^[0-9a-f]{16}$/.test(arg)) return arg;
    const db = this.ensureIndexDb();
    const stmt = db.prepareCached(
      "SELECT id FROM nodes WHERE name = ? ORDER BY id ASC LIMIT 1",
    );
    const row = stmt.get(arg) as { id: string } | undefined;
    if (!row) throw new Error(`no node named '${arg}' found`);
    return row.id;
  }

  /**
   * Build a file-importance provider that reads persisted pagerank from the
   * SQLite index, for compress()'s layer selection.
   *
   * v2-polish (Item 1): when `this.indexDb` is already open (from index/
   * search/rank in THIS process), reuse it. When it is null (a one-shot
   * `cv pack` that never opened the rw index) BUT an index.db file exists on
   * disk from a prior `cv index`/`cv rank`, open it READ-ONLY transiently to
   * read pagerank, then close after compress() (registered in
   * `this.transientDbs`). The `existsSync` guard is critical: a fresh repo
   * with no prior index must NOT create an index.db (lazy invariant).
   *
   * v2-polish (Item 3): uses MAX(pagerank) per file, not AVG. A file
   * containing one high-pagerank hub plus several low-pagerank leaf helpers
   * gets MAX≈the hub (correctly high) — AVG would be pulled down by the
   * leaves and rank it below a single-medium-hub file. A file's importance
   * is its highest-pagerank symbol.
   *
   * Returns undefined when the engine is closed or no index is available,
   * so a standalone `cv pack` on a never-indexed repo falls back to v1
   * heuristics and never creates index.db.
   */
  private pagerankImportanceProvider(): ((path: string) => number) | undefined {
    if (this.closed) return undefined;
    if (this.indexDb) {
      const stmt = this.indexDb.db.prepare(
        "SELECT MAX(pagerank) AS max FROM nodes WHERE file_path = ?",
      );
      return (filePath: string): number => {
        const row = stmt.get(filePath) as { max: number | null } | undefined;
        return row?.max ?? 0;
      };
    }
    const indexPath = nodePath.join(this.repoPath, STATE_DIR, "index.db");
    if (!existsSync(indexPath)) return undefined;
    try {
      const transientDb = new IndexDb({ dbPath: indexPath, readOnly: true });
      // Push BEFORE prepare(): if prepare throws (e.g. corrupt/empty index.db
      // with no `nodes` table), the catch returns undefined but the handle is
      // already registered so closeTransientDbs() can close it. Pushing after
      // prepare would leak the handle on prepare failure.
      this.transientDbs.push(transientDb);
      const stmt = transientDb.db.prepare(
        "SELECT MAX(pagerank) AS max FROM nodes WHERE file_path = ?",
      );
      return (filePath: string): number => {
        const row = stmt.get(filePath) as { max: number | null } | undefined;
        return row?.max ?? 0;
      };
    } catch {
      return undefined;
    }
  }

  /** Close any transient read-only index connections opened for pack(). */
  private closeTransientDbs(): void {
    for (const db of this.transientDbs) {
      try {
        db.close();
      } catch {
        // best-effort: a read-only close failing is non-fatal
      }
    }
    this.transientDbs = [];
  }

  /** Dashboard data source: all observation state in one call. */
  async stats(): Promise<DashboardStats> {
    const db = this.ensureIndexDb();
    const indexPath = nodePath.join(this.repoPath, STATE_DIR, "index.db");

    const countOf = (sql: string): number =>
      (db.prepareCached(sql).get() as { n: number } | undefined)?.n ?? 0;

    const files = countOf("SELECT COUNT(*) AS n FROM files");
    const symbols = countOf("SELECT COUNT(*) AS n FROM nodes");
    const edges = countOf("SELECT COUNT(*) AS n FROM edges");
    const chunks = countOf("SELECT COUNT(*) AS n FROM chunks");

    let dbSize = 0;
    try {
      dbSize = statSync(indexPath).size;
    } catch {
      // index.db may not exist yet
    }

    const lastSyncRow = db
      .prepareCached("SELECT MAX(indexed_at) AS t FROM files")
      .get() as { t: number | null } | undefined;
    const lastSync = lastSyncRow?.t ?? 0;

    const health: Record<ParseStatus, number> = {
      ok: 0,
      degraded: 0,
      failed: 0,
      skipped: 0,
    };
    const healthRows = db
      .prepareCached("SELECT parse_status, COUNT(*) AS n FROM files GROUP BY parse_status")
      .all() as Array<{ parse_status: string; n: number }>;
    for (const row of healthRows) {
      switch (row.parse_status) {
        case "ok":
          health.ok = row.n;
          break;
        case "degraded":
          health.degraded = row.n;
          break;
        case "failed":
          health.failed = row.n;
          break;
        case "skipped":
          health.skipped = row.n;
          break;
      }
    }

    const langRows = db
      .prepareCached("SELECT language, COUNT(*) AS n FROM files GROUP BY language")
      .all() as Array<{ language: string; n: number }>;
    const languages: Record<string, number> = {};
    for (const row of langRows) {
      languages[row.language] = row.n;
    }

    const tokenRows = db
      .prepareCached(
        "SELECT file_path, SUM(COALESCE(token_count, 0)) AS tokens FROM chunks GROUP BY file_path",
      )
      .all() as Array<{ file_path: string; tokens: number | null }>;
    const fileTokenCounts: FileTokenCount[] = tokenRows.map((r) => ({
      path: r.file_path,
      tokens: r.tokens ?? 0,
    }));
    const tokenMap = buildTokenTreemap(fileTokenCounts);

    // v2.5-V4: populate syncQueue from the persisted SyncState — the
    // changed (re-parsed) files from the last index() run, marked "parsed".
    // Board ⑥ shows the full state via /api/sync (syncState()); syncQueue is
    // the compact changed-file list carried inside DashboardStats.
    const syncQueue: { path: string; status: string }[] = [];
    const syncRow = db
      .prepareCached("SELECT value FROM meta WHERE key = ?")
      .get("sync_state") as { value: string } | undefined;
    if (syncRow) {
      try {
        const state = JSON.parse(syncRow.value) as SyncState;
        for (const path of state.changedFiles) {
          syncQueue.push({ path, status: "parsed" });
        }
      } catch {
        // malformed meta row — leave syncQueue empty
      }
    }

    return {
      index: { files, symbols, edges, chunks, dbSize, lastSync },
      health,
      languages,
      tokenMap,
      syncQueue,
    };
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
      this.closeTransientDbs();
      this.indexDb?.close();
      // v2.5-V8: drop cached query objects so their prepared statements are
      // GC'd with the closed connection.
      this.callGraphCache = null;
      this.searchEngineCache = null;
      this.pageRankCache = null;
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
