import { Sliders, Network, HardDrive, CheckCircle2 } from "lucide-react";
import { TranslationSchema } from "../translations";
import { fidelityExample, fullExample, impact, callGraph } from "../data/realData";

// Trim "packages/" and drop line-range noise for compact node labels.
const shortFile = (p: string) => p.replace(/^(packages\/)?/, "").split("/").pop() ?? p;
const shortName = (n: string) => n.replace(/^.*::/, "");
const fidelityPct = fidelityExample && fidelityExample.fullTokens
  ? Math.round((fidelityExample.compressedTokens! / fidelityExample.fullTokens) * 100)
  : 12;

interface WhySectionProps {
  t: TranslationSchema;
}

// Node style variants for the SVG concept graphs (impact radius + call graph walk).
const NODE_VARIANTS = {
  seed: { fill: "#101014", stroke: "rgba(244,242,236,0.18)", text: "#a8a6a0", sub: "#6b6a66", bold: false },
  changed: { fill: "rgba(91,75,255,0.20)", stroke: "#8b7dff", text: "#f4f2ec", sub: "#8b7dff", bold: true },
  keep: { fill: "rgba(91,75,255,0.07)", stroke: "rgba(139,125,255,0.55)", text: "#e6e4de", sub: "#8b7dff", bold: false },
  match: { fill: "rgba(91,75,255,0.22)", stroke: "#8b7dff", text: "#f4f2ec", sub: "#8b7dff", bold: true },
  neighbor: { fill: "#111116", stroke: "rgba(244,242,236,0.2)", text: "#c9c7c1", sub: "#6b6a66", bold: false },
  excluded: { fill: "rgba(16,16,20,0.7)", stroke: "rgba(244,242,236,0.1)", text: "#6b6a66", sub: "#4a4958", bold: false },
} as const;

// A single labelled graph node, centered on (x, y). Scales with the parent viewBox.
function GNode({
  x, y, w, label, sub, variant,
}: {
  x: number; y: number; w: number; label: string; sub?: string; variant: keyof typeof NODE_VARIANTS;
}) {
  const s = NODE_VARIANTS[variant];
  const h = sub ? 21 : 14;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="4" fill={s.fill} stroke={s.stroke} strokeWidth="1" />
      <text x="0" y={sub ? -2.4 : 2.6} textAnchor="middle" fontSize="7" fill={s.text} fontWeight={s.bold ? 600 : 400}>{label}</text>
      {sub && <text x="0" y="6.4" textAnchor="middle" fontSize="5" fill={s.sub}>{sub}</text>}
    </g>
  );
}

