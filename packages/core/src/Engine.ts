import type {
  IndexStats,
  PackOptions,
  PackResult,
  SearchOptions,
  SearchHit,
  SymbolNode,
  DashboardStats,
} from "@codingverse/shared";

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

  private constructor(repoPath: string, options: EngineOptions) {
    this.repoPath = repoPath;
    this.options = options;
  }

  static async open(repoPath: string, opts: EngineOptions = {}): Promise<Engine> {
    return new Engine(repoPath, opts);
  }

  /** Stage ①-③: build / update the index. */
  async index(): Promise<IndexStats> {
    throw new Error("Engine.index not implemented (M2/M3)");
  }

  /** Incremental sync via git blob hash fast path. */
  async sync(): Promise<IndexStats> {
    throw new Error("Engine.sync not implemented (M6)");
  }

  /** Pack mode: layered compression into a single LLM context. */
  async pack(_opts: PackOptions = {}): Promise<PackResult> {
    throw new Error("Engine.pack not implemented (M4/M5)");
  }

  /** Search mode: vector + BM25 + graph, fused via RRF. */
  async search(_query: string, _opts: SearchOptions = {}): Promise<SearchHit[]> {
    throw new Error("Engine.search not implemented (v1)");
  }

  /** Expand a skeleton node by id (MCP lc_missing equivalent). */
  async expand(_nodeId: string): Promise<string> {
    throw new Error("Engine.expand not implemented (M4)");
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
