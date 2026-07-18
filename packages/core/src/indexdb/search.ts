import type { StatementSync } from "node:sqlite";
import type { IndexDb } from "./db.js";
import { CallGraph } from "./graph.js";

/**
 * V1-4 SearchEngine — dual-path retrieval with Reciprocal Rank Fusion.
 *
 * Pipeline: query → BM25 recall (FTS5) + co-location graph expansion →
 * RRF fusion (k=60) → top-k SearchRow[]. One responsibility: turn a query
 * string into a ranked result list. No store/resolve/embedding — those are
 * upstream stages.
 *
 * RRF formula (k=60):
 *   rrf(d) = bm25Weight · 1/(60 + rank_bm25(d))
 *          + graphWeight · 1/(60 + rank_graph(d))
 * Ranks are 1-indexed per path. A document absent from a path contributes 0
 * from that path (equivalent to rank = ∞). All unique chunk ids from both
 * paths are merged, scored, and sorted by rrf descending; topK is taken.
 *
 * Call-graph expansion (v3 — real call graph, replaces v1's same-file
 * proximity): the BM25 top-N chunks are seeds. Each seed chunk maps to the
 * symbol node(s) it overlaps (same file, line-range intersection). From those
 * seed nodes we walk the call graph — both callers (reverse) and callees
 * (forward) — up to `graphDepth` hops. Every reached node maps back to the
 * chunk(s) it overlaps; those chunks are graph neighbors with distance = hop
 * count to the nearest seed node. Graph ranks are assigned by global order
 * (hops asc, then pagerank desc, then start_line asc, then id asc). A chunk
 * whose node has no call edges gets no graph rank. This makes the graph path a
 * genuine "related-by-calls" signal (cross-file), not mere textual adjacency.
 *
 * graphDepth: default 1 (direct callers/callees). Clamped to [0,3]; 0 disables
 * the graph path (BM25-only).
 *
 * Scoring fields on each SearchRow:
 *   scores.bm25  — negated bm25() value (higher = better); 0 if not in BM25.
 *   scores.graph — graph rank (1-based; 0 if no graph presence).
 *   scores.rrf   — fused reciprocal-rank score.
 */

export interface SearchParams {
  query: string;
  topK?: number;
  bm25Weight?: number;
  graphWeight?: number;
  graphDepth?: number;
}

export interface SearchRow {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;
  scores: { bm25: number; graph: number; rrf: number };
  relatedNodes: string[];
}

/**
 * v2.5-V6: per-path breakdown for Dashboard board ④ (search inspector).
 * Exposes the intermediate BM25 / co-location / fused results that `search()`
 * computes internally, so the UI can show each retrieval path independently
 * and how RRF combined them. `search()` is unchanged — both share recall().
 */
export interface SearchDebugResult {
  query: string;
  /** FTS5 MATCH string after CamelCase/tokenization (what actually ran). */
  ftsQuery: string;
  /** BM25 path hits, in BM25 rank order. score = negated bm25() (higher=better). */
  bm25: Array<{
    chunkId: string;
    filePath: string;
    startLine: number;
    score: number;
    rank: number;
  }>;
  /** Call-graph path hits, in hop order. hops = call-graph distance to nearest seed node. */
  graph: Array<{
    chunkId: string;
    filePath: string;
    startLine: number;
    hops: number;
    rank: number;
  }>;
  /** Fused top-k, with each path's contributing rank (0 = absent from that path). */
  fused: Array<{
    chunkId: string;
    filePath: string;
    startLine: number;
    rrf: number;
    bm25Rank: number;
    graphRank: number;
  }>;
  rrfK: number;
  weights: { bm25: number; graph: number };
}

interface RecallResult {
  ftsQuery: string;
  bm25Rank: Map<string, number>;
  bm25Score: Map<string, number>;
  graphRank: Map<string, number>;
  graphHops: Map<string, number>;
  chunkMeta: Map<
    string,
    { filePath: string; startLine: number; endLine: number; body: string }
  >;
  fused: Array<{ id: string; bm25: number; graph: number; rrf: number }>;
  bm25Weight: number;
  graphWeight: number;
}

