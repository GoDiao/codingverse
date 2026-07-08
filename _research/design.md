# codingverse 方案设计

> 输入：`synthesis.md`（架构 + 模块清单 + 选型）
> 决策：**TypeScript/Node · Monorepo 多包 · 项目名 codingverse**
> 本文交付：模块划分 → 目录结构 → 数据流 → SQLite schema → 核心 API 契约 → MVP 拆解

---

## 一、系统总览

```
        ┌─────────── 横切 A：Token 预算 ───────────┐
        ┌─────────── 横切 B：增量缓存 ─────────────┐
   磁盘 → ① 摄取 → ② 解析 → ③ 索引 → ④ 组装 → 出口 → LLM
                              (SQLite)      三模：打包/检索/观测
                                 │                          ↑
                                 └────────→ ⑤ Dashboard ────┘
```

一句话：**索引一次，三模出口**。core 包负责 ①-④ 阶段 + 两条横切，cli/mcp/dashboard 三个出口包共享 core 的索引引擎。

---

## 二、Monorepo 包划分

| 包 | npm 名 | 职责 | 依赖 |
|----|-------|------|------|
| **core** | `@codingverse/core` | 4 阶段管线 + 2 横切 + SQLite 索引引擎，纯库无 IO 副作用入口 | web-tree-sitter, better-sqlite3, gpt-tokenizer |
| **cli** | `codingverse`（bin: `cv`） | 命令行：pack / index / search / status | core, commander |
| **mcp** | `@codingverse/mcp` | MCP server：暴露检索/打包/按需取文件 tools | core, @modelcontextprotocol/sdk |
| **dashboard** | `@codingverse/dashboard` | 观测面板：HTTP/WS + 前端 SPA | core, hono/express |
| **shared** | `@codingverse/shared` | 类型定义、常量、schema（被所有包引用） | — |

依赖方向：`shared ← core ← {cli, mcp, dashboard}`。core 不反向依赖任何出口包。

---

## 三、目录结构

```
codingverse/
├── package.json                 # workspaces 根
├── pnpm-workspace.yaml          # pnpm monorepo（推荐 pnpm，硬链省 E 盘空间）
├── tsconfig.base.json
├── packages/
│   ├── shared/
│   │   └── src/
│   │       ├── types.ts         # SymbolNode / Edge / Chunk / PackResult / SearchHit
│   │       ├── constants.ts     # 默认 ignore / chunk size / token 预算默认值
│   │       └── schema.sql       # SQLite DDL（单一事实来源）
│   ├── core/
│   │   └── src/
│   │       ├── ingest/          # 阶段①
│   │       │   ├── walker.ts        # 文件发现 + 多源 ignore（抄 Repomix fileSearch）
│   │       │   ├── reader.ts        # 三级降级读取解码（抄 Repomix fileRead）
│   │       │   └── validate.ts      # is_valid_file 过滤（抄 Tabby）
│   │       ├── parse/           # 阶段②
│   │       │   ├── worker.ts        # WASM tree-sitter worker（抄 CodeGraph 生命周期）
│   │       │   ├── languages/       # 声明式 per-language extractor
│   │       │   │   ├─�� registry.ts
│   │       │   │   ├── typescript.ts
│   │       │   │   └── python.ts
│   │       │   ├── chunker.ts       # AST 语义切分（抄 Tabby CodeSplitter 思路）
│   │       │   └── queries/         # *.scm（def/ref 标准词汇表）
│   │       ├── index/           # 阶段③
│   │       │   ├── db.ts            # SQLite 连接 + migration
│   │       │   ├── store.ts         # nodes/edges/chunks 写入
│   │       │   ├── embed.ts         # embedding provider + binarize（抄 Tabby）
│   │       │   └── resolve.ts       # unresolved_refs → edges（抄 CodeGraph）
│   │       ├── assemble/        # 阶段④
│   │       │   ├── search.ts        # 向量+BM25+图谱 三路 RRF（抄 Tabby+CodeGraph）
│   │       │   ├── rank.ts          # PageRank + 启发式乘子（抄 Aider）
│   │       │   ├── graph.ts         # 调用链/impact 遍历（抄 CodeGraph）
│   │       │   ├── compress.ts      # skeleton + 分层（抄 LlamaIndex-CH + llm-context）
│   │       │   └── output.ts        # 多格式渲染 + 模板（抄 Repomix + code2prompt）
│   │       ├── budget/          # 横切A
│   │       │   ├── tokenizer.ts     # gpt-tokenizer 封装
│   │       │   └── cache.ts         # 内容寻址 token 缓存（抄 Repomix）
│   │       ├── cache/           # 横切B
│   │       │   └── incremental.ts   # git blob hash 增量（抄 Tabby id.ts）
│   │       ├── Engine.ts        # 门面类：统一编排 index()/pack()/search()
│   │       └── index.ts         # 包入口，导出 Engine + 类型
│   ├── cli/
│   │   └── src/
│   │       ├── bin.ts           # commander 入口，注册子命令
│   │       └── commands/{pack,index,search,status}.ts
│   ├── mcp/
│   │   └── src/server.ts        # MCP tools 定义
│   └── dashboard/
│       ├── src/server.ts        # HTTP/WS 后端
│       └── web/                 # 前端 SPA（零构建优先）
└── _reference/ · _research/     # 已有调研资产
```

