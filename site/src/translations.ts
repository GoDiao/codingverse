export interface TranslationSchema {
  nav: {
    modes: string;
    why: string;
    getStarted: string;
    github: string;
    switchLang: string;
    star: string;
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
    playground: string;
    tokenBudget: string;
    budgetAggressive: string;
    budgetBalanced: string;
    budgetMax: string;
    originalCodebase: string;
    outputContext: string;
    localEngine: string;
    chooseKeyword: string;
    graphTraversal: string;
    graphTraversalDesc: string;
    neighborhoodLayout: string;
    selectBoard: string;
    boardTokenMap: string;
    boardCodeGraph: string;
    boardRetrieval: string;
    boardPack: string;
    tokenMapCaption: string;
    lowWeight: string;
    highWeight: string;
    codeGraphCaption: string;
    retrievalCaption: string;
    packCaption: string;
    highPriority: string;
    auxiliary: string;
    contextNeighborhood: string;
    boardPackHint: string;
    keptFull: string;
    compressed: string;
  };
  why: {
    eyebrow: string;
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
    v1Label: string;
    v2Label: string;
    v3Label: string;
    v4Label: string;
  };
  getStarted: {
    title: string;
    lead: string;
    walkthrough: string;
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
    eyebrow: string;
    title: string;
    lead: string;
    caption: string;
    registerLink: string;
    queryBadge: string;
    extractionNote: string;
  };
  footer: {
    tagline: string;
    openSource: string;
    documentation: string;
    craftedWith: string;
    craftedPlace: string;
    copyright: string;
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
      github: "GitHub",
      switchLang: "Switch Language",
      star: "Star"
    },
    hero: {
      eyebrow: "Unified Code RAG toolkit",
      tagline: "Index once. Three ways out.",
      sub: "Turn a repository into a single local index. Then pack it for an LLM, search it with a real call graph, or observe it on a live dashboard. No embeddings. No services. No keys.",
      primaryCta: "Get started",
      secondaryCta: "View on GitHub",
      metaRow: "100% local · 6 languages · MIT"
    },
    modes: {
      title: "One index. Three outputs.",
      lead: "Every repository becomes a single SQLite index of symbols, call edges, and chunks. From that one index, three complementary modes.",
      packTitle: "Pack",
      packDesc: "Assemble a token-budgeted, layered context file for an LLM. Important symbols stay full; the rest degrade to skeleton, outline, or omit. Never blindly truncated.",
      searchTitle: "Search",
      searchDesc: "Hybrid retrieval: BM25 lexical matching fused with a real call graph, so results carry callers and callees, not just text hits.",
      observeTitle: "Observe",
      observeDesc: "A six-board dashboard to see what the index actually holds: token map, code graph, retrieval inspector, and live pack preview.",
      visualizerLabel: "Interactive Sandbox Output Preview",
      indexLabel: "Repository Index (SQLite)",
      playground: "Interactive Playground",
      tokenBudget: "LLM Token Budget",
      budgetAggressive: "10k (Aggressive)",
      budgetBalanced: "32k (Balanced)",
      budgetMax: "128k (Max)",
      originalCodebase: "Original codebase:",
      outputContext: "Output context:",
      localEngine: "Local SQLite engine · no network",
      chooseKeyword: "Choose a semantic keyword:",
      graphTraversal: "Call Graph Traversal:",
      graphTraversalDesc: "BM25 lexical index finds direct code hits, then walks parent/child branches, carrying real execution context nodes.",
      neighborhoodLayout: "Retrieved Context Neighborhood XML Layout",
      selectBoard: "Select a board to inspect:",
      boardTokenMap: "Token map (treemap)",
      boardCodeGraph: "Code graph (call graph)",
      boardRetrieval: "Retrieval inspector",
      boardPack: "Pack preview",
      tokenMapCaption: "Token map (repository token treemap)",
      lowWeight: "Low Token Weight",
      highWeight: "High Token Weight",
      codeGraphCaption: "Code graph (D3 force-directed call graph)",
      retrievalCaption: "Retrieval inspector (query analysis log output)",
      packCaption: "Pack preview (fidelity weights layout)",
      highPriority: "High Priority",
      auxiliary: "Auxiliary / Compressible",
      contextNeighborhood: "Retrieved context neighborhood",
      boardPackHint: "Live pack configurator (real layer assignment)",
      keptFull: "Kept full",
      compressed: "Compressed"
    },
    why: {
      eyebrow: "Technical Architecture",
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
      },
      v1Label: "Fidelity Compression",
      v2Label: "Impact Radius Scope",
      v3Label: "Resolved Call Graph Walk",
      v4Label: "Local SQLite File Database"
    },
    getStarted: {
      title: "Get started in five commands.",
      lead: "Build from source (Node ≥ 20, pnpm), then index and go.",
      walkthrough: "Interactive CLI Walkthrough",
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
      eyebrow: "AST Language Registries",
      title: "Six languages, one convention.",
      lead: "Adding a language is one tree-sitter query plus one registry entry.",
      caption: "All native structures, call graph resolutions, and syntax elements are mapped uniformly.",
      registerLink: "Learn how to register custom languages",
      queryBadge: "Tree-sitter tags query",
      extractionNote: "Symbol extraction walks pattern trees matched by queries."
    },
    footer: {
      tagline: "Index once. Three ways out.",
      openSource: "Open Source",
      documentation: "Documentation",
      craftedWith: "Crafted with",
      craftedPlace: "in Monolith Void",
      copyright: "© 2026 godiao · Released under the MIT License",
      links: {
        github: "GitHub",
        architecture: "Architecture",
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
      github: "GitHub",
      switchLang: "切换语言",
      star: "Star"
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
      indexLabel: "代码仓库索引 (SQLite)",
      playground: "交互式演练场",
      tokenBudget: "LLM Token 预算",
      budgetAggressive: "10k(激进)",
      budgetBalanced: "32k(均衡)",
      budgetMax: "128k(上限)",
      originalCodebase: "原始代码库:",
      outputContext: "输出上下文:",
      localEngine: "本地 SQLite 引擎 · 无网络",
      chooseKeyword: "选择一个语义关键词:",
      graphTraversal: "调用图遍历:",
      graphTraversalDesc: "BM25 词法索引先找到直接代码命中,再沿父/子分支行走,带上真实的执行上下文节点。",
      neighborhoodLayout: "检索到的上下文邻域 XML 布局",
      selectBoard: "选择要查看的面板:",
      boardTokenMap: "Token 地图(树状图)",
      boardCodeGraph: "代码图(调用图)",
      boardRetrieval: "检索检查器",
      boardPack: "打包预览",
      tokenMapCaption: "Token 地图(仓库 token 树状图)",
      lowWeight: "低 Token 权重",
      highWeight: "高 Token 权重",
      codeGraphCaption: "代码图(D3 力导向调用图)",
      retrievalCaption: "检索检查器(查询分析日志输出)",
      packCaption: "打包预览(保真度权重布局)",
      highPriority: "高优先级",
      auxiliary: "辅助 / 可压缩",
      contextNeighborhood: "检索出的上下文邻域",
      boardPackHint: "实时打包配置器(真实层级分配)",
      keptFull: "完整保留",
      compressed: "压缩降级"
    },
    why: {
      eyebrow: "技术架构",
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
      },
      v1Label: "保真度压缩",
      v2Label: "影响半径范围",
      v3Label: "已解析调用图行走",
      v4Label: "本地 SQLite 文件数据库"
    },
    getStarted: {
      title: "五条命令即可上手。",
      lead: "从源码构建(Node ≥ 20、pnpm),然后建索引即用。",
      walkthrough: "交互式 CLI 演练",
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
      eyebrow: "AST 语言注册表",
      title: "六种语言,一套约定。",
      lead: "新增一门语言只需一个 tree-sitter 查询加一条注册项。",
      caption: "所有的原生结构、调用图解析和语法元素均被统一映射。",
      registerLink: "了解如何注册自定义语言",
      queryBadge: "Tree-sitter tags 查询",
      extractionNote: "符号抽取沿查询匹配的模式树行走。"
    },
    footer: {
      tagline: "一次索引,三种出口。",
      openSource: "开源",
      documentation: "文档",
      craftedWith: "用",
      craftedPlace: "打造于 Monolith 虚空",
      copyright: "© 2026 godiao · 基于 MIT 许可证发布",
      links: {
        github: "GitHub 仓库",
        architecture: "架构设计文档",
        cli: "CLI 命令行参考",
        license: "MIT 许可证"
      }
    }
  }
};