export default function WhySection({ t }: WhySectionProps) {
  const points = [
    {
      id: 1,
      title: t.why.points.p1Title,
      desc: t.why.points.p1Desc,
      icon: <Sliders className="w-5 h-5 text-cosmos-soft" />,
      visual: (
        <div className="panel h-28 p-3 flex flex-col justify-between font-mono text-[10px]">
          <div className="flex justify-between border-b border-line pb-1.5 text-ink-faint">
            <span>{t.why.v1Label}</span>
            <span className="text-emerald-400">XML Outline</span>
          </div>
          <div className="space-y-1 text-ink-dim">
            <div className="flex items-center justify-between">
              <span>{shortFile(fullExample?.path ?? "rank.ts")}</span>
              <span className="text-[9px] bg-emerald-500/10 text-emerald-300 px-1.5 rounded">{fullExample?.tokens?.toLocaleString()} tok · full</span>
            </div>
            <div className="w-full bg-void-2 h-1 rounded overflow-hidden">
              <div className="bg-emerald-400 h-full w-full" />
            </div>
            <div className="flex items-center justify-between">
              <span>{shortFile(fidelityExample?.path ?? "status.ts")}</span>
              <span className="text-[9px] bg-amber-500/10 text-amber-300 px-1.5 rounded">{fidelityExample?.compressedTokens} tok · {fidelityPct}%</span>
            </div>
            <div className="w-full bg-void-2 h-1 rounded overflow-hidden">
              <div className="bg-amber-400 h-full" style={{ width: `${fidelityPct}%` }} />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 2,
      title: t.why.points.p2Title,
      desc: t.why.points.p2Desc,
      icon: <CheckCircle2 className="w-5 h-5 text-cosmos-soft" />,
      visual: (
        <div className="panel h-44 p-3.5 flex flex-col font-mono text-[10px]">
          <div className="text-ink-faint border-b border-line pb-1.5 flex items-center justify-between shrink-0">
            <span>{t.why.v2Label}</span>
            <span className="text-cosmos-soft">{impact.r1Count} impacted</span>
          </div>
          <svg viewBox="0 0 260 116" className="w-full h-full mt-1" preserveAspectRatio="xMidYMid meet">
            {/* r=1 cutoff boundary: everything left of it is packed, right is dropped */}
            <line x1="184" y1="6" x2="184" y2="110" stroke="rgba(139,125,255,0.4)" strokeWidth="1" strokeDasharray="3,3" />
            <text x="188" y="14" fontSize="5.5" fill="#6b6a66">r=1 cutoff</text>
            {/* edges: changed -> r1 dependents (solid), r1 -> r2 (dropped, dashed faded) */}
            <g stroke="#5b4bff" fill="none">
              <line x1="42" y1="58" x2="78" y2="58" strokeWidth="1.4" />
              <line x1="114" y1="54" x2="148" y2="30" strokeWidth="1.4" />
              <line x1="114" y1="62" x2="148" y2="86" strokeWidth="1.4" />
            </g>
            <g stroke="rgba(139,125,255,0.28)" fill="none" strokeDasharray="2.5,2.5">
              <line x1="176" y1="30" x2="212" y2="30" strokeWidth="1" />
              <line x1="176" y1="86" x2="212" y2="86" strokeWidth="1" />
            </g>
            <GNode x={22} y={58} w={30} label="change" variant="seed" />
            <GNode x={96} y={58} w={48} label={shortName(impact.seed.name)} sub="changed" variant="changed" />
            <GNode x={162} y={30} w={44} label={shortName(impact.r1Sample[0]?.name ?? "registerIndex").slice(0, 9)} sub="r1 · packed" variant="keep" />
            <GNode x={162} y={86} w={44} label={shortName(impact.r1Sample[1]?.name ?? "registerSearch").slice(0, 9)} sub="r1 · packed" variant="keep" />
            <GNode x={230} y={30} w={40} label={`+${impact.r1Count - 2}`} sub="at r1" variant="keep" />
            <GNode x={230} y={86} w={40} label={`+${impact.r2Count}`} sub="r2 · dropped" variant="excluded" />
          </svg>
        </div>
      ),
    },
    {
      id: 3,
      title: t.why.points.p3Title,
      desc: t.why.points.p3Desc,
      icon: <Network className="w-5 h-5 text-cosmos-soft" />,
      visual: (
        <div className="panel h-44 p-3.5 flex flex-col font-mono text-[10px]">
          <div className="text-ink-faint border-b border-line pb-1.5 flex items-center justify-between shrink-0">
            <span>{t.why.v3Label}</span>
            <span className="text-cosmos-soft">BM25 + graph</span>
          </div>
          <svg viewBox="0 0 260 116" className="w-full h-full mt-1" preserveAspectRatio="xMidYMid meet">
            <defs>
              <marker id="cvArrow" markerWidth="6" markerHeight="6" refX="5" refY="2" orient="auto">
                <path d="M0,0 L5,2 L0,4 Z" fill="#8b7dff" />
              </marker>
            </defs>
            {/* column captions */}
            <text x="32" y="12" textAnchor="middle" fontSize="5.5" fill="#6b6a66">caller</text>
            <text x="128" y="12" textAnchor="middle" fontSize="5.5" fill="#8b7dff">node</text>
            <text x="224" y="12" textAnchor="middle" fontSize="5.5" fill="#6b6a66">callees</text>
            {/* caller edge (incoming) and callee edges (outgoing), marked with direction */}
            <g stroke="#5b4bff" fill="none" markerEnd="url(#cvArrow)">
              <line x1="58" y1="58" x2="98" y2="58" strokeWidth="1.4" />
              <line x1="158" y1="52" x2="194" y2="34" strokeWidth="1.4" />
              <line x1="158" y1="58" x2="194" y2="58" strokeWidth="1.4" />
              <line x1="158" y1="64" x2="194" y2="82" strokeWidth="1.4" />
            </g>
            <GNode x={32} y={58} w={52} label={shortName(callGraph.callers[0]?.name ?? "createHandler")} sub="caller" variant="neighbor" />
            <GNode x={128} y={58} w={44} label={shortName(callGraph.root.name)} sub="hit" variant="match" />
            <GNode x={224} y={34} w={52} label={shortName(callGraph.callees[2]?.name ?? "compress")} sub="callee" variant="neighbor" />
            <GNode x={224} y={58} w={52} label={shortName(callGraph.callees[4]?.name ?? "parseFilesCached")} sub="callee" variant="neighbor" />
            <GNode x={224} y={82} w={44} label={`+${callGraph.callees.length - 2}`} sub="callees" variant="neighbor" />
          </svg>
        </div>
      ),
    },
    {
      id: 4,
      title: t.why.points.p4Title,
      desc: t.why.points.p4Desc,
      icon: <HardDrive className="w-5 h-5 text-cosmos-soft" />,
      visual: (
        <div className="panel h-28 p-3.5 flex flex-col justify-between font-mono text-[10px]">
          <div className="text-ink-faint border-b border-line pb-1.5">{t.why.v4Label}</div>
          <div className="flex justify-between items-center bg-void-2/60 p-2 rounded-lg border border-line/50">
            <span className="text-cosmos-soft font-semibold">.codingverse/index.db</span>
            <span className="text-[9px] text-ink-faint">SQLite3</span>
          </div>
          <div className="flex justify-between text-[9px] text-ink-dim px-1">
            <span>No Cloud Sync</span>
            <span>&bull;</span>
            <span>No Embeddings</span>
            <span>&bull;</span>
            <span>No API Keys</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div id="why-section" className="space-y-16">
      {/* Header text */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <h2 className="font-display text-3xl md:text-5xl lg:text-6xl text-ink tracking-tight font-medium">
          {t.why.title}
        </h2>
        <p className="text-ink-dim max-w-2xl mx-auto text-base leading-relaxed">
          {t.why.lead}
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-7xl mx-auto">
        {points.map((pt) => (
          <div
            key={pt.id}
            className="surface panel-hover p-8 flex flex-col md:flex-row gap-6 items-stretch justify-between"
          >
            {/* Description half */}
            <div className="flex-1 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="panel p-2 inline-block">
                  {pt.icon}
                </div>
                <h3 className="font-display text-xl lg:text-2xl text-ink font-semibold tracking-tight">
                  {pt.title}
                </h3>
              </div>
              <p className="text-xs text-ink-dim leading-relaxed font-sans max-w-sm">
                {pt.desc}
              </p>
            </div>

            {/* Live Interactive/Concept illustration half */}
            <div className="flex-1 min-w-[220px] flex flex-col justify-center">
              {pt.visual}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