---

## 四、数据流（三条主路径）

### 路径 1：index（建索引，一切的基础）
```
Engine.index(repoPath, opts)
  → ingest.walker    发现文件（含 ignore 过滤）
  → cache.incremental 用 git blob hash 剔除未变文件         [横切B]
  → ingest.reader    读取解码（跳二进制/超大）
  → ingest.validate  过滤 minified/生成代码
  → parse.worker     WASM tree-sitter 解析 → AST
  → parse.languages  抽 symbols + unresolved_refs
  → parse.chunker    AST 语义切分 → chunks
  → budget.tokenizer 每 chunk 算 token（缓存）              [横切A]
  → index.embed      chunk → embedding → binarize
  → index.store      写 nodes/edges/chunks/vectors 到 SQLite
  → index.resolve    unresolved_refs → edges（调用图）
  → 返回 IndexStats
```

### 路径 2：pack（打包模式，MVP 主线）
```
Engine.pack(repoPath, opts)
  → ensureIndex()（无索引则先 index，有则增量 sync）
  → rank.pagerank        算符号重要性
  → compress.selectLayer 按 token 预算为每文件定层           [横切A]
       full / skeleton / outline / omit
  → compress.skeleton    生成骨架（signature + uuid 展开入口）
  → output.render        多格式渲染（XML/MD/JSON/自定义模板）
  → 返回 PackResult { content, tokenCount, layerMap }
```

### 路径 3：search（检索模式）
```
Engine.search(query, opts)
  → embed(query) → binarize
  → search.vector   向量召回（binarized Tantivy-like）
  → search.bm25     FTS5 全文召回
  → search.graph    图谱扩展（沿调用链拉相关节点）
  → search.rrf      三路 RRF 融合
  → rank.impact     按 impact/PageRank 重排
  → compress        命中片段按预算裁剪
  → 返回 SearchHit[]
```

---

## 五、SQLite Schema（shared/src/schema.sql）

在 CodeGraph schema 基础上 **合并 Tabby 的向量列**，实现"图谱+向量"同表。

