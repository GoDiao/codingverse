import fs from "node:fs/promises";
import isBinaryPath from "is-binary-path";
import { isBinaryFile } from "isbinaryfile";
import type { FileSkipReason } from "@codingverse/shared";

/**
 * Stage ① — file reading with three-tier decode fallback.
 * Ported from Repomix `fileRead.ts`.
 *
 * Tier 0: binary extension probe (no I/O)
 * Tier 1: size limit + NULL-byte probe (SIMD Buffer.indexOf) + UTF-8 fast path
 * Tier 2: isBinaryFile content check → jschardet + iconv-lite legacy decode
 */

export interface FileReadResult {
  content: string | null;
  size: number;
  skippedReason?: FileSkipReason;
}

// Lazy-load encoding libs (~25ms import cost) only when the UTF-8 fast path fails.
let encodingDepsPromise:
  | Promise<{ jschardet: typeof import("jschardet"); iconv: typeof import("iconv-lite") }>
  | undefined;
const getEncodingDeps = () => {
  encodingDepsPromise ??= Promise.all([import("jschardet"), import("iconv-lite")]).then(
    ([jschardet, iconv]) => ({ jschardet, iconv }),
  );
  return encodingDepsPromise;
};

/** Detect a known text-encoding BOM (exempts UTF-16/32/GB18030 from NULL-byte probe). */
const hasTextBom = (buffer: Buffer): boolean => {
  const b = buffer;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return true; // UTF-8
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0xfe && b[3] === 0xff) return true; // UTF-32 BE
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xfe && b[2] === 0x00 && b[3] === 0x00) return true; // UTF-32 LE
  if (b.length >= 4 && b[0] === 0x84 && b[1] === 0x31 && b[2] === 0x95 && b[3] === 0x33) return true; // GB18030
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return true; // UTF-16 BE
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return true; // UTF-16 LE
  return false;
};

/**
 * Read a file and return decoded text content, or null with a skip reason.
 */
export const readRawFile = async (
  absPath: string,
  maxFileSize: number,
): Promise<FileReadResult> => {
  try {
    // Tier 0: binary extension probe (no I/O)
    if (isBinaryPath(absPath)) {
      return { content: null, size: 0, skippedReason: "binary-extension" };
    }

    const buffer = await fs.readFile(absPath);
    const size = buffer.length;

    if (size > maxFileSize) {
      return { content: null, size, skippedReason: "size-limit" };
    }

    // Tier 1: NULL-byte probe (BOM-exempt) — cheap binary detection.
    if (!hasTextBom(buffer) && buffer.indexOf(0) !== -1) {
      return { content: null, size, skippedReason: "binary-content" };
    }

    // Tier 1: UTF-8 fast path (covers ~99% of source).
    try {
      let content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // strip BOM
      return { content, size };
    } catch {
      // not valid UTF-8 → fall through
    }

    // Tier 2: full binary check to separate real binaries from legacy encodings.
    if (await isBinaryFile(buffer)) {
      return { content: null, size, skippedReason: "binary-content" };
    }

    // Tier 2: encoding detection (Shift-JIS / EUC-KR / GBK …).
    const { jschardet, iconv } = await getEncodingDeps();
    const { encoding: detected } = jschardet.detect(buffer) ?? {};
    const encoding = detected && iconv.encodingExists(detected) ? detected : "utf-8";
    const content = iconv.decode(buffer, encoding, { stripBOM: true });

    if (content.includes("\uFFFD")) {
      return { content: null, size, skippedReason: "encoding-error" };
    }
    return { content, size };
  } catch {
    return { content: null, size: 0, skippedReason: "encoding-error" };
  }
};