interface Bm25Row {
  id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  body: string;
  score: number;
}

interface GraphCandidate {
  id: string;
  startLine: number;
  endLine: number;
  body: string;
  filePath: string;
  hops: number;
  pagerank: number;
}

const RRF_K = 60;
const SEED_CAP = 60;
const DEFAULT_TOP_K = 20;
const DEFAULT_WEIGHT = 1;
const MAX_GRAPH_DEPTH = 3;
const GRAPH_SEED_NODE_CAP = 40;

export class SearchEngine {
  private readonly bm25Search: StatementSync;
  private readonly relatedNodes: StatementSync;
  private readonly nodesByChunk: StatementSync;
  private readonly chunksByNode: StatementSync;
  private readonly callGraph: CallGraph;

  constructor(db: IndexDb) {
    const d = db.db;
    this.callGraph = new CallGraph(db);
    this.bm25Search = d.prepare(
      `SELECT c.id, c.file_path, c.start_line, c.end_line, c.body,
              bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.id
       WHERE chunks_fts MATCH ?
       ORDER BY score
       LIMIT ?`,
    );
    this.relatedNodes = d.prepare(
      `SELECT id FROM nodes WHERE file_path = ? ORDER BY pagerank DESC, start_line ASC LIMIT 5`,
    );
    // Bridge chunk↔node by same-file line-range overlap. A chunk overlaps a
    // node when they share a file and their [start,end] line spans intersect.
    this.nodesByChunk = d.prepare(
      `SELECT id, pagerank FROM nodes
       WHERE file_path = ? AND start_line <= ? AND end_line >= ?
       ORDER BY (end_line - start_line) ASC, start_line ASC`,
    );
    this.chunksByNode = d.prepare(
      `SELECT c.id, c.file_path, c.start_line, c.end_line, c.body, n.pagerank
       FROM nodes n
       JOIN chunks c
         ON c.file_path = n.file_path
        AND c.start_line <= n.end_line AND c.end_line >= n.start_line
       WHERE n.id = ?`,
    );
  }

  search(params: SearchParams): SearchRow[] {
    const recall = this.recall(params);
    if (!recall) return [];
    const { fused, chunkMeta } = recall;
    const topK = params.topK ?? DEFAULT_TOP_K;

    const top = fused.slice(0, topK);
    const results: SearchRow[] = [];
    for (const f of top) {
      const meta = chunkMeta.get(f.id)!;
      const nodeRows = this.relatedNodes.all(meta.filePath) as unknown as Array<{
        id: string;
      }>;
      results.push({
        chunkId: f.id,
        filePath: meta.filePath,
        startLine: meta.startLine,
        endLine: meta.endLine,
        body: meta.body,
        scores: { bm25: f.bm25, graph: f.graph, rrf: f.rrf },
        relatedNodes: nodeRows.map((r) => r.id),
      });
    }
    return results;
  }

