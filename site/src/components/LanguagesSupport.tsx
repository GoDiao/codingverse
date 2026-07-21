import { useState } from "react";
import { Code, Terminal, ExternalLink } from "lucide-react";
import { TranslationSchema } from "../translations";
import { astQueries } from "../data/realData";

interface LanguagesSupportProps {
  t: TranslationSchema;
}

export default function LanguagesSupport({ t }: LanguagesSupportProps) {
  const [selectedLang, setSelectedLang] = useState<string>("TypeScript");

  // File extensions per grammar (from core/parse/languages/registry.ts).
  const languages = [
    { name: "TypeScript", ext: ".ts / .tsx / .mts / .cts" },
    { name: "JavaScript", ext: ".js / .jsx / .mjs / .cjs" },
    { name: "Python", ext: ".py" },
    { name: "Go", ext: ".go" },
    { name: "Rust", ext: ".rs" },
    { name: "Java", ext: ".java" },
  ];

  // Real tree-sitter tag queries, dogfooded from the codingverse source.
  const currentQuery = astQueries[selectedLang as keyof typeof astQueries] || "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
      {/* List on the left */}
      <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
        <div className="space-y-4">
          <div className="inline-flex items-center space-x-2 text-xs font-mono tracking-widest uppercase text-cosmos-soft">
            <Code className="w-4 h-4" />
            <span>{t.languages.eyebrow}</span>
          </div>
          <h3 className="font-display text-2xl lg:text-3xl text-ink tracking-tight font-semibold">
            {t.languages.title}
          </h3>
          <p className="text-ink-dim text-sm leading-relaxed font-sans max-w-md">
            {t.languages.lead}
          </p>
          <p className="text-ink-faint text-xs leading-relaxed font-sans max-w-sm italic">
            {t.languages.caption}
          </p>
        </div>

        {/* List Grid */}
        <div className="grid grid-cols-2 gap-2">
          {languages.map((lang) => {
            const isSelected = selectedLang === lang.name;
            return (
              <button
                key={lang.name}
                onClick={() => setSelectedLang(lang.name)}
                className={`text-left p-4 rounded-2xl font-mono transition-all flex flex-col justify-between cursor-pointer ${
                  isSelected
                    ? "text-ink bg-cosmos/[0.06] shadow-[inset_0_0_0_1px_rgba(139,125,255,0.45),0_18px_40px_-30px_rgba(91,75,255,0.5)]"
                    : "panel panel-hover text-ink-dim hover:text-ink"
                }`}
              >
                <span className="text-sm font-bold">{lang.name}</span>
                <span className="text-[10px] text-ink-faint mt-1">{lang.ext}</span>
              </button>
            );
          })}
        </div>

        <div className="pt-2">
          <a
            href="https://github.com/GoDiao/codingverse"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center space-x-1 text-xs text-cosmos-soft hover:text-ink transition-colors font-semibold font-mono"
          >
            <span>{t.languages.registerLink}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Query Preview on the right */}
      <div className="lg:col-span-7 flex flex-col">
        <div className="screen p-5 flex flex-col justify-between flex-1 relative overflow-hidden min-h-[300px]">
          <div className="absolute top-0 right-0 h-16 w-16 bg-gradient-to-bl from-cosmos/10 via-transparent to-transparent pointer-events-none" />

          <div className="space-y-4">
            <div className="flex items-center justify-between edge-bottom pb-3">
              <span className="text-xs font-mono text-ink-dim flex items-center space-x-1.5">
                <Terminal className="w-4 h-4 text-cosmos-soft" />
                <span>queries/{selectedLang.toLowerCase()}.scm</span>
              </span>
              <span className="text-[10px] panel px-2 py-0.5 text-ink-faint font-mono">
                {t.languages.queryBadge}
              </span>
            </div>

            {/* AST Query block */}
            <pre className="text-[10px] sm:text-xs font-mono text-[#dfded9] leading-relaxed whitespace-pre overflow-x-auto max-h-[220px]">
              {currentQuery}
            </pre>
          </div>

          <div className="pt-3 edge-top text-[10px] font-mono text-ink-faint">
            {t.languages.extractionNote}
          </div>
        </div>
      </div>
    </div>
  );
}
