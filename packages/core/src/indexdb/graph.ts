import type { StatementSync } from "node:sqlite";
import type { IndexDb } from "./db.js";
import type { SymbolNode } from "@codingverse/shared";

/**
 * V2-1 CallGraph — call-graph traversal over v1's edges table.
 *
 * One responsibility: read edges + nodes and return a GraphResult for
 * callers / callees / impact. No store, no resolve, no search, no rank —
 * those are upstream / sibling stages. Read-only (no transactions).
 *
 * callers / callees: plain breadth-first traversal along `calls` edges
 * (reverse for callers — who calls this node; forward for callees — what
 * this node calls), depth-limited, deduped via a visited set. Each BFS
 * layer collects the next id set from the edges table, then batch-fetches
 * the full SymbolNode rows with a single `SELECT … WHERE id IN (…)` so a
 * layer costs one edges round-trip + one nodes round-trip.
 *
 * impact: reverse BFS + container drill-down. The intuition — a change to
 * `helper` affects its direct callers; but if a direct caller is a method
 * `X::m` of class `X`, anything that calls ANY method of `X` (e.g. `X::n`)
 * is also impacted, because the class's contract is coupled. So when a BFS
 * layer discovers `X::m`, the layer is expanded to include `X::m`'s
 * sibling methods in `X` AND those siblings' direct callers, all at the
 * same BFS depth (the container expansion does not consume a depth step).
 * If the start node itself is a method in a container, its siblings seed
 * the first layer's reverse step so their callers surface at depth 1.
 *
 * Container membership is detected from `nodes.qualified_name`: a method
 * `m` in class `C` has `qualified_name = "C::m"`; siblings are found by
 * `qualified_name LIKE '<scope>::%'` in the same file, where `<scope>` is
 * the `::`-separated prefix before the method's own name (supports nested
 * classes — `Outer::Inner::m` → scope `Outer::Inner` → pattern
 * `Outer::Inner::%`). Top-level symbols (qualified_name without `::`, or
 * NULL) are never drilled into. The LIKE pattern is escaped so `%`/`_` in
 * a class name are matched literally.
 *
 * The expansion is capped (CONTAINER_DRILL_DOWN_CAP = 50 nodes per layer)
 * to avoid blow-up on huge classes; when a layer would exceed the cap the
 * excess ids AND their edges are dropped (cap-triggering edges are NOT
 * recorded, so GraphResult.edges never references a node id absent from
 * GraphResult.nodes) and `GraphResult.truncated` is set so callers can
 * surface the cut to users. The cap is checked on every addition.
 *
 * node:sqlite IN-list: StatementSync does not accept a variable-length
 * `IN (?, ?, ?)` placeholder list, so the edges-by-frontier and
 * nodes-by-ids queries build a placeholder string dynamically and
 * re-prepare per call. Layers are small (tens of ids), so the re-prepare
 * cost is negligible. Fixed-arity statements (node-by-id, siblings-by-
 * prefix) are prepared once in the constructor, following store.ts /
 * resolve.ts.
 */

export interface GraphResult {
  nodes: SymbolNode[];
  /** edges traversed, as {source, target, kind, line} for display. */
  edges: { source: string; target: string; kind: string; line: number | null }[];
  /** nodes per depth level, for visualization. byDepth[0] = [start node]. */
  byDepth: SymbolNode[][];
  /**
   * Set to true when a container drill-down layer hit
   * CONTAINER_DRILL_DOWN_CAP and dropped the excess ids/edges. V2-4 CLI /
   * V2-6 MCP surface this so users know the impact set was cut, not
   * complete. Undefined/false when no cap fired.
   */
  truncated?: boolean;
}

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string | null;
  file_path: string;
  language: string | null;
  start_line: number | null;
  end_line: number | null;
  start_byte: number | null;
  end_byte: number | null;
  signature: string | null;
  docstring: string | null;
  visibility: string | null;
  pagerank: number | null;
}

interface EdgeRow {
  source: string;
  target: string;
  kind: string;
  line: number | null;
}

const CONTAINER_DRILL_DOWN_CAP = 50;
const IMPACT_DEFAULT_DEPTH = 3;
const EDGE_KIND = "calls";
/**
 * v2.5-V8: per-layer node cap for plain callers/callees BFS. A hub node (e.g.
 * a util called from hundreds of sites) can otherwise fan a single layer out
 * to thousands of nodes, freezing the D3 force graph and bloating the JSON.
 * When a layer would exceed this, the excess new ids are dropped AND edges
 * into dropped ids are not recorded (no dangling edges), with `truncated` set.
 * The drill-down path (impact) keeps its own CONTAINER_DRILL_DOWN_CAP.
 */
const MAX_LAYER_NODES = 200;

export class CallGraph {
  private readonly db: IndexDb;
  private readonly nodeById: StatementSync;
  private readonly siblingsByPrefix: StatementSync;

