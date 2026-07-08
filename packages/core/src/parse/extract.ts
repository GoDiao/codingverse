import type { RawSymbol, RawRef, SymbolKind, EdgeKind } from "@codingverse/shared";
import type { Node } from "web-tree-sitter";
import type { ParserHandle } from "./parser.js";

/**
 * Turn tags-query captures into RawSymbol[] + RawRef[].
 *
 * Capture convention:
 *   @definition.<kind>  → the whole symbol node
 *   @name               → the identifier (child of the nearest definition)
 *   @reference.<kind>    → a reference; its @name is the referenced identifier
 *
 * We pair each @name with the innermost enclosing @definition/@reference node
 * by AST range containment.
 */

const DEF_KIND: Record<string, SymbolKind> = {
  "definition.class": "class",
  "definition.interface": "interface",
  "definition.type": "type",
  "definition.enum": "enum",
  "definition.function": "function",
  "definition.method": "method",
  "definition.struct": "struct",
};

const REF_KIND: Record<string, EdgeKind> = {
  "reference.call": "calls",
};

interface DefCapture {
  node: Node;
  kind: SymbolKind;
}
interface RefCapture {
  node: Node;
  kind: EdgeKind;
}

const firstLine = (node: Node): string => {
  const text = node.text;
  const nl = text.indexOf("\n");
  return (nl === -1 ? text : text.slice(0, nl)).trim();
};

/** Extract the leading docstring/comment immediately preceding a node. */
const precedingDoc = (node: Node): string | undefined => {
  const prev = node.previousNamedSibling;
  if (prev && (prev.type === "comment" || prev.type === "string")) {
    // Only treat as doc if adjacent (<= 1 line gap).
    if (node.startPosition.row - prev.endPosition.row <= 1) {
      return prev.text.trim();
    }
  }
  return undefined;
};

export interface ExtractResult {
  symbols: RawSymbol[];
  refs: RawRef[];
}

export const extractSymbols = (handle: ParserHandle, rootNode: Node): ExtractResult => {
  const captures = handle.query.captures(rootNode);

  const defs: DefCapture[] = [];
  const refs: RefCapture[] = [];
  const names: Node[] = [];

  for (const cap of captures) {
    if (cap.name === "name") {
      names.push(cap.node);
    } else if (cap.name in DEF_KIND) {
      defs.push({ node: cap.node, kind: DEF_KIND[cap.name]! });
    } else if (cap.name in REF_KIND) {
      refs.push({ node: cap.node, kind: REF_KIND[cap.name]! });
    }
  }

  // Deterministic document order for name pairing.
  names.sort((a, b) => a.startIndex - b.startIndex);

  // Sort defs by span size (ascending) so innermost wins when pairing names.
  const defSpan = (d: DefCapture) => d.node.endIndex - d.node.startIndex;
  const defsBySpan = [...defs].sort((a, b) => defSpan(a) - defSpan(b));
  const refSpan = (r: RefCapture) => r.node.endIndex - r.node.startIndex;
  const refsBySpan = [...refs].sort((a, b) => refSpan(a) - refSpan(b));

  const rawRefs: RawRef[] = [];

  // Pair each def with its innermost @name.
  interface Def {
    name: string;
    kind: SymbolKind;
    startByte: number;
    endByte: number;
    startLine: number;
    endLine: number;
    signature?: string;
    docstring?: string;
  }
  const rawDefs: Def[] = [];
  const usedNames = new Set<Node>();
  for (const def of defsBySpan) {
    const nameNode = names.find(
      (n) =>
        !usedNames.has(n) &&
        n.startIndex >= def.node.startIndex &&
        n.endIndex <= def.node.endIndex,
    );
    if (!nameNode) continue;
    usedNames.add(nameNode);
    rawDefs.push({
      name: nameNode.text,
      kind: def.kind,
      startByte: def.node.startIndex,
      endByte: def.node.endIndex,
      startLine: def.node.startPosition.row + 1,
      endLine: def.node.endPosition.row + 1,
      signature: firstLine(def.node),
      docstring: precedingDoc(def.node),
    });
  }

  // Compute scope by strict byte-range containment against other defs.
  // A is enclosed by B iff B strictly contains A's range (and B ≠ A).
  const symbols: RawSymbol[] = rawDefs.map((d) => {
    const enclosers = rawDefs
      .filter(
        (o) =>
          o !== d &&
          o.startByte <= d.startByte &&
          o.endByte >= d.endByte &&
          !(o.startByte === d.startByte && o.endByte === d.endByte),
      )
      .sort((a, b) => a.startByte - b.startByte || b.endByte - a.endByte);
    const scope = enclosers.map((o) => o.name);
    let kind = d.kind;
    if (kind === "function" && scope.length > 0) kind = "method";
    return {
      kind,
      name: d.name,
      startLine: d.startLine,
      endLine: d.endLine,
      startByte: d.startByte,
      endByte: d.endByte,
      signature: d.signature,
      docstring: d.docstring,
      scope,
    };
  });

  // Refs: pair each ref node with its inner @name.
  const usedForRefs = new Set<Node>();
  for (const ref of refsBySpan) {
    const nameNode = names.find(
      (n) =>
        !usedForRefs.has(n) &&
        n.startIndex >= ref.node.startIndex &&
        n.endIndex <= ref.node.endIndex,
    );
    if (!nameNode) continue;
    usedForRefs.add(nameNode);
    rawRefs.push({
      name: nameNode.text,
      kind: ref.kind,
      startLine: ref.node.startPosition.row + 1,
      startByte: ref.node.startIndex,
    });
  }

  // stable order by position
  symbols.sort((a, b) => a.startByte - b.startByte);
  rawRefs.sort((a, b) => a.startByte - b.startByte);
  return { symbols, refs: rawRefs };
};
