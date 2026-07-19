export interface TranslationSchema {
  nav: {
    modes: string;
    why: string;
    getStarted: string;
    brandSystem: string;
    github: string;
  };
  hero: {
    eyebrow: string;
    tagline: string;
    sub: string;
    primaryCta: string;
    secondaryCta: string;
    metaRow: string;
  };
  modes: {
    title: string;
    lead: string;
    packTitle: string;
    packDesc: string;
    searchTitle: string;
    searchDesc: string;
    observeTitle: string;
    observeDesc: string;
    visualizerLabel: string;
    indexLabel: string;
  };
  why: {
    title: string;
    lead: string;
    points: {
      p1Title: string;
      p1Desc: string;
      p2Title: string;
      p2Desc: string;
      p3Title: string;
      p3Desc: string;
      p4Title: string;
      p4Desc: string;
    };
  };
  getStarted: {
    title: string;
    lead: string;
    comments: {
      c1: string;
      c2: string;
      c3: string;
      c4: string;
      c5: string;
    };
    copySuccess: string;
    copyBtn: string;
  };
  languages: {
    title: string;
    lead: string;
    caption: string;
  };
  brandExplorer: {
    tabTitle: string;
    tagline: string;
    p1: string;
    colors: string;
    typography: string;
    components: string;
    principles: string;
  };
  footer: {
    tagline: string;
    links: {
      github: string;
      architecture: string;
      cli: string;
      license: string;
    };
  };
}

