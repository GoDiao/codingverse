import { useState } from "react";
import { Menu, X, Globe, Github } from "lucide-react";
import { TranslationSchema } from "../translations";

interface NavbarProps {
  currentLang: "en" | "zh";
  toggleLang: () => void;
  t: TranslationSchema;
}

export default function Navbar({ currentLang, toggleLang, t }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { label: t.nav.modes, href: "#modes-section" },
    { label: t.nav.why, href: "#why-section" },
    { label: t.nav.getStarted, href: "#terminal-demo-section" },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-void/85 backdrop-blur-md edge-bottom transition-all duration-300">
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        {/* Brand Co-branding Lockup */}
        <a href="#" className="flex items-center space-x-3 group">
          {/* Brand Logo SVG */}
          <div className="panel panel-hover w-8 h-8 rounded-lg flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 10L14 16V32L24 38L34 32V16L24 10Z" fill="#0a0a0c" stroke="#5b4bff" strokeWidth="3"/>
              <circle cx="24" cy="24" r="4.5" fill="#8b7dff" stroke="#0a0a0c" strokeWidth="2"/>
            </svg>
          </div>
          <span className="font-display text-xl font-medium tracking-tight text-ink group-hover:text-cosmos-soft transition-colors select-none">
            codingverse
          </span>
        </a>

        {/* Desktop Navigation Link Menu */}
        <div className="hidden md:flex items-center space-x-8 font-sans text-xs uppercase tracking-wider font-semibold">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-ink-dim hover:text-ink transition-colors relative group py-2"
            >
              {link.label}
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-cosmos transition-all group-hover:w-full" />
            </a>
          ))}
        </div>

        {/* Action Controls & Toggle */}
        <div className="hidden md:flex items-center space-x-4">
          {/* Bilingual Toggle button */}
          <button
            onClick={toggleLang}
            className="flex items-center space-x-1.5 px-3 py-1.5 ghost rounded-full text-[11px] font-mono transition-all text-ink cursor-pointer"
            title={t.nav.switchLang}
          >
            <Globe className="w-3.5 h-3.5 text-cosmos-soft" />
            <span>{currentLang === "en" ? "中文" : "English"}</span>
          </button>

          {/* External GitHub Link */}
          <a
            href="https://github.com/GoDiao/codingverse"
            target="_blank"
            rel="noreferrer"
            className="flex items-center space-x-1.5 px-4 py-2 ghost rounded-full text-xs font-mono tracking-wide uppercase transition-all text-ink cursor-pointer"
          >
            <Github className="w-3.5 h-3.5" />
            <span>{t.nav.star}</span>
          </a>
        </div>

        {/* Mobile menu trigger button */}
        <div className="flex items-center space-x-2 md:hidden">
          <button
            onClick={toggleLang}
            className="pill p-2 rounded-lg text-xs font-mono text-ink cursor-pointer"
          >
            {currentLang === "en" ? "中" : "EN"}
          </button>
          
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="pill p-2 rounded-lg text-ink hover:text-cosmos-soft transition-colors cursor-pointer"
            aria-label="Toggle Mobile Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-void-2/95 backdrop-blur-md edge-bottom animate-fade-in">
          <div className="px-6 py-4 flex flex-col space-y-4 font-sans text-sm uppercase tracking-wider font-semibold">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-ink-dim hover:text-ink transition-colors py-2 edge-bottom"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-2 flex items-center justify-between">
              <button
                onClick={() => {
                  toggleLang();
                  setMobileMenuOpen(false);
                }}
                className="flex items-center space-x-1.5 text-xs text-ink-dim hover:text-ink cursor-pointer"
              >
                <Globe className="w-4 h-4 text-cosmos-soft" />
                <span>{currentLang === "en" ? "Switch to 中文" : "切换为 English"}</span>
              </button>
              
              <a
                href="https://github.com/GoDiao/codingverse"
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-1.5 text-xs text-ink-dim hover:text-ink"
              >
                <Github className="w-4 h-4" />
                <span>{t.nav.github}</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
