import { createHash } from "node:crypto";
import type { RawSymbol, ExpandEntry } from "@codingverse/shared";
import type { LanguageConfig } from "../../parse/languages/registry.js";

/**
 * Skeleton compression (inspired by LlamaIndex CodeHierarchy).
 *
 * Each symbol keeps its signature; its body is replaced by a placeholder
 * comment carrying a stable id. An LLM reads the structure and can call
 * `expand(id)` to fetch the full body on demand.
 *
 *   export function format(name: string): string { /* … cv:ab12cd *\/ }
 *
 * Container symbols (class/interface) render their members' skeletons nested
 * instead of a placeholder.
 */

/** Stable symbol id = hash(path + qualifiedName). Matches SymbolNode.id. */
export const symbolId = (filePath: string, qualifiedName: string): string =>
  createHash("sha1").update(`${filePath}:${qualifiedName}`).digest("hex").slice(0, 16);

const qualifiedName = (sym: RawSymbol): string =>
  sym.scope.length ? `${sym.scope.join("::")}::${sym.name}` : sym.name;

interface SymNode {
  sym: RawSymbol;
  children: SymNode[];
}

/** Build a containment tree from the flat, position-sorted symbol list. */
const buildTree = (symbols: RawSymbol[]): SymNode[] => {
  const sorted = [...symbols].sort(
    (a, b) => a.startByte - b.startByte || b.endByte - a.endByte,
  );
  const roots: SymNode[] = [];
  const stack: SymNode[] = [];

  for (const sym of sorted) {
    const node: SymNode = { sym, children: [] };
    // Pop stack entries that don't enclose this symbol.
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.sym.endByte >= sym.endByte && top.sym.startByte <= sym.startByte) break;
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return roots;
};

const CONTAINER_KINDS = new Set(["class", "interface", "struct", "enum", "trait", "module"]);

export interface SkeletonResult {
  content: string;
  expand: ExpandEntry[];
}

/**
 * Render a file as a skeleton. Returns the skeleton text plus expand entries
 * (one per leaf symbol whose body was replaced).
 */
export const renderSkeleton = (
  filePath: string,
  source: string,
  symbols: RawSymbol[],
  config: LanguageConfig,
): SkeletonResult => {
  const expand: ExpandEntry[] = [];
  const tree = buildTree(symbols);

  const placeholder = (sym: RawSymbol, indent: string): string => {
    const id = symbolId(filePath, qualifiedName(sym));
    expand.push({
      id,
      path: filePath,
      name: qualifiedName(sym),
      startByte: sym.startByte,
      endByte: sym.endByte,
      startLine: sym.startLine,
      endLine: sym.endLine,
    });
    const note = `${config.lineComment} … cv:${id}`;
    if (config.scopeStyle === "brace") return ` { ${note} }`;
    // indent style (Python): newline + indented comment
    return `\n${indent}    ${note}`;
  };

  const signatureText = (sym: RawSymbol): string => {
    if (sym.bodyStartByte !== undefined) {
      // signature = source[startByte, bodyStartByte), trimmed of trailing
      // block opener / whitespace.
      let sig = source.slice(sym.startByte, sym.bodyStartByte);
      // drop a trailing "{" (brace) or trailing whitespace after ":" (indent)
      sig = sig.replace(/\s*\{\s*$/, "").replace(/:\s*$/, ":").trimEnd();
      return sig;
    }
    return sym.signature ?? sym.name;
  };

  const renderNode = (node: SymNode, indent: string): string => {
    const { sym } = node;
    const sig = signatureText(sym);

    if (CONTAINER_KINDS.has(sym.kind) && node.children.length > 0) {
      const inner = node.children.map((c) => renderNode(c, indent + "  ")).join("\n");
      if (config.scopeStyle === "brace") {
        return `${indent}${sig} {\n${inner}\n${indent}}`;
      }
      // indent style
      return `${indent}${sig}\n${inner}`;
    }

    // leaf: signature + placeholder body
    return `${indent}${sig}${placeholder(sym, indent)}`;
  };

  const content = tree.map((n) => renderNode(n, "")).join("\n\n");
  return { content, expand };
};