  constructor(db: IndexDb) {
    this.db = db;
    const d = db.db;
    this.nodeById = d.prepare(
      `SELECT id, kind, name, qualified_name, file_path, language,
              start_line, end_line, start_byte, end_byte,
              signature, docstring, visibility, pagerank
       FROM nodes WHERE id = ?`,
    );
    this.siblingsByPrefix = d.prepare(
      `SELECT id FROM nodes
       WHERE file_path = ? AND qualified_name LIKE ? ESCAPE '\\'
       ORDER BY start_line ASC, id ASC`,
    );
  }

  /** Who calls this node (reverse BFS along edges where target=node). */
  callers(nodeId: string, depth = 1): GraphResult {
    return this.bfs(nodeId, depth, "reverse", false);
  }

  /** What this node calls (forward BFS along edges where source=node). */
  callees(nodeId: string, depth = 1): GraphResult {
    return this.bfs(nodeId, depth, "forward", false);
  }

  /** Impact radius: reverse BFS with container drill-down. */
  impact(nodeId: string, depth = IMPACT_DEFAULT_DEPTH): GraphResult {
    return this.bfs(nodeId, depth, "reverse", true);
  }

  private bfs(
    nodeId: string,
    depth: number,
    direction: "reverse" | "forward",
    drillDown: boolean,
  ): GraphResult {
    const startRow = this.nodeById.get(nodeId) as NodeRow | undefined;
    if (!startRow) throw new Error(`Unknown node id: ${nodeId}`);
    const startNode = rowToSymbolNode(startRow);

    const visited = new Set<string>([nodeId]);
    const nodes: SymbolNode[] = [startNode];
    const byDepth: SymbolNode[][] = [[startNode]];
    const edges: EdgeRow[] = [];
    let frontier: string[] = [nodeId];
    let truncated = false;

    const startSiblings = drillDown ? this.siblingIds(startRow) : [];

    for (let d = 1; d <= depth; d++) {
      // d===1: if the start node is a container method, seed the reverse
      // step with its siblings so their callers surface at depth 1. The
      // siblings themselves are also emitted as depth-1 nodes (added to
      // nextIds below); they are NOT pre-marked visited, so the normal
      // newIds→nodes→byDepth path carries them through.
      const layerSeeds = drillDown && d === 1 ? [nodeId, ...startSiblings] : frontier;
      if (layerSeeds.length === 0) break;

      const stepEdges =
        direction === "reverse"
          ? this.edgesFromTargets(layerSeeds)
          : this.edgesFromSources(layerSeeds);

      const nextIds = new Set<string>(
        direction === "reverse"
          ? stepEdges.map((e) => e.source)
          : stepEdges.map((e) => e.target),
      );

      if (drillDown && d === 1) {
        for (const s of startSiblings) nextIds.add(s);
      }

      if (drillDown) {
        // impact: container drill-down governs the layer (edges are recorded
        // inside expandWithContainerDrillDown / here via CONTAINER_DRILL_DOWN_CAP).
        edges.push(...stepEdges);
        const drill = this.expandWithContainerDrillDown(nextIds, visited);
        edges.push(...drill.edges);
        if (drill.truncated) truncated = true;

        const newIds = [...nextIds].filter((id) => !visited.has(id));
        if (newIds.length === 0) break;
        const newNodes = this.nodesByIds(newIds);
        nodes.push(...newNodes);
        byDepth.push(newNodes);
        for (const id of newIds) visited.add(id);
        frontier = newIds;
        continue;
      }

      // Plain callers/callees: cap the layer's NEW nodes so a hub can't blow
      // the layer up. `admitted` = ids that will be in the result (already
      // visited OR newly admitted under the cap); edges whose endpoint is not
      // admitted are dropped so GraphResult.edges never dangles.
      const candidates = [...nextIds].filter((id) => !visited.has(id));
      let newIds = candidates;
      if (candidates.length > MAX_LAYER_NODES) {
        newIds = candidates.slice(0, MAX_LAYER_NODES);
        truncated = true;
      }
      const admitted = new Set<string>(visited);
      for (const id of newIds) admitted.add(id);
      for (const e of stepEdges) {
        const endpoint = direction === "reverse" ? e.source : e.target;
        if (admitted.has(endpoint)) edges.push(e);
      }
      if (newIds.length === 0) break;

      const newNodes = this.nodesByIds(newIds);
      nodes.push(...newNodes);
      byDepth.push(newNodes);
      for (const id of newIds) visited.add(id);
      frontier = newIds;
    }

    return { nodes, edges: dedupEdges(edges), byDepth, truncated };
  }