```sql
-- 符号节点（函数/类/方法/变量…）
CREATE TABLE nodes (
  id            TEXT PRIMARY KEY,      -- hash(file_path + qualified_name)
  kind          TEXT NOT NULL,         -- function/class/method/…
  name          TEXT NOT NULL,
  qualified_name TEXT,
  file_path     TEXT NOT NULL,
  language      TEXT,
  start_line    INTEGER, end_line INTEGER,
  start_byte    INTEGER, end_byte INTEGER,
  signature     TEXT,                  -- 供 skeleton 用
  docstring     TEXT,
  visibility    TEXT,                  -- public/private（PageRank 乘子用）
  pagerank      REAL DEFAULT 0,        -- 阶段④算好回写
  updated_at    INTEGER
);

-- 关系边（调用/引用/继承/包含）
CREATE TABLE edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- calls/references/extends/contains/imports
  line       INTEGER, col INTEGER,
  provenance TEXT DEFAULT 'tree-sitter' -- tree-sitter/scip/heuristic
);

-- 代码切片（可检索单元，含向量）
CREATE TABLE chunks (
  id            TEXT PRIMARY KEY,      -- hash(file_path + start_byte)
  file_path     TEXT NOT NULL,
  language      TEXT,
  start_line    INTEGER, end_line INTEGER,
  body          TEXT NOT NULL,
  token_count   INTEGER,
  embedding     BLOB,                  -- 原始 float32 向量（可选，升级 sqlite-vec 用）
  embedding_tokens TEXT                -- binarized token 串（Tabby 路线，FTS 检索用）
);

-- 文件级增量缓存
CREATE TABLE files (
  path          TEXT PRIMARY KEY,
  git_blob_hash TEXT,                  -- 横切B 增量键
  content_hash  TEXT,
  language      TEXT,
  size          INTEGER,
  node_count    INTEGER,
  indexed_at    INTEGER,
  parse_status  TEXT                   -- ok/degraded/failed/skipped（Dashboard 健康度）
);

-- 待解析引用（二阶段 resolution）
CREATE TABLE unresolved_refs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id  TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  reference_name TEXT NOT NULL,
  reference_kind TEXT,
  line INTEGER, col INTEGER,
  file_path     TEXT, language TEXT
);

-- FTS5：符号名 + chunk 正文 + binarized 向量 token 混合索引
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  id UNINDEXED, name, qualified_name, docstring, signature,
  content='nodes', content_rowid='rowid'
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  id UNINDEXED, body, embedding_tokens,   -- body 走 BM25，embedding_tokens 走伪向量
  content='chunks', content_rowid='rowid'
);

-- 索引
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_file ON nodes(file_path, start_line);
CREATE INDEX idx_edges_src ON edges(source, kind);
CREATE INDEX idx_edges_tgt ON edges(target, kind);
CREATE INDEX idx_chunks_file ON chunks(file_path);
CREATE INDEX idx_unresolved ON unresolved_refs(from_node_id, reference_name);

-- 元数据
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
```

**关键设计**：
- `chunks.embedding_tokens` + `chunks_fts` = Tabby 的 binarized 伪向量，零向量库依赖
- `chunks.embedding` BLOB 预留真向量升级位（sqlite-vec）
- `nodes.pagerank` 列让重要性排序结果持久化，pack 时直接读
- `files.parse_status` 直接喂 Dashboard 板块① 健康度
- `edges.provenance` 区分 tree-sitter 句法边 vs SCIP 精确边（v2 用）

---

## 六、核心 API 契约（core/src/Engine.ts）

```typescript
import type { IndexStats, PackResult, SearchHit, PackOptions, SearchOptions } from '@codingverse/shared';

export class Engine {
  static async open(repoPath: string, opts?: EngineOptions): Promise<Engine>;

  /** 阶段①-③：建/更新索引。增量：只处理 git blob hash 变化的文件 */
  async index(opts?: IndexOptions): Promise<IndexStats>;

  /** 增量同步（git status 快路径） */
  async sync(): Promise<IndexStats>;

  /** 打包模式：分层压缩导出一份 LLM 上下文 */
  async pack(opts?: PackOptions): Promise<PackResult>;

  /** 检索模式：向量+BM25+图谱 三路 RRF */
  async search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;

  /** 按 uuid 展�� skeleton 里的节点（MCP lc_missing 等价） */
  async expand(nodeId: string): Promise<string>;

  /** 调用链/影响面查询 */
  async callers(nodeId: string, depth?: number): Promise<SymbolNode[]>;
  async callees(nodeId: string, depth?: number): Promise<SymbolNode[]>;
  async impact(nodeId: string, depth?: number): Promise<SymbolNode[]>;

  /** Dashboard 数据源：一次性拿全部观测状态 */
  async stats(): Promise<DashboardStats>;

  async close(): Promise<void>;
}
```

