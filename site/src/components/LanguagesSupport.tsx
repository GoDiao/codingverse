import { useState } from "react";
import { Code, Terminal, ExternalLink } from "lucide-react";
import { TranslationSchema } from "../translations";

interface LanguagesSupportProps {
  t: TranslationSchema;
}

export default function LanguagesSupport({ t }: LanguagesSupportProps) {
  const [selectedLang, setSelectedLang] = useState<string>("TypeScript");

  const languages = [
    {
      name: "TypeScript",
      ext: ".ts / .tsx",
      query: `((method_definition
  name: (property_identifier) @method.name) @method)

((function_declaration
  name: (identifier) @function.name) @function)

((call_expression
  function: [
    (identifier) @call.identifier
    (member_expression property: (property_identifier) @call.member)
  ]) @call)`,
    },
    {
      name: "JavaScript",
      ext: ".js / .jsx",
      query: `((method_definition
  name: (property_identifier) @method.name) @method)

((class_declaration
  name: (identifier) @class.name) @class)

((call_expression
  function: (identifier) @call.identifier) @call)`,
    },
    {
      name: "Python",
      ext: ".py",
      query: `((function_definition
  name: (identifier) @function.name) @function)

((class_definition
  name: (identifier) @class.name) @class)

((call
  function: (identifier) @call.identifier) @call)`,
    },
    {
      name: "Go",
      ext: ".go",
      query: `((function_declaration
  name: (identifier) @function.name) @function)

((method_declaration
  name: (field_identifier) @method.name) @method)

((call_expression
  function: (identifier) @call.identifier) @call)`,
    },
    {
      name: "Rust",
      ext: ".rs",
      query: `((function_item
  name: (identifier) @function.name) @function)

((impl_item) @impl)

((call_expression
  function: (identifier) @call.identifier) @call)`,
    },
    {
      name: "Java",
      ext: ".java",
      query: `((method_declaration
  name: (identifier) @method.name) @method)

((class_declaration
  name: (identifier) @class.name) @class)

((method_invocation
  name: (identifier) @call.identifier) @call)`,
    },
  ];

  const currentQuery = languages.find((l) => l.name === selectedLang)?.query || "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
      {/* List on the left */}
      <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
        <div className="space-y-4">
          <div className="inline-flex items-center space-x-2 text-xs font-mono tracking-widest uppercase text-cosmos-soft">
            <Code className="w-4 h-4" />
            <span>{t.languages.eyebrow}</span>
          </div>
          <h3 className="font-serif text-2xl lg:text-3xl text-ink tracking-tight font-semibold">
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
                className={`text-left p-4 rounded-xl border font-mono transition-all flex flex-col justify-between cursor-pointer ${
                  isSelected
                    ? "bg-void-2 border-cosmos/55 text-ink shadow-lg"
                    : "bg-transparent border-line text-ink-dim hover:text-ink hover:border-ink-faint hover:bg-void-2/10"
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
        <div className="bg-[#050507] border border-line rounded-2xl p-5 flex flex-col justify-between flex-1 relative shadow-2xl overflow-hidden min-h-[300px]">
          <div className="absolute top-0 right-0 h-16 w-16 bg-gradient-to-bl from-cosmos/10 via-transparent to-transparent pointer-events-none" />
          
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <span className="text-xs font-mono text-ink-dim flex items-center space-x-1.5">
                <Terminal className="w-4 h-4 text-cosmos-soft" />
                <span>queries/{selectedLang.toLowerCase()}.scm</span>
              </span>
              <span className="text-[10px] bg-void-3 border border-line px-2 py-0.5 rounded text-ink-faint font-mono">
                {t.languages.queryBadge}
              </span>
            </div>

            {/* AST Query block */}
            <pre className="text-[10px] sm:text-xs font-mono text-[#dfded9] leading-relaxed whitespace-pre overflow-x-auto max-h-[220px]">
              {currentQuery}
            </pre>
          </div>

          <div className="pt-3 border-t border-line/50 text-[10px] font-mono text-ink-faint">
            {t.languages.extractionNote}
          </div>
        </div>
      </div>
    </div>
  );
}
