// codingverse · observe — "Signal Deck" front-end.
// Zero-build ES module. Fetches /api/* and renders six diagnostic boards.
// D3 is loaded globally from the CDN <script> in index.html.

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// bipolar thermal ramp: cold slate → cyan → amber. Reused by treemap + legend.
const THERMAL = ["#263141", "#33485a", "#4cc4d6", "#7fb98a", "#f0912f", "#ffb84d", "#ffe0a3"];
const thermal = (t) => d3.interpolateRgbBasis(THERMAL)(Math.max(0, Math.min(1, t)));

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

// count a number up from 0 with an ease-out curve. Sets the final value up
// front so the readout is correct even if rAF is throttled (backgrounded tab);
// the animation is a pure enhancement layered over that.
function countUp(el, target, fmt = (v) => Math.round(v).toLocaleString()) {
  el.textContent = fmt(target);
  if (reduceMotion || target === 0) return;
  const dur = 780;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmt(target);
  }
  requestAnimationFrame(step);
}

// apply a bar/gauge width so CSS transitions it from 0. Sets the value on the
// next frame for the transition, plus a timeout fallback so the final width is
// correct even when rAF is throttled.
function fillWidth(el, pct) {
  requestAnimationFrame(() => {
    el.style.width = `${pct}%`;
  });
  setTimeout(() => {
    el.style.width = `${pct}%`;
  }, 60);
}

// ---- deck bar: vitals (board 01 essence, promoted to the cockpit strip) ----
function renderVitals(index, health) {
  const total = (health.ok ?? 0) + (health.degraded ?? 0) + (health.failed ?? 0) + (health.skipped ?? 0);
  const okPct = total ? Math.round(((health.ok ?? 0) / total) * 100) : 0;
  const vitals = [
    { label: "files", value: index.files },
    { label: "symbols", value: index.symbols, accent: true },
    { label: "edges", value: index.edges },
    { label: "chunks", value: index.chunks },
    { label: "db", value: index.dbSize, fmt: formatBytes, raw: true },
    { label: "health", value: okPct, fmt: (v) => `${Math.round(v)}%`, heart: true },
  ];
  $("vitals").innerHTML = vitals
    .map(
      (v) =>
        `<div class="vital"><span class="v-num ${v.accent ? "accent" : ""}" data-v="${v.value}" data-raw="${v.raw ? 1 : 0}">${
          v.raw || v.heart ? "" : "0"
        }</span><span class="v-label">${v.heart ? '<i class="v-heart"></i>' : ""}${v.label}</span></div>`,
    )
    .join("");

  const nums = [...$("vitals").querySelectorAll(".v-num")];
  nums.forEach((el, i) => {
    const v = vitals[i];
    if (v.raw) el.textContent = v.fmt(v.value);
    else countUp(el, v.value, v.fmt);
  });
}

// ---- board 01: health gauge + language mix ----
function renderHealth(health) {
  const order = ["ok", "degraded", "failed", "skipped"];
  const total = order.reduce((s, k) => s + (health[k] ?? 0), 0) || 1;
  const gauge = order
    .map((k) => `<span class="g-${k}" style="width:0" data-w="${((health[k] ?? 0) / total) * 100}"></span>`)
    .join("");
  const legend = order
    .map(
      (k) =>
        `<span class="legend-item"><i class="swatch g-${k}" style="background:var(--${
          k === "ok" ? "ok" : k === "degraded" ? "warn" : k === "failed" ? "fail" : "skip"
        })"></i>${k} <b>${health[k] ?? 0}</b></span>`,
    )
    .join("");
  $("health").innerHTML = `<h3>Parse health</h3><div class="gauge">${gauge}</div><div class="legend">${legend}</div>`;
  $("health").querySelectorAll(".gauge span").forEach((s) => fillWidth(s, s.dataset.w));
}

function renderLanguages(languages) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const rows = entries
    .map(
      ([lang, n]) =>
        `<div class="lang-row"><span class="lang-name">${lang}</span>` +
        `<span class="lang-track"><span class="lang-bar" data-w="${((n / max) * 100).toFixed(1)}"></span></span>` +
        `<span class="lang-n">${n}</span></div>`,
    )
    .join("");
  $("languages").innerHTML = `<h3>Languages</h3>${rows}`;
  $("languages").querySelectorAll(".lang-bar").forEach((b) => fillWidth(b, b.dataset.w));
}

