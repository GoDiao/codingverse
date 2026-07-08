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
import { IndexDb, IndexStore, RefResolver, SearchEngine } from "./indexdb/index.js";
import type { ParseCacheStats } from "@codingverse/shared";
import { DEFAULT_TOKEN_BUDGET } from "@codingverse/shared";

export interface EngineOptions {
  /** Where to store the index/cache. Defaults to `<repo>/.codingverse`. */
  stateDir?: string;
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
  /** SQLite index connection (opened in the constructor, closed in close()). */
  private readonly indexDb: IndexDb;
  private closed = false;

  private constructor(repoPath: string, options: EngineOptions) {
    this.repoPath = repoPath;
    this.options = options;
    this.expandStore = new ExpandMapStore(repoPath);
    this.indexDb = new IndexDb({ repoRoot: repoPath });
    this.indexDb.migrate();
    this.indexDb.prepareStatements();
  }

  static async open(repoPath: string, opts: EngineOptions = {}): Promise<Engine> {
    return new Engine(repoPath, opts);
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
   * IndexStore.write (SQLite nodes/chunks/files + FTS5) → RefResolver.resolveAll
   * (unresolved_refs → edges). Returns aggregate counts.
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

    const cache = new ParseCache(this.repoPath);
    await cache.load();
    const { parsed, stats } = await parseFilesCached(ingested, cache);
    await cache.save();
    this.lastCacheStats = stats;

    const store = new IndexStore(this.indexDb);
    const storeStats = store.write({ parsed, sources });

    const resolver = new RefResolver(this.indexDb);
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

    const result = await compress(parsed, sources, opts, this.repoPath);
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
    const engine = new SearchEngine(this.indexDb);
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
  async callers(_nodeId: string, _depth = 1): Promise<SymbolNode[]> {
    throw new Error("Engine.callers not implemented (v2)");
  }

  /** Call-hierarchy: what this node calls. */
  async callees(_nodeId: string, _depth = 1): Promise<SymbolNode[]> {
    throw new Error("Engine.callees not implemented (v2)");
  }

  /** Impact radius: reverse BFS with container drill-down. */
  async impact(_nodeId: string, _depth = 3): Promise<SymbolNode[]> {
    throw new Error("Engine.impact not implemented (v2)");
  }

  /** Dashboard data source: all observation state in one call. */
  async stats(): Promise<DashboardStats> {
    throw new Error("Engine.stats not implemented (v2.5)");
  }

  /**
   * Close the SQLite index connection. Idempotent — safe to call multiple
   * times. After close(), index()/search() will throw (the underlying
   * DatabaseSync rejects operations once closed); pack()/expand() are
   * unaffected since they never touch the index.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.indexDb.close();
  }

  /** Exposed for early CLI wiring / debugging. */
  getRepoPath(): string {
    return this.repoPath;
  }

  getStateDir(): string | undefined {
    return this.options.stateDir;
  }
}
