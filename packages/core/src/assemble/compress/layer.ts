import type { Layer } from "@codingverse/shared";

/**
 * Layer selection — greedy budget fitting with backfill.
 *
 * Two passes:
 *
 *   ① Downgrade — start everyone at `full`; while over budget, downgrade
 *     the least-important file by one layer, repeat until it fits (or
 *     everything is omitted). Larger current-cost files go first within a
 *     tier (bigger immediate saving).
 *
 *   ② Backfill — after downgrading we may sit well under budget. Walk
 *     candidates by *descending* importance and promote each to the
 *     highest layer it can afford with the remaining budget, capped at
 *     `ceiling` (full for auto; the forced layer for a fixed strategy, so
 *     `--strategy skeleton` never escalates past skeleton).
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

  // Backfill pass: promote files into the leftover budget.
  // After downgrading we may sit well under budget (e.g. budget 1500 but
  // total 613 because the last downgrade overshot). Walk candidates by
  // descending importance and raise each to the highest layer it can
  // afford, capped at `ceiling` so a forced strategy never escalates past
  // the user's chosen layer.
  const ceiling: Layer = strategy === "auto" ? "full" : startLayer;
  const ceilingIdx = LAYER_ORDER.indexOf(ceiling);

  let remaining = budget - total();
  if (remaining > 0) {
    const upgradable = candidates
      .filter(
        (c) => !c.pinned && LAYER_ORDER.indexOf(layerOf.get(c.path)!) > ceilingIdx,
      )
      .sort((a, b) => b.importance - a.importance || tokensOf(a) - tokensOf(b));

    for (const c of upgradable) {
      const cur = layerOf.get(c.path)!;
      const curIdx = LAYER_ORDER.indexOf(cur);
      const curCost = c.cost[cur];
      // Try layers from ceiling (richest allowed) down toward cur: pick the
      // highest layer whose delta fits the remaining budget.
      for (let i = ceilingIdx; i < curIdx; i++) {
        const target = LAYER_ORDER[i]!;
        const delta = c.cost[target] - curCost;
        if (delta > 0 && delta <= remaining) {
          layerOf.set(c.path, target);
          remaining -= delta;
          break;
        }
      }
    }
  }

  const decisions: LayerDecision[] = candidates.map((c) => ({
    path: c.path,
    layer: layerOf.get(c.path)!,
    tokens: tokensOf(c),
  }));

  const finalTotal = total();
  return { decisions, total: finalTotal, budget, fits: finalTotal <= budget };
};