// ---- board 02: token treemap with thermal ramp ----
function renderTreemap(tokenMap) {
  const el = $("treemap");
  el.innerHTML = "";
  const width = el.clientWidth || 900;
  const height = 460;

  const root = d3
    .hierarchy(tokenMap, (d) => d.children)
    .sum((d) => (d.children && d.children.length ? 0 : d.tokens))
    .sort((a, b) => b.value - a.value);

  d3.treemap().size([width, height]).paddingInner(2).round(true)(root);

  const total = root.value || 1;
  // normalize against a soft ceiling so a few giant files don't wash out the rest
  const ceiling = total * 0.12;

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

  const rect = leaf
    .append("rect")
    .attr("class", "tm-rect")
    .attr("width", (d) => Math.max(0, d.x1 - d.x0))
    .attr("height", (d) => Math.max(0, d.y1 - d.y0))
    .attr("rx", 2)
    .attr("fill", (d) => thermal(Math.min(1, d.value / ceiling)))
    .attr("stroke", "var(--ink)")
    .attr("stroke-width", 1);

  rect
    .append("title")
    .text((d) => `${d.data.path}\n${d.value.toLocaleString()} tok (${((d.value / total) * 100).toFixed(1)}%)`);

  if (!reduceMotion) {
    rect
      .attr("opacity", 0)
      .transition()
      .delay((_d, i) => Math.min(i * 6, 400))
      .duration(320)
      .attr("opacity", 1);
  }

  leaf
    .append("text")
    .attr("x", 6)
    .attr("y", 16)
    .attr("class", "treemap-label")
    .attr("fill", (d) => (d.value / ceiling > 0.55 ? "var(--ink)" : "var(--text)"))
    .text((d) => {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 46 || h < 22) return "";
      return d.data.name;
    });

  $("treemap-scale").innerHTML = `<span>cold · few tokens</span><span class="ramp"></span><span>hot · many tokens</span>`;
}

// ---- board 03: code graph ----
const graphState = { node: null, link: null, byId: new Map(), maxPagerank: 1 };

function graphColor(pagerank, maxPagerank) {
  const t = maxPagerank > 0 ? pagerank / maxPagerank : 0;
  // low pagerank = cold cyan, high = hot amber (the bipolar identity)
  return thermal(0.35 + t * 0.6);
}

function renderGraph(data) {
  const el = $("graph");
  el.innerHTML = "";
  const width = el.clientWidth || 900;
  const height = 520;

  $("graph-meta").textContent =
    `${data.nodes.length} nodes` +
    (data.truncated ? ` of ${data.totalNodes} · top by PageRank` : "") +
    ` · ${data.edges.length} edges`;

  const svg = d3
    .select(el)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  // Zoomable/pannable container: wheel zooms, dragging empty space pans.
  // Node drag (below) coexists because d3.drag stops event propagation, so a
  // mousedown on a node never starts a pan.
  const vp = svg.append("g").attr("class", "vp");
  const zoom = d3
    .zoom()
    .scaleExtent([0.15, 4])
    .on("zoom", (event) => vp.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  graphState.svg = svg;
  graphState.zoom = zoom;

  const nodes = data.nodes.map((n) => ({ ...n }));
  const links = data.edges.map((e) => ({ ...e }));
  graphState.byId = new Map(nodes.map((n) => [n.id, n]));
  graphState.maxPagerank = data.maxPagerank;

  const sim = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(38).strength(0.5))
    .force("charge", d3.forceManyBody().strength(-90).distanceMax(320))
    .force("center", d3.forceCenter(width / 2, height / 2))
    // Gentle containment: pull every node toward center so disconnected /
    // weakly-linked nodes can't drift to infinity and blow up the bounding
    // box (which forced fit-to-view down to an unreadable dot). Capping
    // charge distanceMax also stops far pairs from repelling each other apart.
    .force("x", d3.forceX(width / 2).strength(0.08))
    .force("y", d3.forceY(height / 2).strength(0.08))
    .force("collide", d3.forceCollide().radius(9));

  const link = vp
    .append("g")
    .attr("stroke", "#33485a")
    .attr("stroke-opacity", 0.45)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", 1);

  const rScale = d3.scaleSqrt().domain([0, data.maxPagerank || 1]).range([3.5, 16]);

  const node = vp
    .append("g")
    .attr("stroke", "var(--ink)")
    .attr("stroke-width", 1.2)
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (d) => rScale(d.pagerank))
    .attr("fill", (d) => graphColor(d.pagerank, data.maxPagerank))
    .style("cursor", "pointer")
    .on("click", (_event, d) => highlightNode(d))
    .call(
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

  node
    .append("title")
    .text((d) => `${d.qualifiedName || d.name}\n${d.filePath}\n${d.kind} · pagerank=${d.pagerank.toFixed(5)}`);

  graphState.node = node;
  graphState.link = link;

  const draw = () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
  };
  sim.on("tick", draw);
  // Stop the sim once it settles so the graph doesn't hold a live rAF loop
  // forever (idle CPU + lets the renderer reach a stable frame). A drag
  // re-heats it via alphaTarget, which resumes ticking on its own. On settle
  // we also auto-fit so the whole graph is framed regardless of where the
  // force layout pushed nodes (they routinely fly outside the viewport).
  sim.on("end", () => {
    draw();
    fitGraph(nodes, width, height);
  });
  graphState.sim = sim;
  graphState.dims = { width, height, nodes, rScale };
}