export const translations: Record<'en' | 'zh', TranslationSchema> = {
  en: {
    nav: {
      modes: "Modes",
      why: "Why codingverse",
      getStarted: "Get Started",
      brandSystem: "Brand System",
      github: "GitHub"
    },
    hero: {
      eyebrow: "Unified Code RAG toolkit",
      tagline: "Index once. Three ways out.",
      sub: "Turn a repository into a single local index — then pack it for an LLM, search it with a real call graph, or observe it on a live dashboard. No embeddings. No services. No keys.",
      primaryCta: "Get started",
      secondaryCta: "View on GitHub",
      metaRow: "100% local · 6 languages · MIT"
    },
    modes: {
      title: "One index. Three outputs.",
      lead: "Every repository becomes a single SQLite index of symbols, call edges, and chunks. From that one index, three complementary modes.",
      packTitle: "Pack",
      packDesc: "Assemble a token-budgeted, layered context file for an LLM. Important symbols stay full; the rest degrade to skeleton, outline, or omit — never blindly truncated.",
      searchTitle: "Search",
      searchDesc: "Hybrid retrieval: BM25 lexical matching fused with a real call graph, so results carry callers and callees — not just text hits.",
      observeTitle: "Observe",
      observeDesc: "A six-board dashboard to see what the index actually holds — token map, code graph, retrieval inspector, and live pack preview.",
      visualizerLabel: "Interactive Sandbox Output Preview",
      indexLabel: "Repository Index (SQLite)"
    },
    why: {
      title: "Context, not the whole repo.",
      lead: "Feeding a whole repo to an LLM wastes tokens. Hand-picking files loses context. codingverse extracts exactly the slice you need.",
      points: {
        p1Title: "Token budget, respected",
        p1Desc: "Pack the most important code at full fidelity and compress the rest to skeletons, ranked by PageRank over the call graph.",
        p2Title: "Scoped by change or query",
        p2Desc: "Pack only what changed plus its impact radius, or only what a query matches plus its call-graph neighborhood.",
        p3Title: "A real call graph",
        p3Desc: "Retrieval walks resolved caller/callee edges, so a match brings its structural neighbors with it.",
        p4Title: "Entirely local",
        p4Desc: "A SQLite index built from tree-sitter parses. No embeddings, no external services, no API keys."
      }
    },
    getStarted: {
      title: "Get started in five commands.",
      lead: "Build from source (Node ≥ 20, pnpm), then index and go.",
      comments: {
        c1: "build the index for a repo",
        c2: "rank symbols by importance",
        c3: "pack a 32k-token context file",
        c4: "or search with the call graph",
        c5: "or open the dashboard"
      },
      copySuccess: "Copied!",
      copyBtn: "Copy instructions"
    },
    languages: {
      title: "Six languages, one convention.",
      lead: "Adding a language is one tree-sitter query plus one registry entry.",
      caption: "All native structures, call graph resolutions, and syntax elements are mapped uniformly."
    },
    brandExplorer: {
      tabTitle: "Brand Guidelines & Visual System",
      tagline: "The codingverse visual framework: Monolith.",
      p1: "A reusable system designed to feel grand, spacious, precise, and editorial. Crafted using a dark void background, warm ivory typography, and a single precise cosmic purple accent.",
      colors: "Color Tokens",
      typography: "Typography Scale",
      components: "Component Library",
      principles: "Brand Principles"
    },
    footer: {
      tagline: "Index once. Three ways out.",
      links: {
        github: "GitHub",
        architecture: "Architecture Docs",
        cli: "CLI Reference",
        license: "MIT License"
      }
    }
  },
  zh: {
    nav: {
      modes: "三种模式",
      why: "核心优势",
      getStarted: "开始使用",
      brandSystem: "品牌视觉系统",
      github: "GitHub"
    },
    hero: {
      eyebrow: "统一的 Code RAG 工具箱",
      tagline: "一次索引,三种出口。",
      sub: "把一个代码仓库变成单一的本地索引 —— 再为 LLM 打包、用真实调用图检索,或在实时 Dashboard 上观测。无向量嵌入,无外部服务,无 API key。",
      primaryCta: "开始使用",
      secondaryCta: "在 GitHub 查看",
      metaRow: "100% 本地 · 6 种语言 · MIT"
    },
    modes: {
      title: "一次索引,三种出口。",
      lead: "每个仓库都成为单一的 SQLite 索引 —— 符号、调用边、代码块。从这一份索引,派生三种互补的模式。",
      packTitle: "打包 Pack",
      packDesc: "为 LLM 组装按 token 预算裁剪的分层上下文文件。重要符号保持完整,其余降级为骨架、大纲或省略 —— 绝不盲目截断。",
      searchTitle: "检索 Search",
      searchDesc: "混合检索:BM25 词法匹配与真实调用图融合,结果带上调用者与被调用者 —— 而不只是文本命中。",
      observeTitle: "观测 Observe",
      observeDesc: "六面板 Dashboard,直观查看索引里到底有什么 —— Token 地图、代码图、检索检查器、实时打包预览。",
      visualizerLabel: "交互式沙盒输出预览",
      indexLabel: "代码仓库索引 (SQLite)"
    },
    why: {
      title: "要上下文,不要整个仓库。",
      lead: "把整个仓库喂给 LLM 浪费 token,手工挑文件又丢上下文。codingverse 精确取出你所需的那一片。",
      points: {
        p1Title: "尊重 token 预算",
        p1Desc: "把最重要的代码以完整保真度打包,其余压缩成骨架,按调用图上的 PageRank 排序。",
        p2Title: "按变更或查询聚焦",
        p2Desc: "只打包变更内容及其影响半径,或只打包查询命中及其调用图邻域。",
        p3Title: "真实的调用图",
        p3Desc: "检索沿已解析的调用者/被调用者边行走,一次命中会带上它的结构近邻。",
        p4Title: "完全本地",
        p4Desc: "由 tree-sitter 解析构建的 SQLite 索引。无嵌入向量,无外部服务,无 API key。"
      }
    },
    getStarted: {
      title: "五条命令即可上手。",
      lead: "从源码构建(Node ≥ 20、pnpm),然后建索引即用。",
      comments: {
        c1: "为仓库建索引",
        c2: "按重要性给符号排序",
        c3: "打包 32k token 的上下文文件",
        c4: "或用调用图检索",
        c5: "或打开 Dashboard"
      },
      copySuccess: "已复制!",
      copyBtn: "复制命令"
    },
    languages: {
      title: "六种语言,一套约定。",
      lead: "新增一门语言只需一个 tree-sitter 查询加一条注册项。",
      caption: "所有的原生结构、调用图解析和语法元素均被统一映射。"
    },
    brandExplorer: {
      tabTitle: "品牌指南 & 视觉系统",
      tagline: "codingverse 视觉框架: Monolith。",
      p1: "一个旨在营造宏大、空灵、精准和社论感的复用系统。采用接近黑色的深邃背景、温暖的象牙白排版，以及一道精准的宇宙紫强调色。",
      colors: "色彩令牌 Token",
      typography: "字体排版比例",
      components: "复用组件库",
      principles: "品牌基本原则"
    },
    footer: {
      tagline: "一次索引,三种出口。",
      links: {
        github: "GitHub 仓库",
        architecture: "架构设计文档",
        cli: "CLI 命令行参考",
        license: "MIT 许可证"
      }
    }
  }
};
