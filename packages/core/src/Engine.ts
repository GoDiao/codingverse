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
} from "@codingverse/shared";
import fs from "node:fs/promises";
import { ingest } from "./ingest/index.js";
import { parseFiles, parseFilesCached } from "./parse/index.js";
import { TokenBudget, buildTokenTreemap, type FileTokenCount } from "./budget/index.js";
import { compress, render } from "./assemble/index.js";
import { ParseCache } from "./cache/index.js";
import type { ParseCacheStats } from "@codingverse/shared";

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
  private lastExpandMap: Record<string, import("@codingverse/shared").ExpandEntry> = {};
  /** Last pack's parse-cache hit/miss stats. */
  private lastCacheStats: ParseCacheStats = { hits: 0, misses: 0, total: 0 };

  private constructor(repoPath: string, options: EngineOptions) {
    this.repoPath = repoPath;
    this.options = options;
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

  /** Stage ①-③: build / update the index. */
  async index(): Promise<IndexStats> {
    throw new Error("Engine.index not implemented (M2/M3)");
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

  /** Search mode: vector + BM25 + graph, fused via RRF. */
  async search(_query: string, _opts: SearchOptions = {}): Promise<SearchHit[]> {
    throw new Error("Engine.search not implemented (v1)");
  }

  /**
   * Expand a skeleton symbol by id → its full source text.
   * Uses the most recent pack's expand map; reads the span from disk.
   */
  async expand(id: string): Promise<string> {
    const entry = this.lastExpandMap[id];
    if (!entry) {
      throw new Error(`Unknown expand id: ${id}. Run pack() first, or the id is stale.`);
    }
    const absPath = `${this.repoPath}/${entry.path}`;
    const content = await fs.readFile(absPath, "utf8");
    return content.slice(entry.startByte, entry.endByte);
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

  async close(): Promise<void> {
    // no-op until SQLite connection is introduced (v1)
  }

  /** Exposed for early CLI wiring / debugging. */
  getRepoPath(): string {
    return this.repoPath;
  }

  getStateDir(): string | undefined {
    return this.options.stateDir;
  }
}
