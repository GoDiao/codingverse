import type { Layer } from "@codingverse/shared";

/**
 * Layer selection — greedy budget fitting.
 *
 * Each file has a token cost at each available layer (full > skeleton >
 * outline > omit=0). Start everyone at `full`; while over budget, downgrade
 * the least-important file by one layer, repeat until it fits (or everything
 * is omitted).
 *
 * Importance ranking (M4 heuristic; PageRank precision lands in v2):
 *   alwaysFull whitelist  →  never downgraded (rank +∞)
 *   code files (has symbols)  →  ranked above data/doc files
 *   within a tier: larger files are downgraded first (bigger savings)
 */

export interface LayerCandidate {
  path: string;
  /** Token cost at each layer. omit is always 0. */
  cost: Record<Layer, number>;
  /** Higher = more important = downgraded later. */
  importance: number;
  /** Pinned to full (alwaysFull whitelist) — never downgraded. */
  pinned: boolean;
}

/** Ordered from richest to cheapest. */
const LAYER_ORDER: Layer[] = ["full", "skeleton", "outline", "omit"];

const nextLayer = (layer: Layer): Layer | undefined => {
  const i = LAYER_ORDER.indexOf(layer);
  return i >= 0 && i < LAYER_ORDER.length - 1 ? LAYER_ORDER[i + 1] : undefined;
};

export interface LayerDecision {
  path: string;
  layer: Layer;
  tokens: number;
}

export interface LayerPlan {
  decisions: LayerDecision[];
  total: number;
  budget: number;
  fits: boolean;
}

/**
 * Choose a layer for each candidate so the total token cost fits `budget`.
 * If `strategy` forces a fixed layer, every file starts there (pinned files
 * still stay full).
 */
export const selectLayers = (
  candidates: LayerCandidate[],
  budget: number,
  strategy: "auto" | "full" | "skeleton" | "outline" = "auto",
): LayerPlan => {
  const startLayer: Layer = strategy === "auto" ? "full" : strategy;

  // Current layer per file.
  const layerOf = new Map<string, Layer>();
  for (const c of candidates) {
    layerOf.set(c.path, c.pinned ? "full" : startLayer);
  }

  const tokensOf = (c: LayerCandidate): number => c.cost[layerOf.get(c.path)!];
  const total = (): number => candidates.reduce((sum, c) => sum + tokensOf(c), 0);

  // Downgrade queue: least important first; within equal importance, larger
  // current cost first (bigger immediate saving).
  const downgradable = (): LayerCandidate[] =>
    candidates
      .filter((c) => !c.pinned && nextLayer(layerOf.get(c.path)!) !== undefined)
      .sort(
        (a, b) => a.importance - b.importance || tokensOf(b) - tokensOf(a),
      );

  // Greedy: downgrade until we fit or nothing left to downgrade.
  while (total() > budget) {
    const queue = downgradable();
    if (queue.length === 0) break;
    const victim = queue[0]!;
    const next = nextLayer(layerOf.get(victim.path)!)!;
    layerOf.set(victim.path, next);
  }

  const decisions: LayerDecision[] = candidates.map((c) => ({
    path: c.path,
    layer: layerOf.get(c.path)!,
    tokens: tokensOf(c),
  }));

  const finalTotal = total();
  return { decisions, total: finalTotal, budget, fits: finalTotal <= budget };
};
