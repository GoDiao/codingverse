import { useState } from "react";
import { Layers, Search, Eye, Cpu, Database, Network, Sliders, Play, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { TranslationSchema } from "../translations";

interface ModesSectionProps {
  t: TranslationSchema;
}

export default function ModesSection({ t }: ModesSectionProps) {
  const [activeTab, setActiveTab] = useState<"pack" | "search" | "observe">("pack");
  
  // Pack mode interactive state
  const [budget, setBudget] = useState<number>(32000);
  
  // Search mode interactive state
  const [searchQuery, setSearchQuery] = useState<string>("auth");

  // Observe mode interactive states
  const [activeBoard, setActiveBoard] = useState<number>(0);

  // Search graph helper data
  const graphNodes = {
    auth: [
      { id: "api", label: "api/routes.ts", role: "caller (inbound)", rank: 0.052, active: true },
      { id: "jwt", label: "auth/jwt.ts:validateToken()", role: "match (lexical)", rank: 0.089, active: true, match: true },
      { id: "db", label: "db/sqlite.ts:query()", role: "callee (outbound)", rank: 0.041, active: true },
      { id: "logger", label: "utils/logger.ts:writeLog()", role: "callee (outbound)", rank: 0.024, active: true },
    ],
    db: [
      { id: "engine", label: "core/engine.ts:runJob()", role: "caller (inbound)", rank: 0.078, active: true },
      { id: "sqlite", label: "db/sqlite.ts:query()", role: "match (lexical)", rank: 0.092, active: true, match: true },
      { id: "driver", label: "db/driver.ts:connect()", role: "callee (outbound)", rank: 0.034, active: true },
    ],
    parser: [
      { id: "index", label: "cv:indexCommand()", role: "caller (inbound)", rank: 0.045, active: true },
      { id: "parser", label: "parser/tree.ts:parseAST()", role: "match (lexical)", rank: 0.076, active: true, match: true },
      { id: "node", label: "parser/node.ts:resolveCall()", role: "callee (outbound)", rank: 0.058, active: true },
    ]
  };

  return (
    <div className="space-y-12">
      {/* Intro */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-cosmos/20 bg-cosmos/5 text-xs text-cosmos-soft font-mono uppercase tracking-widest">
          <Database className="w-3.5 h-3.5 text-cosmos" />
          <span>Index once. Three ways out.</span>
        </div>
        <h2 className="font-serif text-3xl md:text-5xl lg:text-6xl text-ink tracking-tight font-medium">
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
            <div className="flex items-center space-x-2.5">
              <span className="w-2 h-2 rounded-full bg-cosmos animate-pulse" />
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
                  <h4 className="font-serif text-2xl text-ink tracking-tight font-semibold">
                    {t.modes.packTitle}
                  </h4>
                  <p className="text-sm text-ink-dim leading-relaxed">
                    {t.modes.packDesc}
                  </p>

                  <div className="space-y-4 pt-4 edge-top">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-ink-faint">{t.modes.tokenBudget}</span>
                      <span className="text-cosmos-soft font-semibold">{budget.toLocaleString()} tokens</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-[11px] font-mono text-ink-faint">
                        <span>{t.modes.budgetAggressive}</span>
                        <span>{t.modes.budgetBalanced}</span>
                        <span>{t.modes.budgetMax}</span>
                      </div>
                      <input
                        type="range"
                        min="10000"
                        max="128000"
                        step="59000"
                        value={budget}
                        onChange={(e) => setBudget(Number(e.target.value))}
                        className="w-full accent-cosmos bg-void-3 rounded-lg h-1.5 appearance-none cursor-pointer"
                      />
                    </div>

                    <div className="panel p-3 text-xs font-mono space-y-1.5">
                      <div className="flex justify-between text-ink-dim">
                        <span>{t.modes.originalCodebase}</span>
                        <span>148,200 tokens</span>
                      </div>
                      <div className="flex justify-between font-bold text-ink">
                        <span>{t.modes.outputContext}</span>
                        <span className={budget <= 10000 ? "text-cosmos-soft" : "text-emerald-400"}>
                          {budget <= 10000 ? "~9,540 tokens" : budget <= 69000 ? "~24,190 tokens" : "~122,800 tokens"}
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
                  <h4 className="font-serif text-2xl text-ink tracking-tight font-semibold">
                    {t.modes.searchTitle}
                  </h4>
                  <p className="text-sm text-ink-dim leading-relaxed">
                    {t.modes.searchDesc}
                  </p>

                  <div className="space-y-4 pt-4 edge-top">
                    <span className="text-xs font-mono text-ink-faint block">{t.modes.chooseKeyword}</span>
                    <div className="grid grid-cols-3 gap-2">
                      {(["auth", "db", "parser"] as const).map((q) => (
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
                  <h4 className="font-serif text-2xl text-ink tracking-tight font-semibold">
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
                  key={`pack-preview-${budget}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="font-mono text-xs space-y-3 w-full"
                >
                  <div className="panel p-4 space-y-2">
                    <div className="text-ink-faint text-[10px]"># context.xml — Packed representation</div>
                    
                    {/* Critical Class - always full */}
                    <div className="text-emerald-400">
                      &lt;<span className="text-ink">file path="core/engine.ts" priority="high"</span>&gt;
                    </div>
                    <div className="pl-4 text-ink-dim">
                      <span className="text-cosmos-soft font-semibold">export class</span> Engine &#123;
                      <div className="pl-4 text-ink-faint">// Full file fidelity retained (high PageRank)</div>
                      <div className="pl-4 text-emerald-400/80">async index() &#123; ... &#125;</div>
                      <div className="pl-4 text-emerald-400/80">async pack(opts) &#123; ... &#125;</div>
                      &#125;
                    </div>
                    <div className="text-emerald-400">&lt;/<span className="text-ink">file</span>&gt;</div>

                    {/* Helper function - degraded depending on budget */}
                    {budget <= 10000 ? (
                      <div className="border border-cosmos/20 bg-cosmos/5 p-3 rounded-lg mt-3">
                        <div className="text-cosmos-soft font-semibold flex items-center justify-between mb-1">
                          <span>&lt;file path="utils/helpers.ts" priority="low" fidelity="omitted"&gt;</span>
                          <span className="text-[10px] bg-cosmos/20 text-cosmos-soft px-1.5 rounded">Omitted</span>
                        </div>
                        <p className="text-ink-faint text-[10px] pl-4 italic">
                          // [Compressed 82 lines to satisfy 10k Token Budget limit]
                        </p>
                      </div>
                    ) : budget <= 69000 ? (
                      <div className="panel p-3 rounded-lg mt-3">
                        <div className="text-amber-400 font-semibold flex items-center justify-between mb-1">
                          <span>&lt;file path="utils/helpers.ts" priority="medium" fidelity="skeleton"&gt;</span>
                          <span className="text-[10px] bg-amber-500/10 text-amber-300 px-1.5 rounded">Skeleton</span>
                        </div>
                        <div className="pl-4 text-ink-faint text-[11px] leading-relaxed">
                          <span className="text-cosmos-soft">export function</span> parseTokenSize(input: string) &#123; <span className="text-ink-faint">// ... [8 lines of internal code skeletonized]</span> &#125;
                          <br />
                          <span className="text-cosmos-soft">export function</span> calculatePageRank(edges: Edge[]) &#123; <span className="text-ink-faint">// ... [21 lines of internal code skeletonized]</span> &#125;
                        </div>
                      </div>
                    ) : (
                      <div className="border border-emerald-500/20 bg-emerald-500/5 p-3 rounded-lg mt-3">
                        <div className="text-emerald-400 font-semibold flex items-center justify-between mb-1">
                          <span>&lt;file path="utils/helpers.ts" priority="medium" fidelity="full"&gt;</span>
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 rounded">Full Fidelity</span>
                        </div>
                        <div className="pl-4 text-ink-dim">
                          <span className="text-cosmos-soft">export function</span> parseTokenSize(input: string) &#123;
                          <div className="pl-4 text-[#dfded9]">const bytes = Buffer.byteLength(input, 'utf8');</div>
                          <div className="pl-4 text-[#dfded9]">return Math.ceil(bytes / 4);</div>
                          &#125;
                        </div>
                      </div>
                    )}
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
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {graphNodes[searchQuery as keyof typeof graphNodes].map((node) => (
                      <div
                        key={node.id}
                        className={`p-3.5 rounded-xl border font-mono text-xs relative ${
                          node.match
                            ? "bg-cosmos/10 border-cosmos text-ink shadow-lg shadow-cosmos/10"
                            : "bg-void-2 border-line text-ink-dim"
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-[10px] text-ink-faint uppercase font-semibold">
                            {node.role}
                          </span>
                          <span className="text-[10px] bg-void-3 px-1 rounded text-cosmos-soft">
                            PR: {node.rank}
                          </span>
                        </div>
                        <div className="font-bold text-ink mt-2 overflow-hidden text-ellipsis whitespace-nowrap">
                          {node.label.split(":")[0]}
                        </div>
                        <div className="text-[10px] text-ink-faint mt-1 overflow-hidden text-ellipsis whitespace-nowrap">
                          {node.label.split(":")[1] || "Class File Scope"}
                        </div>

                        {node.match && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cosmos opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-cosmos"></span>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Flow Walk Connector Line Visual */}
                  <div className="panel p-4 font-mono text-xs space-y-2 mt-4">
                    <div className="text-cosmos-soft flex items-center space-x-1.5">
                      <Network className="w-3.5 h-3.5" />
                      <span>Retrieved Context Neighborhood XML Layout</span>
                    </div>
                    <pre className="text-ink-faint text-[11px] leading-relaxed whitespace-pre overflow-x-auto">
{`&lt;context query="${searchQuery}"&gt;
  &lt;caller path="${graphNodes[searchQuery as keyof typeof graphNodes][0].label.split(":")[0]}" /&gt;
  &lt;match path="${graphNodes[searchQuery as keyof typeof graphNodes][1].label.split(":")[0]}" fidelity="full" /&gt;
  &lt;callee path="${graphNodes[searchQuery as keyof typeof graphNodes][2].label.split(":")[0]}" fidelity="outline" /&gt;
&lt;/context&gt;`}
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
                      <div className="text-xs font-mono text-ink-dim">Token map (repository token treemap)</div>
                      <div className="grid grid-cols-12 gap-1 panel p-3">
                        {Array.from({ length: 96 }).map((_, i) => {
                          let opacity = "bg-cosmos/5";
                          if (i % 7 === 0) opacity = "bg-cosmos/80";
                          else if (i % 4 === 0) opacity = "bg-cosmos/50";
                          else if (i % 3 === 0) opacity = "bg-cosmos/30";
                          else if (i % 2 === 0) opacity = "bg-cosmos/15";

                          return (
                            <div
                              key={i}
                              className={`h-4 rounded-[2px] transition-all hover:scale-110 cursor-pointer ${opacity}`}
                              title={`Chunk #${i}: ${i % 3 === 0 ? "500 tokens" : "120 tokens"}`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between items-center text-[10px] font-mono text-ink-faint">
                        <span>Low Token Weight</span>
                        <div className="flex items-center space-x-1">
                          <span className="w-2.5 h-2.5 rounded-[1px] bg-cosmos/5" />
                          <span className="w-2.5 h-2.5 rounded-[1px] bg-cosmos/30" />
                          <span className="w-2.5 h-2.5 rounded-[1px] bg-cosmos/50" />
                          <span className="w-2.5 h-2.5 rounded-[1px] bg-cosmos/80" />
                        </div>
                        <span>High Token Weight</span>
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
                          Resolved Call Edges: 12,893 | Nodes: 8,419
                        </div>
                      </div>
                    </div>
                  )}

                  {activeBoard === 2 && (
                    <div className="space-y-3">
                      <div className="text-xs font-mono text-ink-dim">Retrieval Inspector (Query analysis log output)</div>
                      <div className="panel p-4 font-mono text-[11px] leading-relaxed space-y-1 text-ink-dim">
                        <div className="text-emerald-400 font-semibold">[Inspect] Query "middleware" submitted</div>
                        <div>- Token budget set: 32k</div>
                        <div>- Resolved lexical BM25 matching context records: 3</div>
                        <div>- Walked call-graph caller/callee links: 2 hops</div>
                        <div>- Fused BM25 + graph paths via RRF</div>
                        <div className="text-cosmos-soft">- Assembled context neighborhood, ranked by RRF</div>
                      </div>
                    </div>
                  )}

                  {activeBoard === 3 && (
                    <div className="space-y-3">
                      <div className="text-xs font-mono text-ink-dim">Live Pack Configurator (Fidelity weights layout)</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="panel p-3 font-mono text-xs">
                          <div className="text-cosmos-soft font-semibold mb-2">High Priority</div>
                          <div className="space-y-1">
                            <div className="bg-void-2 p-1.5 rounded border border-line text-[10px] flex justify-between">
                              <span>core/engine.ts</span>
                              <span className="text-emerald-400">Full</span>
                            </div>
                            <div className="bg-void-2 p-1.5 rounded border border-line text-[10px] flex justify-between">
                              <span>auth/jwt.ts</span>
                              <span className="text-emerald-400">Full</span>
                            </div>
                          </div>
                        </div>
                        <div className="panel p-3 font-mono text-xs">
                          <div className="text-amber-400 font-semibold mb-2">Auxiliary / Compressible</div>
                          <div className="space-y-1">
                            <div className="bg-void-2 p-1.5 rounded border border-line text-[10px] flex justify-between">
                              <span>utils/helpers.ts</span>
                              <span className="text-amber-400">Skeleton</span>
                            </div>
                            <div className="bg-void-2 p-1.5 rounded border border-line text-[10px] flex justify-between">
                              <span>tests/engine.test.ts</span>
                              <span className="text-red-400">Omitted</span>
                            </div>
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