  /**
   * Container drill-down: for each id in `layerIds` that is a method in a
   * container, add its sibling methods and those siblings' direct callers
   * to `layerIds` (mutated), all at the same BFS depth. Returns the extra
   * edges traversed (sibling → its caller) and a `truncated` flag set when
   * CONTAINER_DRILL_DOWN_CAP was hit. Bounded by the cap: once `layerIds`
   * reaches the cap, further additions are dropped AND their edges are NOT
   * recorded (the cap-triggering edge's source would not be in `layerIds`,
   * so emitting it would dangle a node id absent from the result nodes).
   * Only the ids present at entry are drilled into (no chaining through
   * drill-down-added callers), which keeps the expansion a single pass and
   * naturally bounded.
   */
  private expandWithContainerDrillDown(
    layerIds: Set<string>,
    visited: Set<string>,
  ): { edges: EdgeRow[]; truncated: boolean } {
    const extraEdges: EdgeRow[] = [];
    let truncated = false;
    const initialIds = [...layerIds];
    for (const id of initialIds) {
      if (layerIds.size >= CONTAINER_DRILL_DOWN_CAP) {
        truncated = true;
        break;
      }
      const row = this.nodeById.get(id) as NodeRow | undefined;
      if (!row || !row.qualified_name || !row.qualified_name.includes("::")) continue;
      for (const sibId of this.siblingIds(row)) {
        if (visited.has(sibId) || layerIds.has(sibId)) continue;
        if (layerIds.size >= CONTAINER_DRILL_DOWN_CAP) {
          truncated = true;
          break;
        }
        layerIds.add(sibId);
        for (const e of this.edgesFromTargets([sibId])) {
          if (!visited.has(e.source) && !layerIds.has(e.source)) {
            if (layerIds.size >= CONTAINER_DRILL_DOWN_CAP) {
              truncated = true;
              break;
            }
            // Record the edge only when its caller id is admitted into the
            // layer — otherwise GraphResult.edges would reference a source
            // absent from GraphResult.nodes (dangling edge).
            layerIds.add(e.source);
            extraEdges.push(e);
          } else {
            // Caller already present/visited: edge still traversed, no
            // dangle risk since the source will already be in nodes.
            extraEdges.push(e);
          }
        }
      }
    }
    return { edges: extraEdges, truncated };
  }

  /** Sibling method ids of `row` in its container, or [] if `row` is not in a container. */
  private siblingIds(row: NodeRow): string[] {
    if (!row.qualified_name || !row.qualified_name.includes("::")) return [];
    const scope = row.qualified_name.slice(0, row.qualified_name.lastIndexOf("::"));
    const pattern = `${escapeLike(scope)}::%`;
    const rows = this.siblingsByPrefix.all(row.file_path, pattern) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  private edgesFromTargets(targets: string[]): EdgeRow[] {
    if (targets.length === 0) return [];
    const placeholders = targets.map(() => "?").join(",");
    const stmt = this.db.db.prepare(
      `SELECT source, target, kind, line FROM edges
       WHERE target IN (${placeholders}) AND kind = ?
       ORDER BY id`,
    );
    return stmt.all(...targets, EDGE_KIND) as unknown as EdgeRow[];
  }

  private edgesFromSources(sources: string[]): EdgeRow[] {
    if (sources.length === 0) return [];
    const placeholders = sources.map(() => "?").join(",");
    const stmt = this.db.db.prepare(
      `SELECT source, target, kind, line FROM edges
       WHERE source IN (${placeholders}) AND kind = ?
       ORDER BY id`,
    );
    return stmt.all(...sources, EDGE_KIND) as unknown as EdgeRow[];
  }

  private nodesByIds(ids: string[]): SymbolNode[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.db.prepare(
      `SELECT id, kind, name, qualified_name, file_path, language,
              start_line, end_line, start_byte, end_byte,
              signature, docstring, visibility, pagerank
       FROM nodes WHERE id IN (${placeholders})
       ORDER BY start_line ASC, id ASC`,
    );
    return (stmt.all(...ids) as unknown as NodeRow[]).map(rowToSymbolNode);
  }
}

function rowToSymbolNode(row: NodeRow): SymbolNode {
  return {
    id: row.id,
    kind: row.kind as SymbolNode["kind"],
    name: row.name,
    qualifiedName: row.qualified_name ?? undefined,
    filePath: row.file_path,
    language: row.language ?? "",
    startLine: row.start_line ?? 0,
    endLine: row.end_line ?? 0,
    startByte: row.start_byte ?? 0,
    endByte: row.end_byte ?? 0,
    signature: row.signature ?? undefined,
    docstring: row.docstring ?? undefined,
    visibility: (row.visibility as SymbolNode["visibility"]) ?? undefined,
    pagerank: row.pagerank ?? undefined,
  };
}

function dedupEdges(edges: EdgeRow[]): GraphResult["edges"] {
  const seen = new Set<string>();
  const out: GraphResult["edges"] = [];
  for (const e of edges) {
    const key = `${e.source}|${e.target}|${e.kind}|${e.line ?? -1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: e.source, target: e.target, kind: e.kind, line: e.line });
  }
  return out;
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
