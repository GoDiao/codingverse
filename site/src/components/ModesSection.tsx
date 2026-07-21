import { useState } from "react";
import { Layers, Search, Eye, Cpu, Database, Network, Sliders, Play, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { TranslationSchema } from "../translations";
import { packStops, packSample, packLayerExamples, rawTotal, searches, callGraph, repoStats } from "../data/realData";

interface ModesSectionProps {
  t: TranslationSchema;
}

export default function ModesSection({ t }: ModesSectionProps) {
  const [activeTab, setActiveTab] = useState<"pack" | "search" | "observe">("pack");

  // Pack mode: slider indexes the three real budget stops (10k / 32k / 128k).
  const [budgetIdx, setBudgetIdx] = useState<number>(1);
  const stop = packStops[budgetIdx];

  // Search mode: one of the three real dogfooded queries.
  const [searchQuery, setSearchQuery] = useState<string>(searches[0].query);
  const activeSearch = searches.find((s) => s.query === searchQuery) ?? searches[0];

  // Observe mode interactive states
  const [activeBoard, setActiveBoard] = useState<number>(0);

  return (
    <div className="space-y-12">
      {/* Intro */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <h2 className="font-display text-3xl md:text-5xl lg:text-6xl text-ink tracking-tight font-medium">
          {t.modes.title}
        </h2>
        <p className="text-ink-dim max-w-2xl mx-auto text-base leading-relaxed">
          {t.modes.lead}
        </p>
      </div>

      {/* Modes Toggle Navigation */}
      <div className="flex flex-wrap justify-center gap-2 edge-bottom pb-px max-w-2xl mx-auto">
        {(["pack", "search", "observe"] as const).map((tab) => {
          const isActive = activeTab === tab;
          let icon = <Layers className="w-4 h-4" />;
          let label = t.modes.packTitle;
          if (tab === "search") {
            icon = <Search className="w-4 h-4" />;
            label = t.modes.searchTitle;
          } else if (tab === "observe") {
            icon = <Eye className="w-4 h-4" />;
            label = t.modes.observeTitle;
          }

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center space-x-2 px-6 py-3.5 text-sm font-mono tracking-wide relative border-b-2 transition-all cursor-pointer ${
                isActive
                  ? "border-cosmos text-ink bg-void-2/30"
                  : "border-transparent text-ink-dim hover:text-ink hover:bg-void-2/10"
              }`}
            >
              {icon}
              <span>{label.split(" ")[0]}</span>
              {isActive && (
                <motion.div
                  layoutId="activeTabUnderline"
                  className="absolute bottom-[-2px] left-0 right-0 h-0.5 bg-cosmos"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Interactive Sandbox Container */}
      <div className="surface overflow-hidden relative grid grid-cols-1 lg:grid-cols-12">
        <div className="aura" style={{ width: 420, height: 420, top: -120, left: '18%' }} />

        {/* Lefthand Configuration Controls */}
        <div className="lg:col-span-4 p-8 flex flex-col justify-between relative z-10">
          <div className="space-y-6">
            <div className="flex items-center">
              <span className="font-mono text-xs text-cosmos-soft tracking-wider uppercase">
                {t.modes.playground}
              </span>
            </div>

            {/* Dynamic details depending on the mode */}
            <AnimatePresence mode="wait">
              {activeTab === "pack" && (
                <motion.div
                  key="pack-info"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-5"
                >
                  <h4 className="font-display text-2xl text-ink tracking-tight font-semibold">
                    {t.modes.packTitle}
                  </h4>
                  <p className="text-sm text-ink-dim leading-relaxed">
                    {t.modes.packDesc}
                  </p>

                  <div className="space-y-4 pt-4 edge-top">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-ink-faint">{t.modes.tokenBudget}</span>
                      <span className="text-cosmos-soft font-semibold">{stop.budget.toLocaleString()} tokens</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-[11px] font-mono text-ink-faint">
                        <span>{t.modes.budgetAggressive}</span>
                        <span>{t.modes.budgetBalanced}</span>
                        <span>{t.modes.budgetMax}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={packStops.length - 1}
                        step="1"
                        value={budgetIdx}
                        onChange={(e) => setBudgetIdx(Number(e.target.value))}
                        className="w-full accent-cosmos bg-void-3 rounded-lg h-1.5 appearance-none cursor-pointer"
                      />
                    </div>

                    <div className="panel p-3 text-xs font-mono space-y-1.5">
                      <div className="flex justify-between text-ink-dim">
                        <span>{t.modes.originalCodebase}</span>
                        <span>{rawTotal.tokens.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex justify-between font-bold text-ink">
                        <span>{t.modes.outputContext}</span>
                        <span className={budgetIdx === 0 ? "text-cosmos-soft" : "text-emerald-400"}>
                          {stop.actualTokens.toLocaleString()} tokens · {stop.files} files
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "search" && (
                <motion.div
                  key="search-info"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-5"
                >
                  <h4 className="font-display text-2xl text-ink tracking-tight font-semibold">
                    {t.modes.searchTitle}
                  </h4>
                  <p className="text-sm text-ink-dim leading-relaxed">
                    {t.modes.searchDesc}
                  </p>

                  <div className="space-y-4 pt-4 edge-top">
                    <span className="text-xs font-mono text-ink-faint block">{t.modes.chooseKeyword}</span>
                    <div className="grid grid-cols-3 gap-2">
                      {searches.map((s) => s.query).map((q) => (
                        <button
                          key={q}
                          onClick={() => setSearchQuery(q)}
                          className={`py-2 px-3 rounded-xl font-mono text-xs text-center transition-all cursor-pointer ${
                            searchQuery === q
                              ? "bg-cosmos/12 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(139,125,255,0.45)]"
                              : "panel panel-hover text-ink-dim hover:text-ink"
                          }`}
                        >
                          cv search "{q}"
                        </button>
                      ))}
                    </div>

                    <div className="panel p-3 text-[11px] font-mono text-ink-dim space-y-1.5">
                      <div className="flex items-center space-x-1 text-cosmos-soft font-semibold">
                        <Network className="w-3.5 h-3.5" />
                        <span>{t.modes.graphTraversal}</span>
                      </div>
                      <p className="text-[10px] leading-relaxed text-ink-faint">
                        {t.modes.graphTraversalDesc}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "observe" && (
                <motion.div
                  key="observe-info"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-5"
                >
                  <h4 className="font-display text-2xl text-ink tracking-tight font-semibold">
                    {t.modes.observeTitle}
                  </h4>
                  <p className="text-sm text-ink-dim leading-relaxed">
                    {t.modes.observeDesc}
                  </p>

                  <div className="space-y-3 pt-4 edge-top">
                    <span className="text-xs font-mono text-ink-faint block">{t.modes.selectBoard}</span>
                    <div className="space-y-2">
                      {[
                        t.modes.boardTokenMap,
                        t.modes.boardCodeGraph,
                        t.modes.boardRetrieval,
                        t.modes.boardPack,
                      ].map((board, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveBoard(idx)}
                          className={`w-full text-left p-2.5 rounded-xl text-xs font-mono border transition-all flex items-center justify-between cursor-pointer ${
                            activeBoard === idx
                              ? "bg-void-3 border-cosmos-soft/40 text-cosmos-soft font-bold"
                              : "bg-transparent border-transparent text-ink-dim hover:text-ink hover:bg-void-3/50"
                          }`}
                        >
                          <span>{board}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-cosmos" />
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="pt-6 edge-top flex items-center space-x-3 text-xs text-ink-faint font-mono">
            <Cpu className="w-4 h-4 text-cosmos" />
            <span>Local SQLite engine · no network</span>
          </div>
        </div>

        {/* Righthand Visual Preview Screen */}
        <div className="lg:col-span-8 p-8 bg-[#050507]/60 flex flex-col justify-between relative min-h-[460px]">
          {/* Subtle cosmic mesh background */}
          <div className="absolute inset-0 bg-radial-gradient from-cosmos/5 via-transparent to-transparent pointer-events-none" />

          {/* Window Header */}
          <div className="flex items-center justify-between mb-4 pb-4 relative z-10">
            <div className="hairline absolute bottom-0 left-0" />
            <span className="text-xs font-mono text-ink-dim flex items-center space-x-1.5">
              <Database className="w-3.5 h-3.5 text-cosmos" />
              <span>{t.modes.visualizerLabel}</span>

            </span>
            <span className="px-2 py-0.5 rounded bg-void-3 border border-line text-[10px] font-mono text-cosmos-soft uppercase tracking-wider">
              {activeTab} mode
            </span>
          </div>

          {/* Window Content Display */}
          <div className="flex-1 flex flex-col justify-center relative z-10 overflow-hidden">
            <AnimatePresence mode="wait">
              {activeTab === "pack" && (
                <motion.div
                  key={`pack-preview-${budgetIdx}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="font-mono text-xs space-y-3 w-full"
                >
                  <div className="panel p-4 space-y-3">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-ink-faint"># context.xml · budget {stop.budget.toLocaleString()}</span>
                      <span className="text-cosmos-soft">{stop.actualTokens.toLocaleString()} / {rawTotal.tokens.toLocaleString()} tok</span>
                    </div>

                    {/* Real layer distribution for this budget stop */}
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-void-2">
                      {(["full", "skeleton", "outline", "omit"] as const).map((layer) => {
                        const count = (stop.layers as Record<string, number>)[layer] ?? 0;
                        if (!count) return null;
                        const color = layer === "full" ? "bg-emerald-400" : layer === "skeleton" ? "bg-amber-400" : layer === "outline" ? "bg-cosmos" : "bg-void-3";
                        return <div key={layer} className={color} style={{ width: `${(count / stop.files) * 100}%` }} title={`${layer}: ${count}`} />;
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
                      {(["full", "skeleton", "outline", "omit"] as const).map((layer) => {
                        const count = (stop.layers as Record<string, number>)[layer] ?? 0;
                        if (!count) return null;
                        const dot = layer === "full" ? "bg-emerald-400" : layer === "skeleton" ? "bg-amber-400" : layer === "outline" ? "bg-cosmos" : "bg-void-3";
                        return (
                          <span key={layer} className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{layer} · {count}
                          </span>
                        );
                      })}
                    </div>

                    {/* Real packed files at this stop, largest first */}
                    <div className="pt-2 edge-top space-y-1">
                      {packSample.slice(0, 5).map((f) => (
                        <div key={f.path} className="flex items-center justify-between gap-2">
                          <span className="text-ink-dim truncate">{f.path.replace(/^packages\//, "")}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            <span className="text-ink-faint">{f.tokens?.toLocaleString()}</span>
                            <span className={`text-[9px] px-1.5 rounded ${f.layer === "full" ? "bg-emerald-500/10 text-emerald-300" : f.layer === "skeleton" ? "bg-amber-500/10 text-amber-300" : "bg-cosmos/15 text-cosmos-soft"}`}>{f.layer}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "search" && (
                <motion.div
                  key={`search-preview-${searchQuery}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4 w-full"
                >
                  <div className="flex items-center justify-between font-mono text-[11px] text-ink-faint">
                    <span>cv search "{activeSearch.query}" · RRF fusion</span>
                    <span className="text-cosmos-soft">top {activeSearch.hits.length}</span>
                  </div>

                  {/* Real hybrid-search hits, ranked by RRF */}
                  <div className="space-y-2">
                    {activeSearch.hits.map((hit, i) => (
                      <div
                        key={`${hit.file}-${hit.startLine}`}
                        className={`p-3 rounded-xl border font-mono text-xs relative ${
                          i === 0 ? "bg-cosmos/10 border-cosmos text-ink" : "bg-void-2 border-line text-ink-dim"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-ink truncate">
                            {hit.file}<span className="text-ink-faint font-normal">:{hit.startLine}-{hit.endLine}</span>
                          </span>
                          {i === 0 && <span className="text-[9px] bg-cosmos/20 text-cosmos-soft px-1.5 rounded shrink-0">top hit</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-ink-faint">
                          <span>bm25 <span className="text-emerald-300">{hit.bm25}</span></span>
                          <span>graph <span className="text-cosmos-soft">{hit.graph}</span></span>
                          <span>rrf <span className="text-ink-dim">{hit.rrf}</span></span>
                          <span className="ml-auto">+{hit.related} related</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Real retrieved context neighborhood */}
                  <div className="panel p-4 font-mono text-xs space-y-2 mt-2">
                    <div className="text-cosmos-soft flex items-center space-x-1.5">
                      <Network className="w-3.5 h-3.5" />
                      <span>{t.modes.contextNeighborhood}</span>
                    </div>
                    <pre className="text-ink-faint text-[11px] leading-relaxed whitespace-pre-wrap break-all">
{`<context query="${activeSearch.query}">
  <match path="${activeSearch.hits[0].file}" lines="${activeSearch.hits[0].startLine}-${activeSearch.hits[0].endLine}" />
  <fused strategy="RRF" bm25+graph="${activeSearch.hits[0].bm25} + ${activeSearch.hits[0].graph}" />
</context>`}
                    </pre>
                  </div>
                </motion.div>
              )}

              {activeTab === "observe" && (
                <motion.div
                  key={`observe-preview-${activeBoard}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4 w-full"
                >
                  {activeBoard === 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs font-mono text-ink-dim">
                        <span>{t.modes.tokenMapCaption}</span>
                        <span className="text-ink-faint">top {repoStats.topFiles.length} files</span>
                      </div>
                      {/* Real token treemap: bar width ∝ real token count */}
                      <div className="panel p-3 space-y-1.5">
                        {repoStats.topFiles.map((f, i) => {
                          const max = repoStats.topFiles[0].tokens;
                          const pct = (f.tokens / max) * 100;
                          const shade = i === 0 ? "bg-cosmos/80" : i < 2 ? "bg-cosmos/50" : i < 4 ? "bg-cosmos/30" : "bg-cosmos/15";
                          return (
                            <div key={f.path} className="font-mono text-[10px]">
                              <div className="flex items-center justify-between text-ink-dim">
                                <span className="truncate">{f.path.replace(/^packages\//, "")}</span>
                                <span className="text-ink-faint shrink-0 ml-2">{f.tokens.toLocaleString()}</span>
                              </div>
                              <div className="w-full bg-void-2 h-1.5 rounded overflow-hidden mt-0.5">
                                <div className={`h-full ${shade}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[10px] font-mono text-ink-faint">
                        {repoStats.chunks} chunks · {rawTotal.tokens.toLocaleString()} tokens total
                      </div>
                    </div>
                  )}

                  {activeBoard === 1 && (
                    <div className="space-y-3">
                      <div className="text-xs font-mono text-ink-dim">Code graph (D3 force-directed call graph)</div>
                      <div className="panel h-44 relative flex items-center justify-center overflow-hidden">
                        {/* Interactive SVG Connectors */}
                        <svg className="absolute inset-0 w-full h-full opacity-60">
                          <line x1="100" y1="50" x2="200" y2="100" stroke="#5b4bff" strokeWidth="1" />
                          <line x1="200" y1="100" x2="350" y2="60" stroke="#5b4bff" strokeWidth="2" />
                          <line x1="200" y1="100" x2="250" y2="150" stroke="#5b4bff" strokeWidth="1.5" />
                          <line x1="350" y1="60" x2="500" y2="120" stroke="#5b4bff" strokeWidth="1" />
                          <line x1="250" y1="150" x2="500" y2="120" stroke="#5b4bff" strokeWidth="1" />
                        </svg>

                        {/* Interactive Nodes */}
                        <div className="absolute top-[40px] left-[85px] w-3 h-3 rounded-full bg-ink border border-cosmos hover:scale-125 transition-transform cursor-pointer" />
                        <div className="absolute top-[90px] left-[185px] w-4.5 h-4.5 rounded-full bg-cosmos border border-ink hover:scale-125 transition-transform cursor-pointer shadow-lg shadow-cosmos" />
                        <div className="absolute top-[50px] left-[335px] w-3.5 h-3.5 rounded-full bg-cosmos-soft border border-ink hover:scale-125 transition-transform cursor-pointer" />
                        <div className="absolute top-[140px] left-[235px] w-3 h-3 rounded-full bg-ink-dim border border-cosmos hover:scale-125 transition-transform cursor-pointer" />
                        <div className="absolute top-[110px] left-[485px] w-3.5 h-3.5 rounded-full bg-ink border border-cosmos hover:scale-125 transition-transform cursor-pointer" />
                        
                        <div className="absolute bottom-2 left-3 text-[10px] font-mono text-ink-faint">
                          Resolved call edges: {repoStats.edges} | Nodes: {repoStats.symbols}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeBoard === 2 && (
                    <div className="space-y-3">
                      <div className="text-xs font-mono text-ink-dim">Retrieval Inspector (Query analysis log output)</div>
                      <div className="panel p-4 font-mono text-[11px] leading-relaxed space-y-1 text-ink-dim">
                        <div className="text-emerald-400 font-semibold">[inspect] cv search "{searches[0].query}"</div>
                        <div>- BM25 lexical hits: {searches[0].hits.length} chunks</div>
                        <div>- top hit: {searches[0].hits[0].file}:{searches[0].hits[0].startLine} (bm25 {searches[0].hits[0].bm25}, graph {searches[0].hits[0].graph})</div>
                        <div>- walked call-graph edges, +{searches[0].hits[0].related} related nodes</div>
                        <div className="text-cosmos-soft">- fused via RRF → rrf {searches[0].hits[0].rrf}</div>
                      </div>
                    </div>
                  )}

                  {activeBoard === 3 && (
                    <div className="space-y-3">
                      <div className="text-xs font-mono text-ink-dim">{t.modes.boardPackHint}</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="panel p-3 font-mono text-xs">
                          <div className="text-emerald-400 font-semibold mb-2">{t.modes.keptFull}</div>
                          <div className="space-y-1">
                            {packLayerExamples.full.map((f) => (
                              <div key={f.path} className="bg-void-2 p-1.5 rounded border border-line text-[10px] flex justify-between gap-2">
                                <span className="truncate">{f.path.replace(/^packages\//, "")}</span>
                                <span className="text-emerald-400 shrink-0">full</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="panel p-3 font-mono text-xs">
                          <div className="text-amber-400 font-semibold mb-2">{t.modes.compressed}</div>
                          <div className="space-y-1">
                            {packLayerExamples.compressed.map((f) => (
                              <div key={f.path} className="bg-void-2 p-1.5 rounded border border-line text-[10px] flex justify-between gap-2">
                                <span className="truncate">{f.path.replace(/^packages\//, "")}</span>
                                <span className={`shrink-0 ${f.layer === "skeleton" ? "text-amber-400" : "text-cosmos-soft"}`}>{f.layer}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Window Footer Status */}
          <div className="mt-6 pt-4 edge-top flex items-center justify-between text-[10px] font-mono text-ink-faint relative z-10">
            <span className="flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block mr-1 animate-pulse" />
              <span>{t.modes.indexLabel}</span>
            </span>
            <span>SQLite schema v1.1 • index.db</span>
          </div>
        </div>

      </div>
    </div>
  );
}
