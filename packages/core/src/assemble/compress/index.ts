// Stage ④ (compress): layered compression of parsed files into a pack.

import { minimatch } from "minimatch";
import {
  DEFAULT_TOKEN_BUDGET,
  type ParsedFile,
  type PackedFile,
  type ExpandEntry,
  type Layer,
  type PackOptions,
} from "@codingverse/shared";
import { getLanguageConfig } from "../../parse/languages/registry.js";
import { TokenBudget } from "../../budget/index.js";
import { renderSkeleton } from "./skeleton.js";
import { renderOutline } from "./outline.js";
import { selectLayers, type LayerCandidate } from "./layer.js";

export { renderSkeleton, symbolId } from "./skeleton.js";
export { renderOutline } from "./outline.js";
export { selectLayers } from "./layer.js";
export type { LayerCandidate, LayerPlan, LayerDecision } from "./layer.js";

export interface CompressResult {
  files: PackedFile[];
  layerMap: Record<string, Layer>;
  expandMap: Record<string, ExpandEntry>;
  total: number;
  budget: number;
  fits: boolean;
}

/** Per-file rendered content at every layer, plus expand entries for skeleton. */
interface Rendered {
  path: string;
  full: string;
  skeleton: string;
  outline: string;
  expand: ExpandEntry[];
  hasSymbols: boolean;
}

const renderAllLayers = (
  parsed: ParsedFile,
  source: string,
): Rendered => {
  const config = getLanguageConfig(parsed.language);
  const full = source;

  // No config (unsupported lang) or no symbols → skeleton/outline == full.
  if (!config || parsed.symbols.length === 0) {
    return {
      path: parsed.path,
      full,
      skeleton: full,
      outline: full,
      expand: [],
      hasSymbols: false,
    };
  }

  const sk = renderSkeleton(parsed.path, source, parsed.symbols, config);
  const outline = renderOutline(parsed.symbols);
  return {
    path: parsed.path,
    full,
    skeleton: sk.content,
    outline,
    expand: sk.expand,
    hasSymbols: true,
  };
};

/**
 * Compress parsed files into a layered pack that fits within the token budget.
 */
export const compress = async (
  parsed: ParsedFile[],
  sources: Map<string, string>,
  opts: PackOptions,
  repoRoot: string,
  importanceProvider?: (path: string) => number,
): Promise<CompressResult> => {
  const budget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const strategy = opts.layerStrategy ?? "auto";
  const alwaysFull = opts.alwaysFull ?? [];

  const tb = new TokenBudget({ repoRoot });
  await tb.init();

  const isPinned = (path: string): boolean =>
    alwaysFull.some((pattern) => minimatch(path, pattern, { dot: true }));

  // Render every layer + compute token costs.
  const rendered = new Map<string, Rendered>();
  const candidates: LayerCandidate[] = [];

  for (const p of parsed) {
    const source = sources.get(p.path) ?? "";
    const r = renderAllLayers(p, source);
    rendered.set(p.path, r);

    const cost: Record<Layer, number> = {
      full: tb.count(r.full),
      skeleton: tb.count(r.skeleton),
      outline: tb.count(r.outline),
      omit: 0,
    };

    // Importance: code files (with symbols) rank above data/doc; larger code
    // files rank slightly higher (more likely meaningful). Pinned = +∞.
    // v2: when an importanceProvider is supplied (Engine.pack with an open
    // index) and returns a positive avg pagerank for the file, scale by
    // pagerank (1000 base so code > data, + pagerank contribution). When the
    // provider is absent or returns 0 (unranked / no index), fall back to
    // the v1 heuristic — identical to pre-v2 behavior.
    const pinned = isPinned(p.path);
    const importance = (() => {
      const pr = importanceProvider?.(p.path) ?? 0;
      if (pr > 0) return 1000 + pr * 10000;
      return (r.hasSymbols ? 1000 : 0) + p.symbols.length;
    })();

    candidates.push({ path: p.path, cost, importance, pinned });
  }

  const plan = selectLayers(candidates, budget, strategy);
  await tb.flush();

  // Assemble PackedFiles + expandMap (only skeleton layers contribute expands).
  const files: PackedFile[] = [];
  const layerMap: Record<string, Layer> = {};
  const expandMap: Record<string, ExpandEntry> = {};

  const parsedByPath = new Map(parsed.map((p) => [p.path, p]));

  for (const d of plan.decisions) {
    const r = rendered.get(d.path)!;
    const lang = parsedByPath.get(d.path)!.language;
    layerMap[d.path] = d.layer;

    let content = "";
    if (d.layer === "full") content = r.full;
    else if (d.layer === "skeleton") {
      content = r.skeleton;
      for (const e of r.expand) expandMap[e.id] = e;
    } else if (d.layer === "outline") content = r.outline;
    // omit → empty content

    files.push({
      path: d.path,
      language: lang,
      layer: d.layer,
      content,
      tokens: d.tokens,
    });
  }

  // Deterministic order by path.
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files,
    layerMap,
    expandMap,
    total: plan.total,
    budget: plan.budget,
    fits: plan.fits,
  };
};
