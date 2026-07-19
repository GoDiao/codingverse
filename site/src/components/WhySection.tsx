import { Shield, Sliders, Network, HardDrive, CheckCircle2 } from "lucide-react";
import { TranslationSchema } from "../translations";

interface WhySectionProps {
  t: TranslationSchema;
}

export default function WhySection({ t }: WhySectionProps) {
  const points = [
    {
      id: 1,
      title: t.why.points.p1Title,
      desc: t.why.points.p1Desc,
      icon: <Sliders className="w-5 h-5 text-cosmos-soft" />,
      visual: (
        <div className="h-28 bg-void-3 rounded-xl border border-line p-3 flex flex-col justify-between font-mono text-[10px]">
          <div className="flex justify-between border-b border-line pb-1.5 text-ink-faint">
            <span>{t.why.v1Label}</span>
            <span className="text-emerald-400">XML Outline</span>
          </div>
          <div className="space-y-1 text-ink-dim">
            <div className="flex items-center justify-between">
              <span>core/engine.ts</span>
              <span className="text-[9px] bg-emerald-500/10 text-emerald-300 px-1.5 rounded">100% (Full)</span>
            </div>
            <div className="w-full bg-void-2 h-1 rounded overflow-hidden">
              <div className="bg-emerald-400 h-full w-full" />
            </div>
            <div className="flex items-center justify-between">
              <span>utils/logger.ts</span>
              <span className="text-[9px] bg-amber-500/10 text-amber-300 px-1.5 rounded">12% (Skeleton)</span>
            </div>
            <div className="w-full bg-void-2 h-1 rounded overflow-hidden">
              <div className="bg-amber-400 h-full w-[12%]" />
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
        <div className="h-28 bg-void-3 rounded-xl border border-line p-3.5 flex flex-col justify-between font-mono text-[10px]">
          <div className="text-ink-faint border-b border-line pb-1.5 flex items-center justify-between">
            <span>{t.why.v2Label}</span>
            <span>r = 1 hop</span>
          </div>
          <div className="flex items-center justify-center space-x-2 mt-2">
            <div className="w-10 h-6 rounded bg-void-2 border border-line flex items-center justify-center text-[8px] text-ink-faint">
              Commit
            </div>
            <div className="text-cosmos-soft text-sm">&rarr;</div>
            <div className="w-12 h-8 rounded bg-cosmos/15 border border-cosmos/50 flex flex-col items-center justify-center text-[8px] text-ink">
              <span>engine.ts</span>
              <span className="text-[6px] text-cosmos-soft">(Changed)</span>
            </div>
            <div className="text-cosmos-soft text-sm">&rarr;</div>
            <div className="w-12 h-8 rounded bg-void-2 border border-line/50 flex flex-col items-center justify-center text-[8px] text-ink-dim">
              <span>router.ts</span>
              <span className="text-[6px] text-ink-faint">(Impact)</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 3,
      title: t.why.points.p3Title,
      desc: t.why.points.p3Desc,
      icon: <Network className="w-5 h-5 text-cosmos-soft" />,
      visual: (
        <div className="h-28 bg-void-3 rounded-xl border border-line p-3 flex flex-col justify-between font-mono text-[10px] relative overflow-hidden">
          <div className="text-ink-faint border-b border-line pb-1.5">{t.why.v3Label}</div>
          <div className="flex items-center justify-center h-full relative">
            {/* SVG Call Graph link overlay */}
            <svg className="absolute inset-0 w-full h-full opacity-40">
              <line x1="40" y1="45" x2="110" y2="45" stroke="#5b4bff" strokeWidth="1.5" />
              <line x1="110" y1="45" x2="180" y2="25" stroke="#5b4bff" strokeWidth="1" strokeDasharray="3,3" />
              <line x1="110" y1="45" x2="180" y2="65" stroke="#5b4bff" strokeWidth="1" />
            </svg>
            <div className="absolute left-6 top-7 px-1.5 py-0.5 rounded bg-void-2 border border-line text-[8px]">caller</div>
            <div className="absolute left-[92px] top-7 px-1.5 py-0.5 rounded bg-cosmos/10 border border-cosmos text-[8px] font-bold text-ink">MATCH</div>
            <div className="absolute right-4 top-2 px-1.5 py-0.5 rounded bg-void-2 border border-line text-[8px]">callee</div>
            <div className="absolute right-4 bottom-2 px-1.5 py-0.5 rounded bg-void-2 border border-line text-[8px]">callee</div>
          </div>
        </div>
      ),
    },
    {
      id: 4,
      title: t.why.points.p4Title,
      desc: t.why.points.p4Desc,
      icon: <HardDrive className="w-5 h-5 text-cosmos-soft" />,
      visual: (
        <div className="h-28 bg-void-3 rounded-xl border border-line p-3.5 flex flex-col justify-between font-mono text-[10px]">
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
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-line bg-void-2/60 text-xs font-mono text-ink-dim uppercase tracking-widest">
          <Shield className="w-3.5 h-3.5 text-cosmos-soft" />
          <span>{t.why.eyebrow}</span>
        </div>
        <h2 className="font-serif text-3xl md:text-5xl lg:text-6xl text-ink tracking-tight font-medium">
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
            className="p-8 rounded-3xl bg-void-2/40 border border-line/70 hover:border-cosmos/35 hover:bg-void-2/85 transition-all duration-300 flex flex-col md:flex-row gap-6 items-stretch justify-between shadow-lg"
          >
            {/* Description half */}
            <div className="flex-1 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="p-2 rounded-xl bg-void-3 border border-line inline-block shadow-inner">
                  {pt.icon}
                </div>
                <h3 className="font-serif text-xl lg:text-2xl text-ink font-semibold tracking-tight">
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