### 关键类型（shared/src/types.ts）
```typescript
interface PackOptions {
  tokenBudget?: number;          // 默认 128k
  format?: 'xml' | 'markdown' | 'json';
  template?: string;             // 自定义 .hbs 路径（code2prompt 路线）
  include?: string[]; exclude?: string[];
  layerStrategy?: 'auto' | 'full' | 'skeleton' | 'outline';
  alwaysFull?: string[];         // 强制全文的文件 glob（重要文件白名单）
}

interface PackResult {
  content: string;
  tokenCount: number;
  layerMap: Record<string, 'full' | 'skeleton' | 'outline' | 'omit'>;  // Dashboard 板块⑤
  fileCount: number;
}

interface SearchHit {
  chunkId: string;
  filePath: string;
  startLine: number; endLine: number;
  body: string;
  scores: { vector: number; bm25: number; graph: number; rrf: number };  // Dashboard 板块④
  relatedNodes: string[];        // 图谱扩展命中的邻居
}

interface DashboardStats {
  index: { files: number; symbols: number; edges: number; chunks: number; dbSize: number; lastSync: number };
  health: { ok: number; degraded: number; failed: number; skipped: number };
  languages: Record<string, number>;
  tokenMap: TreemapNode;         // 板块② treemap 数据
  syncQueue: { path: string; status: string }[];  // 板块⑥
}
```

---

## 七、MVP 拆解（最短可用路径）

目标：**一个"带分层压缩 + token 预算"的 Repomix**，2-3 周。

| 里程碑 | 交付 | 涉及模块 | 验收 |
|--------|------|---------|------|
| **M0 脚手架** | pnpm monorepo + shared/core/cli 空壳 + tsconfig | 全包 | `cv --help` 可运行 |
| **M1 摄取** | 文件发现 + ignore + 读取解码 + 过滤 | ingest/* | `cv pack` 能列出文件 |
| **M2 解析** | web-tree-sitter 集成（TS/Python 两语言）+ 符号抽取 + AST 切分 | parse/* | 能输出符号 outline |
| **M3 token 预算** | tokenizer + 缓存 + 每文件/每 chunk 计数 | budget/* | pack 结果带准确 token 数 |
| **M4 分层压缩** | skeleton 生成 + 按预算选层（full/skeleton/outline/omit） | assemble/compress | 超预算自动降级，可展开 |
| **M5 输出** | XML/MD/JSON 渲染 + 目录树 + 全量打包 | assemble/output | `cv pack -o out.xml` 可用 |
| **M6 增量** | git blob hash 缓存，二次 pack 秒级 | cache/incremental | 改一个文件只重算一个 |
| **M7 Token 地图 CLI** | 纯文本 treemap（Dashboard 板块② 前身） | budget + cli | `cv status --token-map` |

MVP **不做**：SQLite 索引、向量检索、图谱、MCP、Dashboard 面板（这些留 v1/v2/v2.5）。
MVP 的 pack 可以先**不落 SQLite**，走内存管线（对标 Repomix）；v1 引入 SQLite 后 pack 改为读索引。

### MVP 之后
- **v1**：落 SQLite 索引 + 向量/BM25 检索 + MCP server（`cv search` / `cv serve`）
- **v2**：调用图 + impact + PageRank + SCIP 可选接入
- **v2.5**：Dashboard 完整面板（6 板块）
- **v3**：YAML rule 组合 + 可编程模板 + llms.txt 自动生成

---

## 八、关键技术决策备忘

| 决策 | 选择 | 理由 |
|------|------|------|
| 包管理 | **pnpm** | monorepo 硬链接，省 E 盘空间（符合用户全局规则） |
| tree-sitter | **web-tree-sitter (WASM)** | 跨平台零编译；worker 隔离 + 周期回收（抄 CodeGraph） |
| SQLite 驱动 | **better-sqlite3** | 同步 API 简单，FTS5 支持好；无原生编译问题时用，否则 node-sqlite3-wasm 回退 |
| tokenizer | **gpt-tokenizer** | 纯 JS 无 WASM，o200k_base 默认（抄 Repomix） |
| 向量 | **binarized 起步** | 零向量库依赖；`embedding` BLOB 列预留 sqlite-vec 升级 |
| embedding provider | **可插拔接口** | 默认 OpenAI 兼容 HTTP；本地可接 Ollama/llama.cpp（抄 Tabby trait） |
| 模板引擎 | **Handlebars** | code2prompt/Repomix 都用，生态成熟 |
| Dashboard 前端 | **零构建 SPA** | 单 HTML + D3（treemap/force），避免构建链复杂度 |

### 明确不做（避免过度设计）
- 不自写跨文件类型推断 → 深度场景接 SCIP indexer
- 不引 Chroma/Qdrant → binarized + 可选 sqlite-vec
- 不绑 LlamaIndex 框架 → 只抄 skeleton 范式
- 不做 completion 级 512 字符切片 → 走 AST 语义单元粒度
