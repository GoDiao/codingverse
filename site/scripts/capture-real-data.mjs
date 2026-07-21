// Build-time capture: run the real `cv` CLI against this monorepo and bake the
// output into src/data/realData.ts. Everything the landing page shows (token
// counts, file names, call-graph edges, language grammars) is dogfooded from
// the actual index in .codingverse/ — no invented numbers.
//
// Usage:  node site/scripts/capture-real-data.mjs   (run from repo root)
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(REPO_ROOT, "packages/cli/dist/bin.js");
const OUT = resolve(__dirname, "..", "src/data/realData.ts");

// Run a cv subcommand, return stdout (stderr/experimental warnings dropped).
function cv(args) {
  return execFileSync("node", [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function cvJson(args) {
  return JSON.parse(cv(args));
}

console.log("[capture] repo:", REPO_ROOT);

// --- 1. Repo status (Observe board ①) -------------------------------------
const statusRaw = cv(["status"]);
const num = (re) => { const m = statusRaw.match(re); return m ? Number(m[1]) : null; };
const repoStats = {
  files: num(/files:\s+(\d+)/),
  symbols: num(/symbols:\s+(\d+)/),
  edges: num(/edges:\s+(\d+)/),
  chunks: num(/chunks:\s+(\d+)/),
  dbSize: (statusRaw.match(/db size:\s+([\d.]+ \w+)/) || [])[1] ?? null,
  indexed: (statusRaw.match(/indexed:\s+([\d-]+ [\d:]+)/) || [])[1] ?? null,
  health: {
    ok: num(/ok (\d+)/), degraded: num(/degraded (\d+)/),
    failed: num(/failed (\d+)/), skipped: num(/skipped (\d+)/),
  },
};
// Languages block: lines of "   <count>  <lang>" after "Languages:"
const langs = [];
const langBlock = (statusRaw.split("Languages:")[1] ?? "").split("Top files by tokens:")[0];
for (const line of langBlock.split("\n")) {
  const m = line.match(/^\s+(\d+)\s+(\S+)\s*$/);
  if (m) langs.push({ name: m[2], count: Number(m[1]) });
}
repoStats.languages = langs;
// Top files by tokens
const topFiles = [];
const topBlock = statusRaw.split("Top files by tokens:")[1] ?? "";
for (const line of topBlock.split("\n")) {
  const m = line.match(/^\s+(\d+)\s+(\S+)\s*$/);
  if (m) topFiles.push({ path: m[2], tokens: Number(m[1]) });
}
repoStats.topFiles = topFiles.slice(0, 6);
console.log("[capture] status:", repoStats.files, "files,", repoStats.symbols, "symbols");

// --- 2. Pack at three real budget stops -----------------------------------
const BUDGETS = [10000, 32000, 128000];
const packStops = BUDGETS.map((budget) => {
  const j = cvJson(["pack", "--budget", String(budget), "--format", "json"]);
  const layers = {};
  for (const f of j.files || []) layers[f.layer] = (layers[f.layer] || 0) + 1;
  return { budget, actualTokens: j.tokenCount, files: (j.files || []).length,
           expandable: j.expandableCount, layers };
});
// Raw uncapped total
const rawJ = cvJson(["pack", "--budget", "99999999", "--format", "json"]);
const rawTotal = { tokens: rawJ.tokenCount, files: (rawJ.files || []).length };
// A concrete sample of packed files at 32k (real paths + layers) for the preview
const sampleJ = cvJson(["pack", "--budget", "32000", "--format", "json"]);
const packSample = (sampleJ.files || [])
  .map((f) => ({ path: f.path, layer: f.layer, tokens: f.tokens ?? null }))
  .sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))
  .slice(0, 6);
// Layer-labelled examples from the 10k stop (has full/skeleton/outline mix), for
// the "live pack configurator" board: two kept-full + two compressed.
const lowJ = cvJson(["pack", "--budget", "10000", "--format", "json"]);
const byLayer = (layer) => (lowJ.files || []).filter((f) => f.layer === layer);
const packLayerExamples = {
  full: byLayer("full").slice(0, 2).map((f) => ({ path: f.path, layer: "full" })),
  compressed: [...byLayer("skeleton"), ...byLayer("outline")].slice(0, 2)
    .map((f) => ({ path: f.path, layer: f.layer })),
};
// Real fidelity comparison for one file: its full token cost (uncapped pack)
// vs its compressed cost at the 10k budget. Powers the "respect the budget" card.
const fullByPath = new Map((rawJ.files || []).map((f) => [f.path, f.tokens]));
const skeletonFile = byLayer("skeleton")[0] || byLayer("outline")[0];
const fidelityExample = skeletonFile
  ? {
      path: skeletonFile.path,
      fullTokens: fullByPath.get(skeletonFile.path) ?? null,
      compressedTokens: skeletonFile.tokens ?? null,
      layer: skeletonFile.layer,
    }
  : null;
// A high-PageRank file kept at full for contrast
const fullExample = (() => {
  const f = byLayer("full").slice().sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))[0];
  return f ? { path: f.path, tokens: f.tokens } : null;
})();
console.log("[capture] pack stops:", packStops.map((p) => p.actualTokens).join("/"));

