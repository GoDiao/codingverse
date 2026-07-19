/* codingverse landing — bilingual toggle + light interactions */

const I18N = {
  en: {
    "nav.modes": "The three modes",
    "nav.why": "Why",
    "nav.start": "Get started",
    "hero.eyebrow": "Unified Code RAG toolkit",
    "hero.tagline": "Index once. Three ways out.",
    "hero.sub": "Turn a repository into a single local index — then pack it for an LLM, search it with a real call graph, or observe it on a live dashboard. No embeddings. No services. No keys.",
    "hero.ctaStart": "Get started",
    "hero.ctaGithub": "View on GitHub",
    "hero.metaLocal": "100% local",
    "hero.metaLang": "6 languages",
    "modes.title": "One index. Three outputs.",
    "modes.lead": "Every repository becomes a single SQLite index of symbols, call edges, and chunks. From that one index, three complementary modes.",
    "modes.pack.name": "Pack",
    "modes.pack.desc": "Assemble a token-budgeted, layered context file for an LLM. Important symbols stay full; the rest degrade to skeleton, outline, or omit — never blindly truncated.",
    "modes.search.name": "Search",
    "modes.search.desc": "Hybrid retrieval: BM25 lexical matching fused with a real call graph, so results carry callers and callees — not just text hits.",
    "modes.observe.name": "Observe",
    "modes.observe.desc": "A six-board dashboard to see what the index actually holds — token map, code graph, retrieval inspector, and live pack preview.",
    "why.title": "Context, not the whole repo.",
    "why.lead": "Feeding a whole repo to an LLM wastes tokens. Hand-picking files loses context. codingverse extracts exactly the slice you need.",
    "why.budget.t": "Token budget, respected",
    "why.budget.d": "Pack the most important code at full fidelity and compress the rest to skeletons — ranked by PageRank over the call graph.",
    "why.scoped.t": "Scoped by change or query",
    "why.scoped.d": "Pack only what changed plus its impact radius, or only what a query matches plus its call-graph neighborhood.",
    "why.graph.t": "A real call graph",
    "why.graph.d": "Retrieval walks resolved caller/callee edges, so a match brings its structural neighbors with it.",
    "why.local.t": "Entirely local",
    "why.local.d": "A SQLite index built from tree-sitter parses. No embeddings, no external services, no API keys.",
    "start.title": "Get started in five commands.",
    "start.lead": "Build from source (Node ≥ 20, pnpm), then index and go.",
    "demo.c1": "# build the index for a repo",
    "demo.c2": "# rank symbols by importance",
    "demo.c3": "# pack a 32k-token context file",
    "demo.c4": "# or search with the call graph",
    "demo.c5": "# or open the dashboard",
    "langs.title": "Six languages, one convention.",
    "langs.lead": "Adding a language is one tree-sitter query plus one registry entry.",
    "footer.tag": "Index once. Three ways out.",
    "footer.arch": "Architecture",
    "footer.cli": "CLI reference",
  },
  zh: {
    "nav.modes": "三种模式",
    "nav.why": "为什么",
    "nav.start": "开始使用",
    "hero.eyebrow": "统一的 Code RAG 工具箱",
    "hero.tagline": "一次索引,三种出口。",
    "hero.sub": "把一个代码仓库变成单一的本地索引 —— 再为 LLM 打包、用真实调用图检索,或在实时 Dashboard 上观测。无向量嵌入,无外部服务,无 API key。",
    "hero.ctaStart": "开始使用",
    "hero.ctaGithub": "在 GitHub 查看",
    "hero.metaLocal": "100% 本地",
    "hero.metaLang": "6 种语言",
    "modes.title": "一次索引,三种出口。",
    "modes.lead": "每个仓库都成为单一的 SQLite 索引 —— 符号、调用边、代码块。从这一份索引,派生三种互补的模式。",
    "modes.pack.name": "打包 Pack",
    "modes.pack.desc": "为 LLM 组装按 token 预算裁剪的分层上下文文件。重要符号保持完整,其余降级为骨架、大纲或省略 —— 绝不盲目截断。",
    "modes.search.name": "检索 Search",
    "modes.search.desc": "混合检索:BM25 词法匹配与真实调用图融合,结果带上调用者与被调用者 —— 而不只是文本命中。",
    "modes.observe.name": "观测 Observe",
    "modes.observe.desc": "六面板 Dashboard,直观查看索引里到底有什么 —— Token 地图、代码图、检索检查器、实时打包预览。",
    "why.title": "要上下文,不要整个仓库。",
    "why.lead": "把整个仓库喂给 LLM 浪费 token,手工挑文件又丢上下文。codingverse 精确取出你所需的那一片。",
    "why.budget.t": "尊重 token 预算",
    "why.budget.d": "把最重要的代码以完整保真度打包,其余压缩成骨架 —— 按调用图上的 PageRank 排序。",
    "why.scoped.t": "按变更或查询聚焦",
    "why.scoped.d": "只打包变更内容及其影响半径,或只打包查询命中及其调用图邻域。",
    "why.graph.t": "真实的调用图",
    "why.graph.d": "检索沿已解析的调用者/被调用者边行走,一次命中会带上它的结构近邻。",
    "why.local.t": "完全本地",
    "why.local.d": "由 tree-sitter 解析构建的 SQLite 索引。无嵌入向量,无外部服务,无 API key。",
    "start.title": "五条命令即可上手。",
    "start.lead": "从源码构建(Node ≥ 20、pnpm),然后建索引即用。",
    "demo.c1": "# 为仓库建索引",
    "demo.c2": "# 按重要性给符号排序",
    "demo.c3": "# 打包 32k token 的上下文文件",
    "demo.c4": "# 或用调用图检索",
    "demo.c5": "# 或打开 Dashboard",
    "langs.title": "六种语言,一套约定。",
    "langs.lead": "新增一门语言只需一个 tree-sitter 查询加一条注册项。",
    "footer.tag": "一次索引,三种出口。",
    "footer.arch": "架构文档",
    "footer.cli": "CLI 参考",
  },
};

const STORAGE_KEY = "cv-lang";

function applyLang(lang) {
  const dict = I18N[lang] || I18N.en;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] !== undefined) el.textContent = dict[key];
  });
  const toggle = document.getElementById("lang-toggle");
  if (toggle) toggle.textContent = lang === "zh" ? "EN" : "中文";
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
}

function initLang() {
  let lang = "en";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) lang = saved;
    else if (navigator.language && navigator.language.toLowerCase().startsWith("zh")) lang = "zh";
  } catch (_) {}
  applyLang(lang);

  const toggle = document.getElementById("lang-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const current = document.documentElement.lang.startsWith("zh") ? "zh" : "en";
      applyLang(current === "zh" ? "en" : "zh");
    });
  }
}

// Reveal sections on scroll — restrained fade/rise.
function initReveal() {
  const els = document.querySelectorAll("section, .footer");
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in-view");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 }
  );
  els.forEach((el) => {
    el.classList.add("reveal");
    io.observe(el);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initLang();
  initReveal();
});
