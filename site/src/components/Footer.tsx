import { Heart, Github, BookOpen, Terminal, Shield } from "lucide-react";
import { TranslationSchema } from "../translations";

interface FooterProps {
  t: TranslationSchema;
}

export default function Footer({ t }: FooterProps) {
  return (
    <footer className="edge-top bg-gradient-to-b from-void-2/40 to-transparent pt-16 pb-12 px-6">
      <div className="max-w-7xl mx-auto space-y-12">
        {/* Brand Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Logo & Tagline */}
          <div className="md:col-span-5 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg panel flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24 10L14 16V32L24 38L34 32V16L24 10Z" fill="#0a0a0c" stroke="#5b4bff" strokeWidth="3"/>
                  <circle cx="24" cy="24" r="4.5" fill="#8b7dff" stroke="#0a0a0c" strokeWidth="2"/>
                </svg>
              </div>
              <span className="font-serif text-2xl font-medium tracking-tight text-ink select-none">
                codingverse
              </span>
            </div>
            <p className="font-serif text-lg text-ink-dim italic">
              {t.footer.tagline}
            </p>
          </div>

          {/* Spacer */}
          <div className="hidden md:block md:col-span-1" />

          {/* Links columns */}
          <div className="md:col-span-6 grid grid-cols-2 sm:grid-cols-3 gap-6 font-mono text-xs uppercase tracking-wider font-semibold">
            <div className="space-y-3">
              <span className="text-[10px] text-ink-faint">{t.footer.openSource}</span>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://github.com/GoDiao/codingverse"
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-dim hover:text-ink transition-colors flex items-center space-x-1"
                  >
                    <Github className="w-3.5 h-3.5 mr-1" />
                    <span>{t.footer.links.github}</span>
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/GoDiao/codingverse/blob/master/LICENSE"
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-dim hover:text-ink transition-colors flex items-center space-x-1"
                  >
                    <Shield className="w-3.5 h-3.5 mr-1" />
                    <span>{t.footer.links.license}</span>
                  </a>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <span className="text-[10px] text-ink-faint">{t.footer.documentation}</span>
              <ul className="space-y-2 font-semibold">
                <li>
                  <a
                    href="https://github.com/GoDiao/codingverse/blob/master/docs/architecture.md"
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-dim hover:text-ink transition-colors flex items-center space-x-1"
                  >
                    <BookOpen className="w-3.5 h-3.5 mr-1" />
                    <span>{t.footer.links.architecture}</span>
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/GoDiao/codingverse/blob/master/docs/cli-reference.md"
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-dim hover:text-ink transition-colors flex items-center space-x-1"
                  >
                    <Terminal className="w-3.5 h-3.5 mr-1" />
                    <span>{t.footer.links.cli}</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom copyright & credits bar */}
        <div className="pt-8 edge-top flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] font-mono text-ink-faint">
          <div>{t.footer.copyright}</div>
          <div className="flex items-center space-x-1">
            <span>{t.footer.craftedWith}</span>
            <Heart className="w-3 h-3 text-cosmos fill-current" />
            <span>{t.footer.craftedPlace}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