  /**
   * v2.5-V6: run the same recall as search() but return each path's
   * independent hits + the fused top-k with per-path ranks, for board ④.
   * Empty query / no BM25 hits → all-empty result (never throws).
   */
  searchDebug(params: SearchParams): SearchDebugResult {
    const topK = params.topK ?? DEFAULT_TOP_K;
    const bm25Weight = params.bm25Weight ?? DEFAULT_WEIGHT;
    const graphWeight = params.graphWeight ?? DEFAULT_WEIGHT;
    const empty: SearchDebugResult = {
      query: params.query ?? "",
      ftsQuery: "",
      bm25: [],
      graph: [],
      fused: [],
      rrfK: RRF_K,
      weights: { bm25: bm25Weight, graph: graphWeight },
    };

    const recall = this.recall(params);
    if (!recall) return empty;
    const { ftsQuery, bm25Rank, graphRank, graphHops, chunkMeta, fused } = recall;

    const meta = (id: string) => chunkMeta.get(id)!;

    const bm25 = [...bm25Rank.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id, rank]) => ({
        chunkId: id,
        filePath: meta(id).filePath,
        startLine: meta(id).startLine,
        score: recall.bm25Score.get(id) ?? 0,
        rank,
      }));

    const graph = [...graphRank.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id, rank]) => ({
        chunkId: id,
        filePath: meta(id).filePath,
        startLine: meta(id).startLine,
        hops: graphHops.get(id) ?? 0,
        rank,
      }));

    const fusedOut = fused.slice(0, topK).map((f) => ({
      chunkId: f.id,
      filePath: meta(f.id).filePath,
      startLine: meta(f.id).startLine,
      rrf: f.rrf,
      bm25Rank: bm25Rank.get(f.id) ?? 0,
      graphRank: graphRank.get(f.id) ?? 0,
    }));

    return {
      query: params.query ?? "",
      ftsQuery,
      bm25,
      graph,
      fused: fusedOut,
      rrfK: RRF_K,
      weights: { bm25: recall.bm25Weight, graph: recall.graphWeight },
    };
  }

  /**
   * Shared recall + fusion. Returns null on empty query / no BM25 hits.
   * Both search() and searchDebug() consume this so the ranking logic lives
   * in exactly one place (no behavior drift between the two entry points).
   */
  private recall(params: SearchParams): RecallResult | null {
    const query = (params.query ?? "").trim();
    if (query.length < 2) return null;

    const topK = params.topK ?? DEFAULT_TOP_K;
    const bm25Weight = params.bm25Weight ?? DEFAULT_WEIGHT;
    const graphWeight = params.graphWeight ?? DEFAULT_WEIGHT;
    const graphDepth = Math.max(0, Math.min(params.graphDepth ?? 1, MAX_GRAPH_DEPTH));

    const ftsQuery = tokenizeQuery(query);
    if (ftsQuery.length === 0) return null;

    const seedLimit = Math.min(topK * 3, SEED_CAP);
    const bm25Rows = this.bm25Search.all(ftsQuery, seedLimit) as unknown as Bm25Row[];
    if (bm25Rows.length === 0) return null;

    const bm25Rank = new Map<string, number>();
    const bm25Score = new Map<string, number>();
    const chunkMeta = new Map<
      string,
      { filePath: string; startLine: number; endLine: number; body: string }
    >();
    for (let i = 0; i < bm25Rows.length; i++) {
      const r = bm25Rows[i]!;
      bm25Rank.set(r.id, i + 1);
      bm25Score.set(r.id, -r.score);
      chunkMeta.set(r.id, {
        filePath: r.file_path,
        startLine: r.start_line,
        endLine: r.end_line,
        body: r.body,
      });
    }

    const graphRank = new Map<string, number>();
    const graphHops = new Map<string, number>();
    if (graphDepth >= 1) {
      // 1) Seed chunks → seed nodes (chunk overlaps node by file + line span).
      const seedNodeIds = new Set<string>();
      for (const r of bm25Rows) {
        const nodeRows = this.nodesByChunk.all(
          r.file_path,
          r.end_line,
          r.start_line,
        ) as unknown as Array<{ id: string; pagerank: number }>;
        for (const n of nodeRows) {
          seedNodeIds.add(n.id);
          if (seedNodeIds.size >= GRAPH_SEED_NODE_CAP) break;
        }
        if (seedNodeIds.size >= GRAPH_SEED_NODE_CAP) break;
      }

      // 2) Walk callers + callees from each seed node; record min hop per node.
      const nodeHops = new Map<string, number>();
      for (const seedId of seedNodeIds) {
        for (const dir of ["callers", "callees"] as const) {
          const res =
            dir === "callers"
              ? this.callGraph.callers(seedId, graphDepth)
              : this.callGraph.callees(seedId, graphDepth);
          // byDepth[h] = nodes reached at hop h; byDepth[0] = [seed itself].
          for (let h = 1; h < res.byDepth.length; h++) {
            for (const n of res.byDepth[h]!) {
              const prev = nodeHops.get(n.id);
              if (prev === undefined || h < prev) nodeHops.set(n.id, h);
            }
          }
        }
      }

      // 3) Neighbor nodes → chunks they overlap. distance = node hop count.
      const candidates = new Map<string, GraphCandidate>();
      for (const [nodeId, hops] of nodeHops) {
        const chunkRows = this.chunksByNode.all(nodeId) as unknown as Array<{
          id: string;
          file_path: string;
          start_line: number;
          end_line: number;
          body: string;
          pagerank: number;
        }>;
        for (const c of chunkRows) {
          // A seed chunk reached via calls scores on BOTH paths (strongest
          // signal — textually relevant AND call-related), so we do NOT skip
          // seeds here; RRF rewards dual-path presence.
          const existing = candidates.get(c.id);
          if (existing === undefined || hops < existing.hops) {
            candidates.set(c.id, {
              id: c.id,
              startLine: c.start_line,
              endLine: c.end_line,
              body: c.body,
              filePath: c.file_path,
              hops,
              pagerank: c.pagerank ?? 0,
            });
          }
        }
      }

      const graphCandidates = [...candidates.values()].sort((a, b) => {
        if (a.hops !== b.hops) return a.hops - b.hops;
        if (a.pagerank !== b.pagerank) return b.pagerank - a.pagerank;
        if (a.startLine !== b.startLine) return a.startLine - b.startLine;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      for (let i = 0; i < graphCandidates.length; i++) {
        const g = graphCandidates[i]!;
        graphRank.set(g.id, i + 1);
        graphHops.set(g.id, g.hops);
        if (!chunkMeta.has(g.id)) {
          chunkMeta.set(g.id, {
            filePath: g.filePath,
            startLine: g.startLine,
            endLine: g.endLine,
            body: g.body,
          });
        }
      }
    }

    const allIds = new Set<string>([...bm25Rank.keys(), ...graphRank.keys()]);
    const fused: Array<{ id: string; bm25: number; graph: number; rrf: number }> = [];
    for (const id of allIds) {
      const bRank = bm25Rank.get(id);
      const gRank = graphRank.get(id);
      const bm25Term = bRank !== undefined ? bm25Weight / (RRF_K + bRank) : 0;
      const graphTerm = gRank !== undefined ? graphWeight / (RRF_K + gRank) : 0;
      fused.push({
        id,
        bm25: bm25Score.get(id) ?? 0,
        graph: gRank ?? 0,
        rrf: bm25Term + graphTerm,
      });
    }

    fused.sort((a, b) => b.rrf - a.rrf);

    return {
      ftsQuery,
      bm25Rank,
      bm25Score,
      graphRank,
      graphHops,
      chunkMeta,
      fused,
      bm25Weight,
      graphWeight,
    };
  }
}

/**
 * Preprocess a raw query into an FTS5 MATCH string: split CamelCase
 * (TokenBudget → "Token Budget", parseFile → "parse File", XMLParser →
 * "XML Parser"), split on non-alphanumeric, lowercase, and join with spaces
 * (FTS5 implicit AND). Returns "" when no alphanumeric tokens remain.
 */
function tokenizeQuery(query: string): string {
  const tokens: string[] = [];
  for (const part of query.split(/[^0-9a-zA-Z]+/)) {
    if (!part) continue;
    for (const word of splitCamelCase(part).split(" ")) {
      const lw = word.toLowerCase();
      if (lw) tokens.push(lw);
    }
  }
  return tokens.join(" ");
}

/**
 * Insert a space at CamelCase boundaries:
 *   - uppercase after lowercase  (tokenBudget → "token Budget")
 *   - uppercase before lowercase when prev is uppercase (XMLParser → "XML Parser")
 */
function splitCamelCase(token: string): string {
  let out = "";
  for (let i = 0; i < token.length; i++) {
    const c = token[i]!;
    const prev = token[i - 1];
    const next = token[i + 1];
    if (i > 0 && isUpper(c)) {
      if (isLower(prev) || (isUpper(prev) && next !== undefined && isLower(next))) {
        out += " ";
      }
    }
    out += c;
  }
  return out;
}

function isUpper(c: string | undefined): boolean {
  return c !== undefined && c >= "A" && c <= "Z";
}

function isLower(c: string | undefined): boolean {
  return c !== undefined && c >= "a" && c <= "z";
}
