// codingverse dashboard — zero-build ES module. Fetches /api/* and renders
// boards ① (index overview) and ② (token map). D3 is loaded globally from the
// CDN <script> in index.html.

const $ = (id) => document.getElementById(id);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ms) {
  if (!ms) return "never";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = false;
}

function renderCards(index) {
  const cards = [
    ["files", index.files],
    ["symbols", index.symbols],
    ["edges", index.edges],
    ["chunks", index.chunks],
    ["db size", formatBytes(index.dbSize)],
    ["indexed", formatTimestamp(index.lastSync)],
  ];
  $("cards").innerHTML = cards
    .map(
      ([label, value]) =>
        `<div class="card"><div class="card-value">${value}</div><div class="card-label">${label}</div></div>`,
    )
    .join("");
}

function renderHealth(health) {
  const order = ["ok", "degraded", "failed", "skipped"];
  const badges = order
    .map(
      (k) =>
        `<span class="badge badge-${k}">${k} ${health[k] ?? 0}</span>`,
    )
    .join("");
  $("health").innerHTML = `<h3>Health</h3><div class="badges">${badges}</div>`;
}

function renderLanguages(languages) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const rows = entries
    .map(([lang, n]) => {
      const pct = ((n / max) * 100).toFixed(1);
      return `<div class="lang-row"><span class="lang-name">${lang}</span><span class="lang-bar" style="width:${pct}%"></span><span class="lang-n">${n}</span></div>`;
    })
    .join("");
  $("languages").innerHTML = `<h3>Languages</h3>${rows}`;
}

function renderTreemap(tokenMap) {
  const el = $("treemap");
  el.innerHTML = "";
  const width = el.clientWidth || 900;
  const height = 480;

  const root = d3
    .hierarchy(tokenMap, (d) => d.children)
    .sum((d) => (d.children && d.children.length ? 0 : d.tokens))
    .sort((a, b) => b.value - a.value);

  d3.treemap().size([width, height]).paddingInner(1).round(true)(root);

  const total = root.value || 1;
  const color = d3.scaleSequential(d3.interpolateBlues).domain([0, total * 0.15]);

  const svg = d3
    .select(el)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  const leaf = svg
    .selectAll("g")
    .data(root.leaves())
    .join("g")
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  leaf
    .append("rect")
    .attr("width", (d) => Math.max(0, d.x1 - d.x0))
    .attr("height", (d) => Math.max(0, d.y1 - d.y0))
    .attr("fill", (d) => color(d.value))
    .attr("stroke", "#0b1a2b")
    .append("title")
    .text(
      (d) =>
        `${d.data.path}\n${d.value} tok (${((d.value / total) * 100).toFixed(1)}%)`,
    );

  leaf
    .append("text")
    .attr("x", 4)
    .attr("y", 14)
    .attr("class", "treemap-label")
    .text((d) => {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 44 || h < 18) return "";
      return d.data.name;
    });
}

// Board ⑥ — sync status: last index() duration + parse-cache hit/miss + the
// changed (re-parsed) files. Data from /api/sync (persisted SyncState).
function renderSync(state) {
  const el = $("sync");
  if (!state) {
    el.innerHTML = `<p class="muted">No index yet. Run <code>cv index</code>.</p>`;
    return;
  }
  const total = state.parseCacheHits + state.parseCacheMisses || 1;
  const hitPct = ((state.parseCacheHits / total) * 100).toFixed(0);
  const missPct = ((state.parseCacheMisses / total) * 100).toFixed(0);

  const cards = [
    ["duration", `${state.durationMs} ms`],
    ["files", state.filesProcessed],
    ["cache hits", state.parseCacheHits],
    ["re-parsed", state.parseCacheMisses],
    ["last run", formatTimestamp(state.timestamp)],
  ];
  const cardHtml = cards
    .map(
      ([label, value]) =>
        `<div class="card"><div class="card-value">${value}</div><div class="card-label">${label}</div></div>`,
    )
    .join("");

  const bar =
    `<div class="cache-bar" title="cache hit/miss ratio">` +
    `<span class="cache-hit" style="width:${hitPct}%"></span>` +
    `<span class="cache-miss" style="width:${missPct}%"></span>` +
    `</div><div class="cache-legend">` +
    `<span class="badge badge-ok">cached ${state.parseCacheHits} (${hitPct}%)</span> ` +
    `<span class="badge badge-degraded">re-parsed ${state.parseCacheMisses} (${missPct}%)</span></div>`;

  const files = state.changedFiles ?? [];
  const fileList = files.length
    ? `<h3>Changed files (${files.length})</h3><ul class="file-list">` +
      files.map((p) => `<li>${p}</li>`).join("") +
      `</ul>`
    : `<p class="muted">No files changed since the previous index.</p>`;

  el.innerHTML = `<div class="cards">${cardHtml}</div>${bar}${fileList}`;
}

