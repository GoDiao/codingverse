import { createHash } from "node:crypto";
import type { RawSymbol } from "@codingverse/shared";

/**
 * Canonical stable-id helpers for the index layer.
 *
 * `symbolId` and `chunkId` are 16-char sha1 prefixes — short enough to be
 * cheap to store and reference, long enough to make collisions across a single
 * repo effectively impossible. The hash inputs (`path:qualifiedName` and
 * `path:startByte`) are stable across re-indexes, so a symbol that didn't move
 * keeps the same id and its graph edges survive unchanged.
 *
 * These helpers are re-exported from `assemble/compress/skeleton.ts` and
 * `parse/chunker.ts` so existing call sites keep resolving.
 */

/** Stable symbol id = hash(path + qualifiedName). Matches SymbolNode.id. */
export const symbolId = (filePath: string, qualifiedName: string): string =>
  createHash("sha1").update(`${filePath}:${qualifiedName}`).digest("hex").slice(0, 16);

/** Stable chunk id = hash(path + startByte). Matches Chunk.id. */
export const chunkId = (filePath: string, startByte: number): string =>
  createHash("sha1").update(`${filePath}:${startByte}`).digest("hex").slice(0, 16);

/**
 * Join a symbol's scope chain and name into a qualified name. Scope is
 * outermost-first (as produced by the parser); the joiner is `::`.
 */
export const qualifiedName = (sym: RawSymbol): string =>
  sym.scope.length ? `${sym.scope.join("::")}::${sym.name}` : sym.name;