// --- 3. Real hybrid-search hits (BM25 + graph + RRF) ----------------------
const short = (p) => p.replace(/^packages\//, "");
const SEARCH_QUERIES = ["pack", "index", "parser"];
const searches = SEARCH_QUERIES.map((query) => {
  const hits = cvJson(["search", query, "--top-k", "4", "--json"]);
  return {
    query,
    total: hits.length,
    hits: hits.slice(0, 4).map((h) => ({
      file: short(h.filePath),
      startLine: h.startLine,
      endLine: h.endLine,
      bm25: Number((h.scores?.bm25 ?? 0).toFixed(2)),
      graph: h.scores?.graph ?? 0,
      rrf: Number((h.scores?.rrf ?? 0).toFixed(4)),
      related: (h.relatedNodes || []).length,
    })),
  };
});
console.log("[capture] searches:", searches.map((s) => `${s.query}(${s.total})`).join(" "));

// --- 4. Real call-graph walk around Engine::pack --------------------------
// callees/callers emit text: "path:lines  kind  Name  [pagerank=X]"
function parseWalk(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(\S+?):(\d+)-(\d+)\s+(\w+)\s+(\S+)\s+\[pagerank=([\d.]+)\]/);
    if (m) rows.push({
      file: short(m[1]), startLine: Number(m[2]), kind: m[4],
      name: m[5], pagerank: Number(m[6]),
    });
  }
  return rows;
}
const calleesRaw = cv(["callees", "pack", "--depth", "1"]);
const callersRaw = cv(["callers", "packPreview", "--depth", "1"]);
const callGraph = {
  root: { name: "Engine::pack", file: "core/src/Engine.ts" },
  callees: parseWalk(calleesRaw).filter((r) => r.name !== "Engine::pack").slice(0, 5),
  callers: parseWalk(callersRaw).filter((r) => r.name !== "Engine::packPreview").slice(0, 3),
};
console.log("[capture] call graph:", callGraph.callees.length, "callees,", callGraph.callers.length, "callers");

// --- 4b. Real impact radius (reverse BFS from a changed symbol) -----------
// Split depth-1 and depth-2 by their section headers in the text output.
const IMPACT_SEED = "compress";
const impactD1Raw = cv(["impact", IMPACT_SEED, "--depth", "1"]);
const impactD2Raw = cv(["impact", IMPACT_SEED, "--depth", "2"]);
const countRows = (text) => {
  const d1 = (text.split("--- depth 1 ---")[1] ?? "").split("--- depth 2 ---")[0];
  return parseWalk(d1).length;
};
const r1Rows = parseWalk((impactD1Raw.split("--- depth 1 ---")[1] ?? ""));
const r2Only = (impactD2Raw.split("--- depth 2 ---")[1] ?? "");
const impact = {
  seed: { name: IMPACT_SEED, file: "core/src/assemble/compress/index.ts" },
  r1Count: countRows(impactD1Raw),
  r2Count: parseWalk(r2Only).length,
  // two representative direct dependents for the diagram
  r1Sample: r1Rows.slice(0, 2).map((r) => ({ name: r.name, file: r.file })),
};
console.log("[capture] impact:", impact.r1Count, "at r1,", impact.r2Count, "at r2");

// --- 4c. Real PageRank top symbols (for `cv rank` terminal output) --------
const shortName = (n) => n.replace(/^.*::/, "");
const rankRows = parseWalk(cv(["rank"])).slice(0, 5);

