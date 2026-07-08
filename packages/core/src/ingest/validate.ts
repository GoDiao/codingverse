import { FILE_VALIDITY } from "@codingverse/shared";

/**
 * Stage ① — file validity heuristics.
 * Ported from Tabby `is_valid_file` (index.rs), tuned to avoid false-positives
 * on prose/documentation.
 *
 * Cheaply rejects minified / generated / data-blob files:
 * - max line length      ≤ 300   (code only)
 * - avg line length      ≤ 150   (code only)
 * - alphanumeric frac    ≥ 0.25  (universal)
 * - number of lines      ≤ 100000 (universal)
 * - numeric char frac    ≤ 0.5   (universal)
 *
 * Tabby's line-length checks target minified *code*; they false-positive on
 * documentation with long table rows / paragraphs. We exempt prose extensions
 * from the line-length checks while keeping the character-class checks (which
 * still catch binary-ish / data-blob files without hurting prose).
 */

/** Extensions treated as prose: exempt from line-length checks. */
const PROSE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "text",
  "rst",
  "adoc",
  "asciidoc",
  "tex",
  "org",
  "csv",
  "tsv",
]);

export interface FileMetrics {
  maxLineLength: number;
  avgLineLength: number;
  alphaNumFraction: number;
  numLines: number;
  numberFraction: number;
}

/** Compute all validity metrics for a text content in one pass. */
export const computeMetrics = (content: string): FileMetrics => {
  const lines = content.split("\n");
  const numLines = lines.length;

  let maxLineLength = 0;
  let totalLength = 0;
  let alphaNum = 0;
  let numeric = 0;

  for (const line of lines) {
    if (line.length > maxLineLength) maxLineLength = line.length;
    totalLength += line.length;
  }

  // Character-class fractions over the whole content (excluding newlines).
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    if (isDigit) numeric++;
    if (isDigit || isUpper || isLower) alphaNum++;
  }

  const totalChars = content.length || 1;
  return {
    maxLineLength,
    avgLineLength: totalLength / (numLines || 1),
    alphaNumFraction: alphaNum / totalChars,
    numLines,
    numberFraction: numeric / totalChars,
  };
};

const extOf = (filePath?: string): string => {
  if (!filePath) return "";
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot + 1).toLowerCase();
};

/**
 * Returns true if the file passes validity thresholds.
 * @param content decoded text
 * @param filePath optional path; prose extensions skip line-length checks
 */
export const isValidFile = (content: string, filePath?: string): boolean => {
  // Empty file is trivially valid (nothing to ingest, but not "invalid").
  if (content.length === 0) return true;

  const m = computeMetrics(content);
  const isProse = PROSE_EXTENSIONS.has(extOf(filePath));

  const lineChecksPass =
    isProse ||
    (m.maxLineLength <= FILE_VALIDITY.maxLineLength &&
      m.avgLineLength <= FILE_VALIDITY.avgLineLength);

  return (
    lineChecksPass &&
    m.alphaNumFraction >= FILE_VALIDITY.minAlphaNumFraction &&
    m.numLines <= FILE_VALIDITY.maxNumberOfLines &&
    m.numberFraction <= FILE_VALIDITY.maxNumberFraction
  );
};
