import { useState } from "react";
import { Copy, Check, Palette, Type, Box, Layers, ShieldCheck, Heart, Download } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { TranslationSchema } from "../translations";

interface BrandSystemExplorerProps {
  t: TranslationSchema;
}

export default function BrandSystemExplorer({ t }: BrandSystemExplorerProps) {
  const [activeTab, setActiveTab] = useState<"logo" | "colors" | "typography" | "components" | "principles">("logo");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string>("Index once. Three ways out.");
  const [fontSize, setFontSize] = useState<number>(48);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const colors = [
    { name: "Void (Primary Dark)", hex: "#0a0a0c", role: "Primary background Canvas", contrast: "AAA against Ink" },
    { name: "Void 2 (Surface Elevated)", hex: "#101014", role: "Cards and container surfaces", contrast: "AA+ against Ink" },
    { name: "Void 3 (Highest Surface)", hex: "#16161c", role: "Headers, bars and indicators", contrast: "AA against Ink-dim" },
    { name: "Ink (Ivory Primary Light)", hex: "#f4f2ec", role: "Primary typography and critical outlines", contrast: "AAA against Void" },
    { name: "Ink-Dim (Secondary Light)", hex: "#a8a6a0", role: "Body text and descriptive labels", contrast: "AA against Void" },
    { name: "Ink-Faint (Tertiary Light)", hex: "#6b6a66", role: "Captions, disabled, and metadata", contrast: "Auxiliary content" },
    { name: "Cosmos (Accent Violet)", hex: "#5b4bff", role: "Core interactive accent / links", contrast: "AA against Ink" },
    { name: "Cosmos-Soft (Accent Light)", hex: "#8b7dff", role: "Interactive hover states and glowing nodes", contrast: "High-contrast highlighting" },
  ];

  const svgLogoRaw = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" rx="10" fill="#101014" stroke="rgba(244,242,236,0.08)" stroke-width="1.5"/>
  <!-- Central Monolith Core -->
  <path d="M24 10L14 16V32L24 38L34 32V16L24 10Z" fill="#0a0a0c" stroke="#5b4bff" stroke-width="2"/>
  <!-- Inner 3-way RAG routing vector nodes -->
  <line x1="24" y1="10" x2="24" y2="38" stroke="rgba(244,242,236,0.25)" stroke-width="1.5"/>
  <line x1="14" y1="32" x2="34" y2="16" stroke="rgba(244,242,236,0.25)" stroke-width="1.5"/>
  <line x1="14" y1="16" x2="34" y2="32" stroke="rgba(244,242,236,0.25)" stroke-width="1.5"/>
  <circle cx="24" cy="24" r="3.5" fill="#8b7dff" stroke="#0a0a0c" stroke-width="1.5"/>
</svg>`;

  const wordmarkRaw = `<span style="font-family: 'Fraunces', serif; font-weight: 500; letter-spacing: -0.04em;">codingverse</span>`;

  return (
    <div id="brand-system-section" className="border border-line rounded-3xl bg-void-2/20 backdrop-blur-sm overflow-hidden shadow-2xl">
      {/* Brand Section Header */}
      <div className="p-8 lg:p-12 border-b border-line space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-serif text-3xl lg:text-4xl text-ink tracking-tight font-medium">
              {t.brandExplorer.tabTitle}
            </h3>
            <p className="text-sm text-ink-dim max-w-2xl">
              {t.brandExplorer.p1}
            </p>
          </div>
          <div className="flex items-center space-x-2 text-xs font-mono text-ink-faint">
            <span className="bg-void-3 border border-line px-3 py-1 rounded-full text-cosmos-soft font-semibold">
              Design System: v1.0.0
            </span>
          </div>
        </div>

        {/* Inner sub-tabs */}
        <div className="flex flex-wrap gap-2 pt-6">
          {[
            { id: "logo", label: "Logo & Wordmark", icon: <Box className="w-4 h-4" /> },
            { id: "colors", label: t.brandExplorer.colors, icon: <Palette className="w-4 h-4" /> },
            { id: "typography", label: t.brandExplorer.typography, icon: <Type className="w-4 h-4" /> },
            { id: "components", label: t.brandExplorer.components, icon: <Layers className="w-4 h-4" /> },
            { id: "principles", label: t.brandExplorer.principles, icon: <ShieldCheck className="w-4 h-4" /> },
          ].map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl font-mono text-xs transition-all cursor-pointer ${
                  isSelected
                    ? "bg-cosmos text-ink shadow-md shadow-cosmos/10 font-bold"
                    : "bg-void-3/60 text-ink-dim hover:text-ink hover:bg-void-3"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Explorer Content Window */}
      <div className="p-8 lg:p-12 min-h-[380px] bg-[#050507]">
        <AnimatePresence mode="wait">
          {activeTab === "logo" && (
            <motion.div
              key="logo-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
            >
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-void-2 p-6 rounded-2xl border border-line flex flex-col items-center justify-center text-center space-y-4">
                  <div className="text-xs font-mono text-ink-faint uppercase">Symbol (Monolith Monogram)</div>
                  {/* Monogram Monolith SVG */}
                  <div dangerouslySetInnerHTML={{ __html: svgLogoRaw }} className="hover:scale-105 transition-transform" />
                  <p className="text-[11px] font-mono text-ink-faint leading-relaxed">
                    Designed around tree-sitter node mappings routing from a central index to 3 outbound avenues (pack, search, observe).
                  </p>
                  <button
                    onClick={() => copyToClipboard(svgLogoRaw, "monogram")}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-void-3 border border-line text-[10px] font-mono text-ink hover:text-cosmos-soft transition-colors cursor-pointer"
                  >
                    {copiedText === "monogram" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied SVG!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy SVG Source</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="bg-void-2 p-6 rounded-2xl border border-line flex flex-col items-center justify-center text-center space-y-4">
                  <div className="text-xs font-mono text-ink-faint uppercase">Wordmark Brand Typography</div>
                  <div className="text-3xl font-serif text-ink tracking-tight font-medium select-none">
                    codingverse
                  </div>
                  <p className="text-[11px] font-mono text-ink-faint leading-relaxed">
                    Wordmark is set in Fraunces Display, Medium, tight tracking (-0.04em). Lowercase represents approachable open-source integrity.
                  </p>
                  <button
                    onClick={() => copyToClipboard(wordmarkRaw, "wordmark")}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-void-3 border border-line text-[10px] font-mono text-ink hover:text-cosmos-soft transition-colors cursor-pointer"
                  >
                    {copiedText === "wordmark" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied HTML!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy HTML Tag</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="lg:col-span-8 bg-void-3/50 p-6 rounded-2xl border border-line space-y-4">
                <h4 className="font-mono text-sm text-cosmos-soft font-semibold">Favicon & Asset Layout Schema</h4>
                <p className="text-xs text-ink-dim leading-relaxed font-sans">
                  Use the monogram icon for avatars, favicons (16x16, 32x32, 192x192), and mobile launcher marks. The wordmark is preferred in navigation rails and page footers. Maintain a safety margin around the logo equal to 25% of its width/height boundaries.
                </p>

                <div className="pt-4 border-t border-line grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-ink-faint uppercase">Logo SVG Properties</span>
                    <pre className="p-3 bg-void-3 rounded-xl text-[10px] font-mono text-[#dfded9] overflow-x-auto max-h-[140px]">
{`<!-- Monogram SVG ViewBox -->
<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
  <rect width="48" height="48" rx="10" fill="#101014" />
  <path d="..." fill="#0a0a0c" stroke="#5b4bff" />
</svg>`}
                    </pre>
                  </div>
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-ink-faint uppercase">Brand Co-branding lockup</span>
                    <div className="p-4 bg-void-2 rounded-xl flex items-center space-x-3 border border-line">
                      <div dangerouslySetInnerHTML={{ __html: svgLogoRaw.replace('width="48"', 'width="32"').replace('height="48"', 'height="32"') }} />
                      <div className="h-6 w-px bg-line" />
                      <span className="font-serif font-medium text-lg text-ink">codingverse</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "colors" && (
            <motion.div
              key="colors-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {colors.map((color) => (
                  <div
                    key={color.name}
                    className="bg-void-2 border border-line rounded-2xl overflow-hidden flex flex-col justify-between group shadow-lg"
                  >
                    {/* Color Swatch Panel */}
                    <div
                      className="h-24 w-full transition-all group-hover:scale-105 duration-300 relative"
                      style={{ backgroundColor: color.hex }}
                    >
                      <button
                        onClick={() => copyToClipboard(color.hex, color.hex)}
                        className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-void/80 border border-line opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-ink hover:text-cosmos-soft cursor-pointer"
                        title="Copy Hex"
                      >
                        {copiedText === color.hex ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Metadata */}
                    <div className="p-4 space-y-1.5 font-mono text-xs">
                      <div className="font-bold text-ink flex items-center justify-between">
                        <span>{color.name.split(" ")[0]}</span>
                        <span className="text-cosmos-soft font-medium text-[11px]">{color.hex}</span>
                      </div>
                      <div className="text-[10px] text-ink-dim leading-relaxed h-10 overflow-hidden">
                        {color.role}
                      </div>
                      <div className="text-[9px] bg-void-3 text-ink-faint px-1.5 py-0.5 rounded inline-block">
                        {color.contrast}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-void-3/50 p-6 rounded-2xl border border-line space-y-3 font-mono text-xs">
                <h4 className="text-cosmos-soft font-bold">Accent Color Deployment Strategy (Restraint is King)</h4>
                <p className="text-ink-dim leading-relaxed font-sans">
                  The primary background <span className="font-mono text-cosmos-soft">#0a0a0c</span> creates a massive cosmic void. The accent <span className="font-mono text-cosmos-soft">#5b4bff</span> (Cosmos) and <span className="font-mono text-cosmos-soft">#8b7dff</span> (Cosmos-Soft) must represent less than 5% of the total layout surface area. Use them strictly to highlight interactive elements, nodes, or critical CLI matching paths. Never use cosmic purple as general paragraph backgrounds or large block headers.
                </p>
              </div>
            </motion.div>
          )}

          {activeTab === "typography" && (
            <motion.div
              key="typography-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
            >
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-void-2 p-6 rounded-2xl border border-line space-y-4">
                  <h4 className="font-mono text-xs text-ink-faint uppercase">Typography Live Scale Tester</h4>
                  
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-ink-faint">Type Custom Preview Content:</span>
                    <input
                      type="text"
                      value={textPreview}
                      onChange={(e) => setTextPreview(e.target.value)}
                      className="w-full bg-void-3 border border-line p-2.5 rounded-lg text-xs text-ink font-sans focus:outline-none focus:border-cosmos"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-mono text-ink-faint">
                      <span>Display Size:</span>
                      <span className="text-cosmos-soft">{fontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min="24"
                      max="80"
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="w-full accent-cosmos bg-void-3 h-1 appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <div className="bg-void-2 p-6 rounded-2xl border border-line space-y-4 font-mono text-xs">
                  <div className="text-xs font-mono text-ink-faint uppercase">The Three Font Pillars</div>
                  <div className="space-y-3">
                    <div className="border-l-2 border-cosmos pl-3">
                      <div className="font-bold text-ink">Fraunces (Display Serif)</div>
                      <p className="text-[10px] text-ink-faint font-sans">Used for oversized main headlines, numbers, and hero editorial typography. Evokes a monumental, quiet grandeur.</p>
                    </div>
                    <div className="border-l-2 border-line pl-3">
                      <div className="font-bold text-ink">Inter (Body Sans-Serif)</div>
                      <p className="text-[10px] text-ink-faint font-sans">Used for paragraphs, description notes, navigation tags, and utility copy. Neutral and crisp.</p>
                    </div>
                    <div className="border-l-2 border-line pl-3">
                      <div className="font-bold text-ink">JetBrains Mono (Technical Mono)</div>
                      <p className="text-[10px] text-ink-faint font-sans">Used for CLI commands, SQLite schemas, token logs, tags, and small eyebrows. High technical precision.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 bg-void-3/40 p-6 rounded-2xl border border-line space-y-6">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-cosmos-soft uppercase tracking-wider font-bold">Fraunces Display Preview</span>
                  <div
                    style={{ fontSize: `${fontSize}px` }}
                    className="font-serif text-ink leading-tight tracking-tight font-medium"
                  >
                    {textPreview}
                  </div>
                </div>

                <div className="pt-6 border-t border-line space-y-2">
                  <span className="text-[10px] font-mono text-ink-faint uppercase">Example Hierarchy</span>
                  <div className="space-y-3 font-mono text-xs">
                    <div className="flex items-center justify-between text-[11px] text-ink-faint border-b border-line/30 pb-1">
                      <span>Tag / Eyebrow</span>
                      <span>JetBrains Mono SemiBold • Tracking Wide</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-ink-faint border-b border-line/30 pb-1">
                      <span>Display Heading</span>
                      <span>Fraunces Regular/Medium • Tracking Tight</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-ink-faint border-b border-line/30 pb-1">
                      <span>Body Paragraph</span>
                      <span>Inter Light/Regular • Tracking Normal • Leading Relaxed</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "components" && (
            <motion.div
              key="components-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start"
            >
              {/* Button library */}
              <div className="bg-void-2 p-6 rounded-2xl border border-line space-y-4">
                <h4 className="font-mono text-xs text-ink-faint uppercase">Buttons & Controls</h4>
                
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button className="px-5 py-2.5 rounded-full bg-cosmos hover:bg-cosmos-soft text-ink text-xs font-semibold font-sans transition-all cursor-pointer">
                      Primary CTA
                    </button>
                    <button className="px-5 py-2.5 rounded-full border border-line hover:border-ink bg-void-3 text-ink text-xs font-semibold font-sans transition-all cursor-pointer">
                      Secondary Outline
                    </button>
                    <button className="px-4 py-2 rounded-xl text-ink-dim hover:text-ink hover:bg-void-3 text-xs font-semibold font-mono transition-all cursor-pointer">
                      Ghost link &gt;
                    </button>
                  </div>

                  <div className="bg-void-3 p-3 rounded-xl text-[10px] font-mono text-ink-faint leading-relaxed space-y-1">
                    <div><span className="text-cosmos-soft">Primary:</span> <code className="text-ink">px-5 py-2.5 rounded-full bg-cosmos text-ink hover:bg-cosmos-soft</code></div>
                    <div><span className="text-cosmos-soft">Outline:</span> <code className="text-ink">px-5 py-2.5 rounded-full border border-line bg-void-3 text-ink hover:border-ink</code></div>
                  </div>
                </div>
              </div>

              {/* Pills and badges */}
              <div className="bg-void-2 p-6 rounded-2xl border border-line space-y-4">
                <h4 className="font-mono text-xs text-ink-faint uppercase">Pills & Status Badges</h4>
                
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border border-cosmos/25 bg-cosmos/5 text-[10px] font-mono text-cosmos-soft uppercase tracking-wider">
                      <span>Active Node</span>
                    </span>
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border border-line bg-void-3 text-[10px] font-mono text-ink-dim">
                      <span>100% Local</span>
                    </span>
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 text-[10px] font-mono text-emerald-400 uppercase tracking-wider">
                      <span>MIT License</span>
                    </span>
                  </div>

                  <div className="bg-void-3 p-3 rounded-xl text-[10px] font-mono text-ink-faint leading-relaxed space-y-1">
                    <div><span className="text-cosmos-soft">Cosmos Tag:</span> <code className="text-ink">border border-cosmos/25 bg-cosmos/5 text-cosmos-soft font-mono uppercase</code></div>
                    <div><span className="text-cosmos-soft">Neutral Tag:</span> <code className="text-ink">border border-line bg-void-3 text-ink-dim font-mono</code></div>
                  </div>
                </div>
              </div>

              {/* Code outline block card */}
              <div className="bg-void-2 p-6 rounded-2xl border border-line space-y-4 md:col-span-2">
                <h4 className="font-mono text-xs text-ink-faint uppercase">Card & Monolith Container Pattern</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-6 rounded-2xl bg-void-3/40 border border-line hover:border-cosmos/30 hover:bg-void-3/60 transition-all space-y-3 cursor-pointer">
                    <span className="w-6 h-6 rounded-full bg-cosmos/10 text-cosmos-soft flex items-center justify-center font-mono text-xs font-semibold">01</span>
                    <h5 className="font-serif text-lg text-ink font-semibold">Subtle Outline Card</h5>
                    <p className="text-xs text-ink-dim leading-relaxed">
                      Hairline outlines with rounded corners define boundaries while preserving clean void negative space.
                    </p>
                  </div>

                  <div className="p-6 rounded-2xl bg-void-3/40 border border-line hover:border-cosmos/30 hover:bg-void-3/60 transition-all space-y-3 cursor-pointer">
                    <span className="w-6 h-6 rounded-full bg-cosmos/10 text-cosmos-soft flex items-center justify-center font-mono text-xs font-semibold">02</span>
                    <h5 className="font-serif text-lg text-ink font-semibold">Staggered Rhythm</h5>
                    <p className="text-xs text-ink-dim leading-relaxed">
                      Slight shifts in corner elements and borders prevent repetitive layouts, keeping visitors engaged.
                    </p>
                  </div>

                  <div className="p-6 rounded-2xl bg-void-2 border border-line hover:border-cosmos/30 hover:bg-void-3/60 transition-all space-y-3 cursor-pointer relative overflow-hidden">
                    <div className="absolute top-0 right-0 h-16 w-16 bg-gradient-to-bl from-cosmos/10 via-transparent to-transparent" />
                    <span className="w-6 h-6 rounded-full bg-cosmos/10 text-cosmos-soft flex items-center justify-center font-mono text-xs font-semibold">03</span>
                    <h5 className="font-serif text-lg text-ink font-semibold">Cosmic Highlight</h5>
                    <p className="text-xs text-ink-dim leading-relaxed">
                      A quiet, diagonal corner gradient provides depth without visual clutter or heavy glow.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "principles" && (
            <motion.div
              key="principles-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            >
              {[
                {
                  title: "Architectural Honesty",
                  desc: "Avoid fake telemetry lines, mock port indicators, or simulated server terminal noises. Present real, precise, unembellished commands and outcomes.",
                  keyword: "Honest",
                },
                {
                  title: "Luxury via Whitespace",
                  desc: "Vast negative space establishes quiet confidence. Give headers, paragraphs, and sections ample margins (100-160px) to breathe deeply.",
                  keyword: "Spacious",
                },
                {
                  title: "The Precious Accent",
                  desc: "Limit cosmic violet highlights to less than 5% area weight. Restraint makes accent colors feel incredibly precious and functional.",
                  keyword: "Restrained",
                },
                {
                  title: "Editorial Grandeur",
                  desc: "Oversized, elegant display serifs like Fraunces project premium intent and scale, replacing heavy images or busy icons.",
                  keyword: "Grand",
                },
              ].map((p, idx) => (
                <div
                  key={idx}
                  className="bg-void-2 border border-line p-6 rounded-2xl flex flex-col justify-between space-y-4 shadow-lg hover:border-cosmos/20 transition-all"
                >
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-cosmos-soft tracking-widest uppercase font-semibold">
                      Principle 0{idx + 1}
                    </span>
                    <h5 className="font-serif text-lg text-ink font-semibold">{p.title}</h5>
                    <p className="text-xs text-ink-dim leading-relaxed font-sans">{p.desc}</p>
                  </div>
                  <div className="text-[10px] font-mono text-ink-faint flex items-center justify-between pt-4 border-t border-line/30">
                    <span>Guideline Mode</span>
                    <span className="text-ink-dim font-bold uppercase">{p.keyword}</span>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
