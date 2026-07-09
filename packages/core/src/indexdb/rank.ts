import type { StatementSync } from "node:sqlite";
import type { IndexDb } from "./db.js";

/**
 * V2-2 PageRank — Personalized PageRank power iteration over v1's
 * nodes/edges tables, written back to nodes.pagerank.
 *
 * One responsibility: compute PageRank over the call graph and persist
 * it. No graph traversal (graph.ts), no store/resolve/search — those are
 * sibling stages. Reads nodes + edges (kind='calls'); writes nodes.pagerank
 * only. No graph library — pure JS power iteration.
 *
 * Algorithm (Aider repomap.py:481-525 simplified — no chat personalization,
 * so the personalization vector is uniform 1/N):
 *
 *   1. Build graph in memory: nodes → id→index map (keep name for
 *      down-weight checks); edges WHERE kind='calls' → edge list;
 *      out-degree per source.
 *   2. Edge weight = mul_source / out_degree_source, where mul_source is:
 *        - base 1
 *        - ×0.1 if source name starts with '_'           (private down-weight)
 *        - ×0.1 if source name is "over-heated"           (defined in >5 files)
 *        - compounds to 0.01 if both
 *      Standard PageRank normalization in the denominator + Aider's mul
 *      multiplier in the numerator. A private source (mul=0.1) with
 *      out-degree 2 → each edge weight = 0.05.
 *   3. Power iteration:
 *        rank[v] = 1/N  (uniform init)
 *        for iter in 1..maxIter:
 *          new_rank[v] = (1-d)/N
 *          dangling_sum = Σ_{u: out_degree=0} rank[u]    (from OLD rank)
 *          for each edge (u,v,w): new_rank[v] += d * rank[u] * w
 *          new_rank[v] += d * dangling_sum / N            (uniform redistribution)
 *          delta = Σ_v |new_rank[v] - rank[v]|
 *          rank = new_rank
 *          if delta < epsilon: converged; break
 *      Defaults: damping d=0.85, epsilon=1e-6, maxIter=100.
 *      N=0 short-circuits to {iterations:0, converged:true}.
 *   4. Writeback: clear all pagerank to 0 (stale ranks from removed nodes
 *      must clear), then UPDATE per node, in a manual BEGIN/COMMIT/ROLLBACK
 *      transaction (node:sqlite has no .transaction() helper), matching
 *      store.ts.
 */

export interface RankOptions {
  damping?: number;
  epsilon?: number;
  maxIter?: number;
}

export interface RankStats {
  iterations: number;
  converged: boolean;
  durationMs: number;
  nodeCount: number;
  edgeCount: number;
}

interface NodeIdNameRow {
  id: string;
  name: string;
}

interface EdgeRow {
  source: string;
  target: string;
}

interface NameRow {
  name: string;
}

interface PagerankRow {
  pagerank: number | null;
}

interface IdPagerankRow {
  id: string;
  pagerank: number | null;
}

const DEFAULT_DAMPING = 0.85;
const DEFAULT_EPSILON = 1e-6;
const DEFAULT_MAX_ITER = 100;
const PRIVATE_FACTOR = 0.1;
const OVERHEATED_FACTOR = 0.1;
const OVERHEATED_FILE_THRESHOLD = 5;
const EDGE_KIND = "calls";

export class PageRank {
  private readonly db: IndexDb;
  private readonly selectAllNodeIdsNames: StatementSync;
  private readonly selectAllCallEdges: StatementSync;
  private readonly selectOverheatedNames: StatementSync;
  private readonly updatePagerank: StatementSync;
  private readonly clearPagerank: StatementSync;
  private readonly getPagerank: StatementSync;
  private readonly topNByPagerank: StatementSync;
  private readonly topNByFile: StatementSync;

  constructor(db: IndexDb) {
    this.db = db;
    const d = db.db;
    this.selectAllNodeIdsNames = d.prepare("SELECT id, name FROM nodes");
    this.selectAllCallEdges = d.prepare(
      "SELECT source, target FROM edges WHERE kind = ?",
    );
    this.selectOverheatedNames = d.prepare(
      "SELECT name FROM nodes GROUP BY name HAVING COUNT(DISTINCT file_path) > ?",
    );
    this.updatePagerank = d.prepare("UPDATE nodes SET pagerank = ? WHERE id = ?");
    this.clearPagerank = d.prepare("UPDATE nodes SET pagerank = 0");
    this.getPagerank = d.prepare("SELECT pagerank FROM nodes WHERE id = ?");
    this.topNByPagerank = d.prepare(
      "SELECT id, pagerank FROM nodes ORDER BY pagerank DESC, id ASC LIMIT ?",
    );
    this.topNByFile = d.prepare(
      "SELECT id, pagerank FROM nodes WHERE file_path = ? ORDER BY pagerank DESC, id ASC LIMIT ?",
    );
  }

