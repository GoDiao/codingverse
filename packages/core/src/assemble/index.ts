// Stage ④ Assemble: search (RRF), rank (PageRank), graph, compress (skeleton), output.
// M4: compress (layered skeleton/outline + budget selection).

export {
  compress,
  renderSkeleton,
  renderOutline,
  selectLayers,
  symbolId,
  type CompressResult,
  type LayerCandidate,
  type LayerPlan,
  type LayerDecision,
} from "./compress/index.js";

export { render, renderTree, type RenderInput } from "./output/index.js";
export { ExpandMapStore, type ExpandMapSnapshot, type ExpandMapMeta } from "./expand-store.js";