// --- 4d. Assemble the five terminal-walkthrough command outputs -----------
// Built from real captured data so the landing terminal mirrors actual `cv` runs.
const langLine = repoStats.languages.map((l) => `${l.name} (${l.count})`).join(", ");
const s0 = searches[0];
const savedPct = ((1 - packStops[1].actualTokens / rawTotal.tokens) * 100).toFixed(1);
const terminal = {
  index: [
    `[cv] scanning ${REPO_ROOT.split(/[\\/]/).pop()}`,
    `[cv] built SQLite index at .codingverse/index.db`,
    `  files:   ${repoStats.files}`,
    `  symbols: ${repoStats.symbols}`,
    `  edges:   ${repoStats.edges}`,
    `  chunks:  ${repoStats.chunks}`,
    `  langs:   ${langLine}`,
  ].join("\n"),
  rank: [
    `[cv] PageRank over ${repoStats.edges} resolved call edges`,
    `[cv] top ${rankRows.length} symbols by rank:`,
    ...rankRows.map((r, i) => `  ${i + 1}. ${r.file.split("/").pop()} · ${shortName(r.name)}  [${r.pagerank}]`),
  ].join("\n"),
  pack: [
    `[cv] budget ${packStops[1].budget.toLocaleString()} tokens`,
    ...packSample.slice(0, 4).map((f) => `  [${f.layer[0]}] ${f.path.replace(/^packages\//, "")}  ${f.tokens?.toLocaleString()} tok`),
    `[cv] raw repo: ${rawTotal.tokens.toLocaleString()} tok`,
    `[cv] packed:   ${packStops[1].actualTokens.toLocaleString()} tok (${savedPct}% saved)`,
  ].join("\n"),
  search: [
    `[cv] query "${s0.query}" · BM25 + call graph, fused via RRF`,
    ...s0.hits.map((h) => `  ${h.file}:${h.startLine}  rrf=${h.rrf} bm25=${h.bm25} graph=${h.graph}`),
    `[cv] ${s0.hits.length} hits, each carrying call-graph neighbors`,
  ].join("\n"),
  serve: [
    `[cv] dashboard on http://127.0.0.1:7331`,
    `[cv] index: .codingverse/index.db (${repoStats.dbSize})`,
    `[cv] six boards: overview · token map · code graph`,
    `                 retrieval · pack preview · sync`,
  ].join("\n"),
};

// --- 5. Real tree-sitter tag queries (.scm) per language ------------------
// Pull the actual exported *_TAGS strings from core source.
function extractTags(file, exportName) {
  const src = readFileSync(resolve(REPO_ROOT, file), "utf8");
  const m = src.match(new RegExp(`export const ${exportName} = \`([\\s\\S]*?)\``));
  return m ? m[1].trim() : "";
}
const astQueries = {
  TypeScript: extractTags("packages/core/src/parse/languages/typescript.ts", "TS_TAGS"),
  JavaScript: extractTags("packages/core/src/parse/languages/typescript.ts", "JS_TAGS"),
  Python: extractTags("packages/core/src/parse/languages/python.ts", "PY_TAGS"),
  Go: extractTags("packages/core/src/parse/languages/go.ts", "GO_TAGS"),
  Rust: extractTags("packages/core/src/parse/languages/rust.ts", "RUST_TAGS"),
  Java: extractTags("packages/core/src/parse/languages/java.ts", "JAVA_TAGS"),
};
console.log("[capture] AST queries:", Object.entries(astQueries).filter(([, v]) => v).map(([k]) => k).join(" "));

// --- 6. Emit realData.ts --------------------------------------------------
const banner = `// AUTO-GENERATED by site/scripts/capture-real-data.mjs — do not edit by hand.
// Dogfooded from the real \`cv\` index of this monorepo. Regenerate with:
//   node site/scripts/capture-real-data.mjs
// Captured: ${new Date().toISOString()}
`;
const body = [
  ["repoStats", repoStats],
  ["rawTotal", rawTotal],
  ["packStops", packStops],
  ["packSample", packSample],
  ["packLayerExamples", packLayerExamples],
  ["fidelityExample", fidelityExample],
  ["fullExample", fullExample],
  ["searches", searches],
  ["callGraph", callGraph],
  ["impact", impact],
  ["terminal", terminal],
  ["astQueries", astQueries],
]
  .map(([name, val]) => `export const ${name} = ${JSON.stringify(val, null, 2)} as const;`)
  .join("\n\n");

writeFileSync(OUT, banner + "\n" + body + "\n");
console.log("[capture] wrote", OUT);

