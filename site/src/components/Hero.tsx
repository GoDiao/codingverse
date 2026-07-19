import { Layers, Search, Eye, ArrowDown, Database } from "lucide-react";
import { motion } from "motion/react";
import { TranslationSchema } from "../translations";

interface HeroProps {
  t: TranslationSchema;
}

export default function Hero({ t }: HeroProps) {
  return (
    <header className="relative py-24 lg:py-36 overflow-hidden flex flex-col items-center justify-center min-h-[85vh] text-center px-6">
      {/* Background Soft Cosmic Blur Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-cosmos/10 glow-blur pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] rounded-full bg-cosmos-soft/5 glow-blur pointer-events-none" />

      {/* Main Container */}
      <div className="max-w-4xl mx-auto space-y-10 relative z-10">
        
        {/* Eyebrow Tag */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full border border-line bg-void-2/60 text-xs font-mono text-ink-dim tracking-wider"
        >
          <span className="w-2 h-2 rounded-full bg-cosmos animate-pulse" />
          <span>{t.hero.eyebrow}</span>
        </motion.div>

        {/* Brand Main Title & Tagline */}
        <div className="space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="font-serif text-6xl sm:text-7xl md:text-8xl lg:text-9xl tracking-tighter text-ink font-semibold select-none"
          >
            codingverse
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="font-serif text-2xl sm:text-3xl md:text-4xl text-cosmos-soft tracking-tight font-light"
          >
            {t.hero.tagline}
          </motion.p>
        </div>

        {/* Subtitle description */}
        <motion.p
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="text-ink-dim max-w-2xl mx-auto text-base sm:text-lg leading-relaxed font-sans"
        >
          {t.hero.sub}
        </motion.p>

        {/* Actions Button Bar */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-4"
        >
          <a
            href="#terminal-demo-section"
            className="w-full sm:w-auto px-8 py-4 rounded-full bg-cosmos hover:bg-cosmos-soft text-ink font-sans font-semibold tracking-wide shadow-xl shadow-cosmos/15 hover:shadow-cosmos/25 transition-all text-center cursor-pointer"
          >
            {t.hero.primaryCta}
          </a>
          <a
            href="https://github.com/GoDiao/codingverse"
            target="_blank"
            rel="noreferrer"
            className="w-full sm:w-auto px-8 py-4 rounded-full border border-line bg-void-2 hover:border-ink hover:bg-void-3 text-ink font-sans font-semibold tracking-wide transition-all text-center cursor-pointer"
          >
            {t.hero.secondaryCta}
          </a>
        </motion.div>

        {/* Metadata stats row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="pt-6 text-xs font-mono text-ink-faint tracking-widest uppercase"
        >
          {t.hero.metaRow}
        </motion.div>
      </div>

      {/* Decorative Interactive Concept Diagram of "one index → three outputs" */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 0.85, scale: 1 }}
        transition={{ duration: 1, delay: 0.6 }}
        className="mt-16 w-full max-w-xl mx-auto relative px-4"
      >
        <div className="bg-void-2/35 border border-line rounded-2xl p-6 relative">
          {/* Central Repository Monolith */}
          <div className="flex flex-col items-center space-y-2 mb-10 relative z-10">
            <div className="w-16 h-16 rounded-xl bg-void-3 border border-cosmos/30 flex items-center justify-center shadow-lg shadow-cosmos/10 relative group">
              <Database className="w-7 h-7 text-cosmos-soft" />
              <div className="absolute inset-0 bg-cosmos/10 rounded-xl blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="text-[10px] font-mono uppercase text-ink-dim tracking-wider">
              Local Repo Index (SQLite)
            </span>
          </div>

          {/* Lines and connections */}
          <div className="grid grid-cols-3 gap-4 relative z-10">
            {/* pack path */}
            <div className="flex flex-col items-center text-center space-y-2 group cursor-pointer">
              <div className="w-11 h-11 rounded-full bg-void-3 border border-line group-hover:border-cosmos/50 flex items-center justify-center transition-colors">
                <Layers className="w-5 h-5 text-ink-dim group-hover:text-ink" />
              </div>
              <span className="text-[11px] font-mono text-ink-dim uppercase">pack</span>
              <span className="text-[9px] text-ink-faint">LLM context</span>
            </div>

            {/* search path */}
            <div className="flex flex-col items-center text-center space-y-2 group cursor-pointer">
              <div className="w-11 h-11 rounded-full bg-void-3 border border-line group-hover:border-cosmos/50 flex items-center justify-center transition-colors">
                <Search className="w-5 h-5 text-ink-dim group-hover:text-ink" />
              </div>
              <span className="text-[11px] font-mono text-ink-dim uppercase">search</span>
              <span className="text-[9px] text-ink-faint">graph retrieval</span>
            </div>

            {/* observe path */}
            <div className="flex flex-col items-center text-center space-y-2 group cursor-pointer">
              <div className="w-11 h-11 rounded-full bg-void-3 border border-line group-hover:border-cosmos/50 flex items-center justify-center transition-colors">
                <Eye className="w-5 h-5 text-ink-dim group-hover:text-ink" />
              </div>
              <span className="text-[11px] font-mono text-ink-dim uppercase">observe</span>
              <span className="text-[9px] text-ink-faint">live dashboard</span>
            </div>
          </div>

          {/* Flow vectors lines (SVG overlays) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30">
            <path
              d="M 288,72 L 120,132"
              fill="none"
              stroke="#5b4bff"
              strokeWidth="1.5"
              strokeDasharray="5, 5"
              className="animate-[dash_10s_linear_infinite]"
            />
            <path
              d="M 288,72 L 288,132"
              fill="none"
              stroke="#5b4bff"
              strokeWidth="1.5"
              strokeDasharray="5, 5"
              className="animate-[dash_10s_linear_infinite]"
            />
            <path
              d="M 288,72 L 456,132"
              fill="none"
              stroke="#5b4bff"
              strokeWidth="1.5"
              strokeDasharray="5, 5"
              className="animate-[dash_10s_linear_infinite]"
            />
          </svg>
        </div>
      </motion.div>

      {/* Bounce-to-scroll anchor indicator */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-ink-faint animate-bounce hidden sm:flex flex-col items-center text-[10px] font-mono uppercase tracking-widest cursor-pointer select-none">
        <ArrowDown className="w-4 h-4 text-cosmos-soft mt-1" />
      </div>
    </header>
  );
}
