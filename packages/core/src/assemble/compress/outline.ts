import type { RawSymbol } from "@codingverse/shared";

/**
 * Outline compression — the cheapest layer.
 * A flat, scope-indented list of symbol signatures. No bodies, no placeholders.
 *
 *   class Greeter
 *     method greet(name: string): string
 *   function format(name: string): string
 */

const signature = (sym: RawSymbol): string => {
  const sig = sym.signature?.trim();
  if (sig && sig.length > 0) {
    // Strip trailing block opener so outline is a clean declaration line.
    return sig.replace(/\s*\{\s*$/, "").replace(/:\s*$/, "").trimEnd();
  }
  return `${sym.kind} ${sym.name}`;
};

export const renderOutline = (symbols: RawSymbol[]): string => {
  const sorted = [...symbols].sort((a, b) => a.startByte - b.startByte);
  return sorted
    .map((sym) => {
      const indent = "  ".repeat(sym.scope.length);
      return `${indent}${signature(sym)}`;
    })
    .join("\n");
};
