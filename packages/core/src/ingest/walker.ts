import fs from "node:fs/promises";
import path from "node:path";
import { globby } from "globby";
import { DEFAULT_IGNORE, type IngestConfig } from "@codingverse/shared";

/**
 * Stage ① — file discovery.
 *
 * Ported (simplified) from Repomix `fileSearch.ts`:
 * - globby with include patterns
 * - ignore stack = DEFAULT_IGNORE + .git/info/exclude + user exclude
 * - .gitignore honored via globby's `gitignore` option (respects parent dirs)
 * - .ignore / .repomixignore-style files via `ignoreFiles`
 *
 * Returns repo-relative POSIX paths, sorted.
 */

const toPosix = (p: string): string => p.replace(/\\/g, "/");

/** Parse an ignore-file's content into pattern lines (drop comments/blanks). */
export const parseIgnoreContent = (content: string): string[] =>
  content.split("\n").reduce<string[]>((acc, line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) acc.push(trimmed);
    return acc;
  }, []);

/** Read `.git/info/exclude` if present. */
const readGitExclude = async (rootDir: string): Promise<string[]> => {
  const excludePath = path.join(rootDir, ".git", "info", "exclude");
  try {
    const content = await fs.readFile(excludePath, "utf8");
    return parseIgnoreContent(content);
  } catch {
    return [];
  }
};

/** Build the full ignore pattern list from config + repo state. */
export const buildIgnorePatterns = async (
  rootDir: string,
  config: IngestConfig,
): Promise<string[]> => {
  const patterns = new Set<string>();

  if (config.useDefaultIgnore !== false) {
    for (const p of DEFAULT_IGNORE) patterns.add(p);
  }

  if (config.useGitignore !== false) {
    for (const p of await readGitExclude(rootDir)) patterns.add(p);
  }

  if (config.exclude) {
    for (const p of config.exclude) patterns.add(p);
  }

  return [...patterns];
};

/**
 * Discover files under `rootDir` honoring ignore rules.
 * @returns repo-relative POSIX file paths, sorted.
 */
export const walk = async (
  rootDir: string,
  config: IngestConfig = {},
): Promise<string[]> => {
  const stats = await fs.stat(rootDir).catch(() => {
    throw new Error(`Target path does not exist: ${rootDir}`);
  });
  if (!stats.isDirectory()) {
    throw new Error(`Target path is not a directory: ${rootDir}`);
  }

  const ignore = await buildIgnorePatterns(rootDir, config);
  const include = config.include && config.include.length > 0 ? config.include : ["**/*"];

  const entries = await globby(include, {
    cwd: rootDir,
    ignore,
    gitignore: config.useGitignore !== false,
    ignoreFiles: ["**/.ignore", "**/.codingverseignore"],
    onlyFiles: true,
    absolute: false,
    dot: true,
    followSymbolicLinks: false,
  });

  return entries.map(toPosix).sort((a, b) => a.localeCompare(b));
};
