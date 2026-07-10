import type { SymbolNode } from "@codingverse/shared";

/**
 * Structural input shape for {@link formatNode}. Both {@link SymbolNode}
 * (from callers/callees/impact) and {@link RankedNode} (from rank, which
 * carries a `string` kind rather than `SymbolKind`) satisfy this — so the
 * four commands can share one formatter without SymbolNode↔RankedNode adapter.
 */
export interface FormattableNode {
  qualifiedName?: string;
  name: string;
  pagerank?: number;
  filePath: string;
  startLine: number;
  endLine: number;
  kind: string;
}

/**
 * Shared CLI node formatter for callers / callees / impact / rank.
 *
 * Emits one line per node: `filePath:startLine-endLine  kind  qualifiedName
 * [pagerank=...]` — the pagerank suffix appears only when the node has a
 * positive pagerank. callers/callees/impact only surface it when the index
 * has been ranked; rank's rows always have pagerank > 0 after `engine.rank()`
 * (uniform 1/N init then damped redistribution), so the suffix shows on every
 * ranked line — which is what `cv rank` wants.
 */
export function formatNode(n: FormattableNode): string {
  const name = n.qualifiedName ?? n.name;
  const pr = n.pagerank && n.pagerank > 0 ? `  [pagerank=${n.pagerank.toFixed(4)}]` : "";
  return `${n.filePath}:${n.startLine}-${n.endLine}  ${n.kind}  ${name}${pr}`;
}