  /** Compute PageRank over nodes/edges, write back to nodes.pagerank. */
  rank(opts?: RankOptions): RankStats {
    const start = Date.now();
    const damping = opts?.damping ?? DEFAULT_DAMPING;
    const epsilon = opts?.epsilon ?? DEFAULT_EPSILON;
    const maxIter = opts?.maxIter ?? DEFAULT_MAX_ITER;

    const nodeRows = this.selectAllNodeIdsNames.all() as unknown as NodeIdNameRow[];
    const N = nodeRows.length;

    if (N === 0) {
      return {
        iterations: 0,
        converged: true,
        durationMs: Date.now() - start,
        nodeCount: 0,
        edgeCount: 0,
      };
    }

    const edgeRows = this.selectAllCallEdges.all(EDGE_KIND) as unknown as EdgeRow[];
    const overheatedRows = this.selectOverheatedNames.all(
      OVERHEATED_FILE_THRESHOLD,
    ) as unknown as NameRow[];
    const overheated = new Set(overheatedRows.map((r) => r.name));

    const indexById = new Map<string, number>();
    const names = new Array<string>(N);
    for (let i = 0; i < N; i++) {
      indexById.set(nodeRows[i].id, i);
      names[i] = nodeRows[i].name;
    }

    const outDegree = new Array<number>(N).fill(0);
    const edges: Array<{ src: number; tgt: number; weight: number }> = [];
    for (const e of edgeRows) {
      const src = indexById.get(e.source);
      const tgt = indexById.get(e.target);
      if (src === undefined || tgt === undefined) continue;
      outDegree[src]++;
      edges.push({ src, tgt, weight: 0 });
    }

    for (const e of edges) {
      let mul = 1;
      const name = names[e.src];
      if (name.startsWith("_")) mul *= PRIVATE_FACTOR;
      if (overheated.has(name)) mul *= OVERHEATED_FACTOR;
      e.weight = mul / outDegree[e.src];
    }

    let rank = new Array<number>(N).fill(1 / N);
    let converged = false;
    let iterations = 0;

    for (let iter = 1; iter <= maxIter; iter++) {
      const newRank = new Array<number>(N).fill((1 - damping) / N);

      let danglingSum = 0;
      for (let i = 0; i < N; i++) {
        if (outDegree[i] === 0) danglingSum += rank[i];
      }

      for (const e of edges) {
        newRank[e.tgt] += damping * rank[e.src] * e.weight;
      }

      const danglingShare = (damping * danglingSum) / N;
      for (let i = 0; i < N; i++) {
        newRank[i] += danglingShare;
      }

      let delta = 0;
      for (let i = 0; i < N; i++) {
        delta += Math.abs(newRank[i] - rank[i]);
      }

      rank = newRank;
      iterations = iter;
      if (delta < epsilon) {
        converged = true;
        break;
      }
    }

    this.db.db.exec("BEGIN");
    try {
      this.clearPagerank.run();
      for (let i = 0; i < N; i++) {
        this.updatePagerank.run(rank[i], nodeRows[i].id);
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

    return {
      iterations,
      converged,
      durationMs: Date.now() - start,
      nodeCount: N,
      edgeCount: edges.length,
    };
  }

  /** Get a node's pagerank (0 if unranked or missing). */
  get(nodeId: string): number {
    const row = this.getPagerank.get(nodeId) as PagerankRow | undefined;
    return row?.pagerank ?? 0;
  }

  /** Top-N nodes by pagerank, optionally scoped to a file. */
  topN(n: number, filePath?: string): { id: string; pagerank: number }[] {
    const rows =
      filePath !== undefined
        ? (this.topNByFile.all(filePath, n) as unknown as IdPagerankRow[])
        : (this.topNByPagerank.all(n) as unknown as IdPagerankRow[]);
    return rows.map((r) => ({ id: r.id, pagerank: r.pagerank ?? 0 }));
  }
}
