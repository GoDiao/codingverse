/**
 * Default configuration constants for codingverse.
 */

/** Default token budget for a pack (approx. a large context window). */
export const DEFAULT_TOKEN_BUDGET = 128_000;

/** Default tokenizer encoding (GPT-4o family). */
export const DEFAULT_ENCODING = "o200k_base";

/** Target chunk size in characters for AST semantic splitting. */
export const DEFAULT_CHUNK_SIZE = 512;

/** Max file size (bytes) to read; larger files are skipped. */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Directory (relative to repo root) where codingverse stores its index/cache. */
export const STATE_DIR = ".codingverse";

/**
 * Baseline ignore patterns applied on top of .gitignore.
 * Keep minimal here; extend in ingest/walker as needed.
 */
export const DEFAULT_IGNORE: readonly string[] = [
  "**/node_modules/**",
  "**/.git/**",
  ".codingverse/**",
  "**/.codingverse/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.map",
  "**/*.lock",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
];

/**
 * File-validity thresholds to reject minified / generated / binary-ish files.
 * Ported from Tabby's is_valid_file heuristics.
 */
export const FILE_VALIDITY = {
  maxLineLength: 300,
  avgLineLength: 150,
  minAlphaNumFraction: 0.25,
  maxNumberOfLines: 100_000,
  maxNumberFraction: 0.5,
} as const;