// Board ③ state: keep the simulation + selections so click-highlight can
// recolor without a full re-render.
const graphState = { node: null, link: null, byId: new Map() };

function graphColor(pagerank, maxPagerank) {
  const t = maxPagerank > 0 ? pagerank / maxPagerank : 0;
  return d3.interpolateInferno(0.15 + t * 0.7);
}

function renderGraph(data) {
  const el = $("graph");
  el.innerHTML = "";
  const width = el.clientWidth || 900;
  const height = 520;

  $("graph-meta").textContent =
    `${data.nodes.length} nodes shown` +
    (data.truncated ? ` of ${data.totalNodes} (top by PageRank)` : "") +
    ` · ${data.edges.length} edges`;

  const svg = d3
    .select(el)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  // edges reference node objects by id; d3 mutates copies, so clone.
  const nodes = data.nodes.map((n) => ({ ...n }));
  const links = data.edges.map((e) => ({ ...e }));
  graphState.byId = new Map(nodes.map((n) => [n.id, n]));
  graphState.maxPagerank = data.maxPagerank;

  const sim = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3.forceLink(links).id((d) => d.id).distance(40).strength(0.4),
    )
    .force("charge", d3.forceManyBody().strength(-60))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(6));

  const link = svg
    .append("g")
    .attr("stroke", "#2b4d6f")
    .attr("stroke-opacity", 0.5)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", 1);

  const rScale = d3
    .scaleSqrt()
    .domain([0, data.maxPagerank || 1])
    .range([3, 14]);

  const node = svg
    .append("g")
    .attr("stroke", "#0b1a2b")
    .attr("stroke-width", 1)
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (d) => rScale(d.pagerank))
    .attr("fill", (d) => graphColor(d.pagerank, data.maxPagerank))
    .style("cursor", "pointer")
    .on("click", (_event, d) => highlightNode(d));

  node.append("title").text(
    (d) =>
      `${d.qualifiedName || d.name}\n${d.filePath}\n${d.kind} · pagerank=${d.pagerank.toFixed(5)}`,
  );

  graphState.node = node;
  graphState.link = link;
  graphState.maxPagerank = data.maxPagerank;

  sim.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
  });
}

async function highlightNode(d) {
  try {
    const [callersRes, calleesRes] = await Promise.all([
      fetch(`/api/callers?id=${encodeURIComponent(d.id)}&depth=2`),
      fetch(`/api/callees?id=${encodeURIComponent(d.id)}&depth=2`),
    ]);
    const callers = callersRes.ok ? await callersRes.json() : { nodes: [] };
    const callees = calleesRes.ok ? await calleesRes.json() : { nodes: [] };
    const callerSet = new Set(callers.nodes);
    const calleeSet = new Set(callees.nodes);

    graphState.node.attr("fill", (n) => {
      if (n.id === d.id) return "#fff";
      if (callerSet.has(n.id)) return "#4a9eff"; // callers = blue
      if (calleeSet.has(n.id)) return "#f5a623"; // callees = orange
      return "#233a52"; // dimmed
    });
    graphState.node.attr("opacity", (n) =>
      n.id === d.id || callerSet.has(n.id) || calleeSet.has(n.id) ? 1 : 0.25,
    );

    $("graph-detail").textContent =
      `${d.qualifiedName || d.name} (${d.filePath}) — ` +
      `${callerSet.size} callers (blue), ${calleeSet.size} callees (orange)`;
  } catch (err) {
    $("graph-detail").textContent = err instanceof Error ? err.message : String(err);
  }
}

function resetHighlight() {
  if (!graphState.node) return;
  graphState.node
    .attr("fill", (n) => graphColor(n.pagerank, graphState.maxPagerank))
    .attr("opacity", 1);
  $("graph-detail").textContent =
    "Click a node to highlight its callers (blue) and callees (orange).";
}

async function loadGraph() {
  try {
    const res = await fetch("/api/graph?limit=200");
    if (!res.ok) return;
    renderGraph(await res.json());
    const resetBtn = $("graph-reset");
    if (resetBtn) resetBtn.onclick = resetHighlight;
  } catch {
    /* board ③ is best-effort */
  }
}

async function main() {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showError(body.hint || body.error || `HTTP ${res.status}`);
      return;
    }
    const stats = await res.json();
    renderCards(stats.index);
    renderHealth(stats.health);
    renderLanguages(stats.languages);
    renderTreemap(stats.tokenMap);

    const syncRes = await fetch("/api/sync");
    if (syncRes.ok) renderSync(await syncRes.json());

    await loadGraph();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

main();
window.addEventListener("resize", () => {
  // cheap re-layout of the treemap only
  fetch("/api/token-map")
    .then((r) => (r.ok ? r.json() : null))
    .then((tm) => tm && renderTreemap(tm))
    .catch(() => {});
});
