import { useState, useEffect } from "react";
import { translations } from "./translations";

// Components
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import ModesSection from "./components/ModesSection";
import WhySection from "./components/WhySection";
import TerminalDemo from "./components/TerminalDemo";
import LanguagesSupport from "./components/LanguagesSupport";
import Footer from "./components/Footer";
import StarfieldBackground from "./components/StarfieldBackground";

export default function App() {
  // Bilingual state - defaults to browser setting or localStorage, persists preferences
  const [currentLang, setCurrentLang] = useState<"en" | "zh">(() => {
    const saved = localStorage.getItem("codingverse-lang");
    if (saved === "en" || saved === "zh") return saved;
    
    // Fallback to browser preference
    const browserLang = typeof navigator !== "undefined" ? navigator.language : "en";
    if (browserLang.toLowerCase().startsWith("zh")) {
      return "zh";
    }
    return "en";
  });

  const toggleLang = () => {
    setCurrentLang((prev) => (prev === "en" ? "zh" : "en"));
  };

  // Sync document lang attribute with active state
  useEffect(() => {
    document.documentElement.lang = currentLang;
    localStorage.setItem("codingverse-lang", currentLang);
  }, [currentLang]);

  // Retrieve translation dictionary
  const t = translations[currentLang];

  return (
    <div className="relative min-h-screen bg-void text-ink font-sans selection:bg-cosmos selection:text-ink overflow-x-hidden">
      {/* 1. Near-infinite starfield depth */}
      <StarfieldBackground />

      {/* 2. Navigation Header (Sticky) */}
      <Navbar currentLang={currentLang} toggleLang={toggleLang} t={t} />

      {/* 3. Hero Introduction */}
      <Hero t={t} />

      {/* Main content grid flow with grand, spacious rhythm (100px - 160px spacing) */}
      <main className="max-w-7xl mx-auto px-6 relative z-10 space-y-24 md:space-y-36 lg:space-y-44 pb-32">
        
        {/* 4. Modes Visualizer Section */}
        <section id="modes-section" className="scroll-mt-24 pt-8">
          <ModesSection t={t} />
        </section>

        {/* 5. Why value props Section */}
        <section id="why-section" className="scroll-mt-24 pt-8">
          <WhySection t={t} />
        </section>

        {/* 6. Command Terminal CLI Demo Section */}
        <section className="pt-8">
          <TerminalDemo t={t} />
        </section>

        {/* 7. Languages AST registries support Section */}
        <section className="pt-8">
          <LanguagesSupport t={t} />
        </section>

      </main>

      {/* 9. Footer Brand Layout */}
      <Footer t={t} />
    </div>
  );
}