// Frame every node in the viewport: compute the node bounding box, then set a
// zoom transform that scales+translates it to fit with padding. Called on sim
// settle and by the "fit" control.
function fitGraph(nodes, width, height, animate = true) {
  if (!graphState.svg || !graphState.zoom || !nodes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = 40;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min(4, Math.max(0.15, Math.min((width - pad * 2) / bw, (height - pad * 2) / bh)));
  const tx = width / 2 - scale * (minX + maxX) / 2;
  const ty = height / 2 - scale * (minY + maxY) / 2;
  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
  const sel = animate && !reduceMotion ? graphState.svg.transition().duration(500) : graphState.svg;
  sel.call(graphState.zoom.transform, transform);
}

// escape user/DB-derived text before dropping it into innerHTML
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ask the server to reveal/open a repo path in the OS (local tool only)
async function openPath(rel, reveal) {
  try {
    const res = await fetch(`/api/open?path=${encodeURIComponent(rel)}&reveal=${reveal ? 1 : 0}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $("graph-detail").textContent = body.error || `open failed (HTTP ${res.status})`;
    }
  } catch (err) {
    $("graph-detail").textContent = err instanceof Error ? err.message : String(err);
  }
}

function fieldRow(label, value) {
  if (value === undefined || value === null || value === "") return "";
  return `<div class="nd-field"><span class="nd-k">${label}</span><span class="nd-v">${esc(value)}</span></div>`;
}

// render the rich detail panel for a node + its caller/callee counts
function renderNodeDetail(detail, callerCount, calleeCount) {
  const el = $("node-detail");
  el.hidden = false;
  const loc = detail.startLine ? `${detail.filePath}:${detail.startLine}` : detail.filePath;
  const rankPct = detail.totalNodes ? ((detail.pagerankRank / detail.totalNodes) * 100).toFixed(1) : "";

  const collapsible = [
    detail.signature ? `<div class="nd-block"><div class="nd-block-h">signature</div><pre class="nd-code">${esc(detail.signature)}</pre></div>` : "",
    detail.docstring ? `<div class="nd-block"><div class="nd-block-h">docstring</div><pre class="nd-code">${esc(detail.docstring)}</pre></div>` : "",
    `<div class="nd-grid">` +
      fieldRow("pagerank", `${detail.pagerank.toFixed(5)}  ·  #${detail.pagerankRank} of ${detail.totalNodes} (top ${rankPct}%)`) +
      fieldRow("visibility", detail.visibility) +
      fieldRow("language", detail.language) +
      fieldRow("lines", detail.startLine ? `${detail.startLine}–${detail.endLine ?? "?"}` : undefined) +
      fieldRow("id", detail.id) +
    `</div>`,
  ].join("");

  el.innerHTML =
    `<div class="nd-head">` +
    `<span class="nd-kind">${esc(detail.kind || "symbol")}</span>` +
    `<button class="nd-close" title="close" aria-label="close detail">✕</button>` +
    `</div>` +
    `<div class="nd-name" title="${esc(detail.qualifiedName || detail.name)}">${esc(detail.qualifiedName || detail.name)}</div>` +
    `<button class="nd-loc" title="reveal in folder">${esc(loc)}</button>` +
    `<div class="nd-actions">` +
    `<button class="ghost-btn nd-open">Open file</button>` +
    `<button class="ghost-btn nd-reveal">Reveal in folder</button>` +
    `</div>` +
    `<div class="nd-counts"><span><i class="dot cold"></i>${callerCount} callers</span><span><i class="dot hot"></i>${calleeCount} callees</span></div>` +
    `<details class="nd-more"${detail.signature || detail.docstring ? " open" : ""}><summary>more detail</summary>${collapsible}</details>`;

  el.querySelector(".nd-close").onclick = () => {
    el.hidden = true;
    resetHighlight();
  };
  const openFile = () => openPath(detail.filePath, false);
  const reveal = () => openPath(detail.filePath, true);
  el.querySelector(".nd-open").onclick = openFile;
  el.querySelector(".nd-loc").onclick = reveal;
  el.querySelector(".nd-reveal").onclick = reveal;
}

async function highlightNode(d) {
  try {
    const [callersRes, calleesRes, detailRes] = await Promise.all([
      fetch(`/api/callers?id=${encodeURIComponent(d.id)}&depth=2`),
      fetch(`/api/callees?id=${encodeURIComponent(d.id)}&depth=2`),
      fetch(`/api/node?id=${encodeURIComponent(d.id)}`),
    ]);
    const callers = callersRes.ok ? await callersRes.json() : { nodes: [] };
    const callees = calleesRes.ok ? await calleesRes.json() : { nodes: [] };
    const callerSet = new Set(callers.nodes);
    const calleeSet = new Set(callees.nodes);

    graphState.node
      .attr("fill", (n) => {
        if (n.id === d.id) return "#ffffff";
        if (callerSet.has(n.id)) return "var(--cold)";
        if (calleeSet.has(n.id)) return "var(--hot)";
        return "#2a333f";
      })
      .attr("opacity", (n) =>
        n.id === d.id || callerSet.has(n.id) || calleeSet.has(n.id) ? 1 : 0.22,
      );

    graphState.link.attr("stroke-opacity", (l) => {
      const s = l.source.id ?? l.source;
      const t = l.target.id ?? l.target;
      const lit = [s, t].every((x) => x === d.id || callerSet.has(x) || calleeSet.has(x));
      return lit ? 0.7 : 0.06;
    });

    if (detailRes.ok) {
      renderNodeDetail(await detailRes.json(), callerSet.size, calleeSet.size);
    }
    $("graph-detail").innerHTML =
      `<b style="color:var(--text)">${esc(d.qualifiedName || d.name)}</b> · ` +
      `<i class="dot cold"></i>${callerSet.size} callers · ` +
      `<i class="dot hot"></i>${calleeSet.size} callees`;
  } catch (err) {
    $("graph-detail").textContent = err instanceof Error ? err.message : String(err);
  }
}

function resetHighlight() {
  if (!graphState.node) return;
  graphState.node.attr("fill", (n) => graphColor(n.pagerank, graphState.maxPagerank)).attr("opacity", 1);
  if (graphState.link) graphState.link.attr("stroke-opacity", 0.45);
  const nd = $("node-detail");
  if (nd) nd.hidden = true;
  $("graph-detail").innerHTML =
    'Click a node for detail · scroll to zoom · drag empty space to pan · drag a node to pin.';
}

// Fetch + render the top-`limit` nodes. Returns the payload so the caller can
// use totalNodes (e.g. to size the slider on first load).
async function fetchAndRenderGraph(limit) {
  const res = await fetch(`/api/graph?limit=${limit}`);
  if (!res.ok) return null;
  const data = await res.json();
  renderGraph(data);
  return data;
}

async function loadGraph() {
  try {
    const initialLimit = 200;
    const data = await fetchAndRenderGraph(initialLimit);
    if (!data) return;

    const resetBtn = $("graph-reset");
    if (resetBtn) resetBtn.onclick = resetHighlight;
    const fitBtn = $("graph-fit");
    if (fitBtn)
      fitBtn.onclick = () => {
        const d = graphState.dims;
        if (d) fitGraph(d.nodes, d.width, d.height);
      };

    // Slider spans 20 → totalNodes; on release, re-fetch the top-N subgraph.
    const slider = $("graph-limit");
    const valEl = $("graph-limit-val");
    if (slider && valEl) {
      const total = data.totalNodes || initialLimit;
      slider.max = String(total);
      slider.value = String(Math.min(initialLimit, total));
      valEl.textContent = `${slider.value} / ${total}`;
      let debounce;
      slider.addEventListener("input", () => {
        valEl.textContent = `${slider.value} / ${total}`;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          void fetchAndRenderGraph(Number(slider.value));
        }, 220);
      });
    }
  } catch {
    /* board 03 is best-effort */
  }
}

