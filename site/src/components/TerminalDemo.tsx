import { useState } from "react";
import { Play, Check, Copy } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { TranslationSchema } from "../translations";
import { terminal, searches } from "../data/realData";

interface TerminalDemoProps {
  t: TranslationSchema;
}

export default function TerminalDemo({ t }: TerminalDemoProps) {
  const [activeCommand, setActiveCommand] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  const commands = [
    { id: 0, code: "cv index .", comment: t.getStarted.comments.c1, output: terminal.index },
    { id: 1, code: "cv rank .", comment: t.getStarted.comments.c2, output: terminal.rank },
    { id: 2, code: "cv pack . --budget 32000 -o context.xml", comment: t.getStarted.comments.c3, output: terminal.pack },
    { id: 3, code: `cv search "${searches[0].query}" .`, comment: t.getStarted.comments.c4, output: terminal.search },
    { id: 4, code: "cv serve .", comment: t.getStarted.comments.c5, output: terminal.serve },
  ];

  const fullCommandString = commands
    .map((c) => `# ${c.comment}\n${c.code}`)
    .join("\n\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(fullCommandString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="terminal-demo-section" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
      {/* List of commands on the left */}
      <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
        <div className="space-y-3">
          <h3 className="font-display text-2xl lg:text-3xl text-ink tracking-tight">
            {t.getStarted.title}
          </h3>
          <p className="text-ink-dim text-sm max-w-md leading-relaxed font-sans">
            {t.getStarted.lead}
          </p>
        </div>

        <div className="space-y-2 pt-4">
          {commands.map((cmd, idx) => {
            const isActive = activeCommand === idx;
            return (
              <button
                key={cmd.id}
                onClick={() => setActiveCommand(idx)}
                className={`w-full text-left p-4 rounded-2xl transition-all duration-300 group flex items-start justify-between cursor-pointer ${
                  isActive
                    ? "text-ink shadow-[inset_0_0_0_1px_rgba(139,125,255,0.4),0_20px_44px_-30px_rgba(91,75,255,0.55)] bg-cosmos/[0.06]"
                    : "panel panel-hover text-ink-dim"
                }`}
              >
                <div className="space-y-1 font-mono text-xs w-full pr-4">
                  <div className="text-ink-faint group-hover:text-ink-dim transition-colors">
                    # {cmd.comment}
                  </div>
                  <div className="text-sm font-semibold tracking-tight text-ink flex items-center">
                    <span className="text-cosmos mr-2">&gt;</span>
                    {cmd.code}
                  </div>
                </div>
                <div
                  className={`flex-shrink-0 p-1.5 rounded-full transition-all duration-300 ${
                    isActive
                      ? "bg-cosmos text-ink"
                      : "bg-void-3 text-ink-faint group-hover:text-ink-dim"
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="pt-4">
          <button
            onClick={handleCopy}
            className="panel panel-hover w-full flex items-center justify-center space-x-2 py-3 px-4 text-xs font-mono tracking-wide uppercase transition-all text-ink cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">{t.getStarted.copySuccess}</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>{t.getStarted.copyBtn}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Output screen on the right */}
      <div className="lg:col-span-7 flex flex-col">
        <div className="screen flex-1 flex flex-col overflow-hidden relative">
          {/* Terminal Title Bar */}
          <div className="px-5 py-3.5 edge-bottom flex items-center justify-between bg-[#0b0b0f]/60">
            <div className="flex items-center space-x-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            </div>
            <div className="text-[11px] font-mono tracking-wider text-ink-dim uppercase">
              session: cv-engine-sqlite
            </div>
            <div className="w-8" />
          </div>

          {/* Terminal Console Output */}
          <div className="flex-1 p-6 font-mono text-xs overflow-auto leading-relaxed text-[#dfded9] select-none min-h-[360px] max-h-[480px]">
            <div className="text-ink-faint mb-2"># Selected Command execution simulator</div>
            <div className="text-cosmos-soft text-sm font-semibold mb-4 flex items-center">
              <span>$</span>
              <span className="ml-2 text-ink">{commands[activeCommand].code}</span>
              <span className="ml-1 w-2 h-4 bg-cosmos animate-pulse" />
            </div>

            <AnimatePresence mode="wait">
              <motion.pre
                key={activeCommand}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="whitespace-pre-wrap leading-relaxed overflow-x-auto"
              >
                {commands[activeCommand].output}
              </motion.pre>
            </AnimatePresence>
          </div>

          {/* Terminal Bottom Hint */}
          <div className="bg-void-2/60 edge-top px-5 py-2.5 text-[10px] font-mono text-ink-faint flex justify-between">
            <span>SQLite Local Context DB: .codingverse/index.db</span>
            <span>ANSI UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
}