// ---- board 04: retrieval inspector ----
function renderHitList(elId, hits, kind) {
  const el = $(elId);
  if (!hits.length) {
    el.innerHTML = `<p class="empty">no hits</p>`;
    return;
  }
  const short = (p) => p.split(/[\\/]/).pop();
  el.innerHTML = hits
    .map((h, i) => {
      let badge = "";
      let cls = "";
      if (kind === "bm25") badge = `${h.score.toFixed(2)}`;
      else if (kind === "graph") badge = `Δ${h.proximity}`;
      else {
        badge = `${h.rrf.toFixed(4)}`;
        cls = "pri";
      }
      return (
        `<div class="hit" style="animation-delay:${Math.min(i * 28, 400)}ms" title="${h.filePath}:${h.startLine}">` +
        `<span class="hit-rank">${h.rank ?? i + 1}</span>` +
        `<span class="hit-path">${short(h.filePath)}:${h.startLine}</span>` +
        `<span class="hit-score ${cls}">${badge}</span></div>`
      );
    })
    .join("");
}

async function runSearch() {
  const query = $("search-input").value.trim();
  if (query.length < 2) return;
  $("search-meta").textContent = "tracing…";
  try {
    const res = await fetch(`/api/search-debug?query=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $("search-meta").textContent = body.hint || body.error || `HTTP ${res.status}`;
      return;
    }
    const d = await res.json();
    renderHitList("search-bm25", d.bm25, "bm25");
    renderHitList("search-graph", d.graph, "graph");
    renderHitList("search-fused", d.fused, "fused");
    $("search-meta").textContent =
      `"${d.ftsQuery}" · ${d.bm25.length} lexical / ${d.graph.length} co-located → top ${d.fused.length} · RRF k=${d.rrfK}`;
  } catch (err) {
    $("search-meta").textContent = err instanceof Error ? err.message : String(err);
  }
}

function wireSearch() {
  const btn = $("search-run");
  const input = $("search-input");
  if (btn) btn.onclick = runSearch;
  if (input)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
}

// ---- board 05: pack preview ----
const LAYERS = ["full", "skeleton", "outline", "omit"];

function renderPackPreview(data) {
  const el = $("pack-result");
  const usedPct = Math.min(100, (data.total / data.budget) * 100).toFixed(1);
  const fits = data.total <= data.budget;

  const bar =
    `<div class="pack-bar-wrap"><div class="pack-bar">` +
    `<span class="pack-used ${fits ? "pack-ok" : "pack-over"}" style="width:${usedPct}%"></span></div>` +
    `<span class="pack-bar-label">${data.total.toLocaleString()} / ${data.budget.toLocaleString()} tok · ${usedPct}%</span></div>`;

  const readouts = [
    ["budget", data.budget.toLocaleString(), ""],
    ["total", data.total.toLocaleString(), "hot"],
    ["fits", fits ? "✓ yes" : "✗ no", fits ? "ok" : "fail"],
    ["strategy", data.strategy, ""],
    ["expandable", data.expandableCount, ""],
  ];
  const readoutHtml = readouts
    .map(
      ([label, value, cls]) =>
        `<div class="readout"><div class="r-val ${cls}">${value}</div><div class="r-label">${label}</div></div>`,
    )
    .join("");

  const legend = LAYERS.map(
    (l) => `<span class="layer-chip"><i class="swatch sw-${l}"></i>${l} <b>${data.layerCounts[l] ?? 0}</b></span>`,
  ).join("");

  const sorted = [...data.files].sort((a, b) => b.tokens - a.tokens);
  const rows = sorted
    .map(
      (f) =>
        `<div class="file-row">` +
        `<span class="file-layer fl-${f.layer}">${f.layer[0].toUpperCase()}</span>` +
        `<span class="file-path ${f.layer === "omit" ? "dim" : ""}" title="${f.path}">${f.path}</span>` +
        `<span class="file-tok">${f.tokens.toLocaleString()}</span></div>`,
    )
    .join("");

  el.innerHTML =
    bar +
    `<div class="readouts">${readoutHtml}</div>` +
    `<div class="layer-legend">${legend}</div>` +
    `<div class="changed-head">Files (${data.files.length}, by tokens)</div>` +
    `<div class="file-rows">${rows}</div>`;
}

async function loadPackPreview(budget, strategy) {
  $("pack-meta").textContent = "computing…";
  try {
    const params = new URLSearchParams({ budget: String(budget), strategy });
    const res = await fetch(`/api/pack-preview?${params}`);
    if (!res.ok) {
      $("pack-meta").textContent = `HTTP ${res.status}`;
      return;
    }
    renderPackPreview(await res.json());
    $("pack-meta").textContent = "";
  } catch (err) {
    $("pack-meta").textContent = err instanceof Error ? err.message : String(err);
  }
}

function wirePackPreview() {
  const slider = $("pack-budget");
  const valEl = $("pack-budget-val");
  const stratEl = $("pack-strategy");
  const btn = $("pack-run");
  if (!slider || !btn) return;

  const fmt = (v) => `${Number(v).toLocaleString()} tok`;
  let debounce;
  slider.addEventListener("input", () => {
    valEl.textContent = fmt(slider.value);
    clearTimeout(debounce);
    debounce = setTimeout(() => loadPackPreview(Number(slider.value), stratEl.value), 220);
  });
  stratEl.addEventListener("change", () => loadPackPreview(Number(slider.value), stratEl.value));
  btn.onclick = () => loadPackPreview(Number(slider.value), stratEl.value);

  loadPackPreview(Number(slider.value), stratEl.value);
  wirePackOutput(slider, stratEl);
}

// Board ⑤ packed-output preview: fetch the FULL rendered content and enable
// copy / download. Kept behind an explicit "load content" click because it
// runs the whole pack pipeline (heavier than the budget-slider preview).
const EXT = { xml: "xml", markdown: "md", json: "json" };
let packContent = null;
let packContentFormat = "xml";

function wirePackOutput(slider, stratEl) {
  const fmtEl = $("pack-format");
  const scopeEl = $("pack-scope-changed");
  const loadBtn = $("pack-load");
  const copyBtn = $("pack-copy");
  const dlBtn = $("pack-download");
  const pre = $("pack-content");
  const meta = $("pack-output-meta");
  if (!loadBtn || !pre) return;

  const setReady = (ready) => {
    copyBtn.disabled = !ready;
    dlBtn.disabled = !ready;
  };

  const load = async () => {
    const budget = Number(slider.value);
    const strategy = stratEl.value;
    const format = fmtEl.value;
    const changed = scopeEl && scopeEl.checked;
    meta.textContent = "packing…";
    setReady(false);
    try {
      const params = new URLSearchParams({ budget: String(budget), strategy, format });
      // V3-1: scope=changed → diff-scoped pack (changed files + impact radius).
      if (changed) params.set("scope", "changed");
      const res = await fetch(`/api/pack-content?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        meta.textContent = body.error || `HTTP ${res.status}`;
        return;
      }
      const data = await res.json();
      packContent = data.content;
      packContentFormat = data.format;
      pre.textContent = data.content;
      const scopeNote =
        data.scope === "changed"
          ? ` · scope: ${data.seedFiles.length} changed + ${data.expandedFiles.length} impacted`
          : "";
      meta.textContent = `${data.tokenCount.toLocaleString()} tok · ${data.fileCount} files · ${data.expandableCount} expandable${scopeNote}`;
      if (data.scope === "changed" && data.seedFiles.length === 0) {
        pre.innerHTML = '<span class="empty">No changed files vs HEAD — nothing to pack.</span>';
      }
      setReady(data.fileCount > 0);
    } catch (err) {
      meta.textContent = err instanceof Error ? err.message : String(err);
    }
  };

  loadBtn.onclick = load;
  // Changing format/scope after a load re-fetches so preview + download stay in sync.
  fmtEl.addEventListener("change", () => {
    if (packContent !== null) load();
  });
  if (scopeEl) scopeEl.addEventListener("change", () => {
    if (packContent !== null) load();
  });

  copyBtn.onclick = async () => {
    if (packContent === null) return;
    try {
      await navigator.clipboard.writeText(packContent);
      copyBtn.textContent = "Copied ✓";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1400);
    } catch {
      meta.textContent = "clipboard blocked — select the text to copy manually";
    }
  };

  dlBtn.onclick = () => {
    if (packContent === null) return;
    const ext = EXT[packContentFormat] || "txt";
    const mime =
      packContentFormat === "json"
        ? "application/json"
        : packContentFormat === "markdown"
          ? "text/markdown"
          : "application/xml";
    const blob = new Blob([packContent], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codingverse-pack.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
}

// ---- board 06: sync status ----
function renderSync(state) {
  const el = $("sync");
  if (!state) {
    el.innerHTML = `<p class="muted">No index yet. Run <code>cv index</code>.</p>`;
    return;
  }
  const total = state.parseCacheHits + state.parseCacheMisses || 1;
  const hitPct = ((state.parseCacheHits / total) * 100).toFixed(0);
  const missPct = ((state.parseCacheMisses / total) * 100).toFixed(0);

  const readouts = [
    ["duration", `${state.durationMs} ms`, "hot"],
    ["files", state.filesProcessed, ""],
    ["cache hits", state.parseCacheHits, "ok"],
    ["re-parsed", state.parseCacheMisses, ""],
    ["last run", formatTimestamp(state.timestamp), ""],
  ];
  const readoutHtml = readouts
    .map(
      ([label, value, cls]) =>
        `<div class="readout"><div class="r-val ${cls}" style="font-size:${
          label === "last run" ? "13px" : "20px"
        }">${value}</div><div class="r-label">${label}</div></div>`,
    )
    .join("");

  const bar =
    `<div class="cache-bar" title="parse-cache hit/miss">` +
    `<span class="cache-hit" style="width:${hitPct}%"></span>` +
    `<span class="cache-miss" style="width:${missPct}%"></span></div>` +
    `<div class="cache-legend">` +
    `<span class="legend-item"><i class="swatch" style="background:var(--ok)"></i>cached <b>${state.parseCacheHits}</b> (${hitPct}%)</span>` +
    `<span class="legend-item"><i class="swatch" style="background:var(--hot)"></i>re-parsed <b>${state.parseCacheMisses}</b> (${missPct}%)</span></div>`;

  const files = state.changedFiles ?? [];
  const fileList = files.length
    ? `<div class="changed-head">Changed files (${files.length})</div><ul class="file-list">` +
      files.map((p) => `<li>${p}</li>`).join("") +
      `</ul>`
    : `<p class="muted">No files changed since the previous index.</p>`;

  el.innerHTML = `<div class="readouts">${readoutHtml}</div>${bar}${fileList}`;
}

// ---- rail scroll-spy ----
function wireRail() {
  const links = [...document.querySelectorAll(".rail a")];
  const byId = new Map(links.map((a) => [a.dataset.board, a]));
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          links.forEach((a) => a.classList.remove("active"));
          byId.get(e.target.id)?.classList.add("active");
        }
      });
    },
    { rootMargin: "-30% 0px -60% 0px" },
  );
  document.querySelectorAll(".panel").forEach((p) => obs.observe(p));
}

// ---- boot ----
async function main() {
  $("repo").textContent = "";
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showError(body.hint || body.error || `HTTP ${res.status}`);
      return;
    }
    const stats = await res.json();
    renderVitals(stats.index, stats.health);
    renderHealth(stats.health);
    renderLanguages(stats.languages);
    renderTreemap(stats.tokenMap);

    const syncRes = await fetch("/api/sync");
    if (syncRes.ok) renderSync(await syncRes.json());

    await loadGraph();
    wireSearch();
    wirePackPreview();
    wireRail();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

main();

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fetch("/api/token-map")
      .then((r) => (r.ok ? r.json() : null))
      .then((tm) => tm && renderTreemap(tm))
      .catch(() => {});
  }, 200);
});
