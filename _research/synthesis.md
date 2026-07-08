# 跨批次综合分析：Code RAG 工具库技术选型与差异化定位

> 输入：11 个开源项目深挖（`batch1/2/3_deepdive.md`）
> 目标：为"全面 Code RAG 工具库"（打包 + RAG 双能力）提供架构决策依据
> 结论先行：**现有生态被割裂成"打包派"和"检索派"两大阵营，无人做统一分层架构 + 向量检索几乎全缺 —— 这是最大蓝海。**

---

## 一、全景能力矩阵（11 项目 × 12 能力）

图例：●=核心能力/最强　◐=部分实现　○=无　—=不适用

| 能力维度 | Repomix | Aider | CodeGraph | llm-ctx | code2prompt | files2prompt | Tabby | SCIP | tree-sitter | llms-txt | LlamaIdx-CH |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 整仓打包输出 | ● | ◐ | ○ | ◐ | ● | ● | ○ | ○ | — | ◐ | ○ |
| 重要性排序 | ◐ | ● | ◐ | ○ | ○ | ○ | ◐ | ○ | — | ○ | ○ |
| 调用链/impact | ○ | ◐ | ● | ○ | ○ | ○ | ○ | ● | ○ | — | ○ |
| 分层压缩 | ○ | ○ | ◐ | ● | ○ | ○ | ○ | ○ | — | ◐ | ● |
| 可编程模板 | ◐ | ○ | ○ | ◐ | ● | ○ | ○ | — | — | ○ | ○ |
| AST 语义切分 | ◐ | ◐ | ● | ◐ | ◐ | ○ | ● | — | ● | — | ● |
| 向量检索 | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | — | ○ | ○ |
| 混合检索(RRF/多信号) | ○ | ○ | ◐ | ○ | ○ | ○ | ● | ○ | — | ○ | ○ |
| 增量索引 | ○ | ◐ | ● | ○ | ○ | ○ | ● | ◐ | ◐ | — | ○ |
| token 预算控制 | ● | ● | ○ | ○ | ◐ | ○ | ◐ | ○ | — | ◐ | ○ |
| 精确引用解析 | ○ | ○ | ◐ | ○ | ○ | ○ | ○ | ● | ○ | — | ○ |
| MCP/agent 接口 | ● | ○ | ● | ● | ○ | ○ | ◐ | ○ | — | ○ | ◐ |

### 矩阵读出的三个结构性事实

1. **向量检索是全生态盲区**：11 个项目里只有 Tabby 一家做了向量检索（还是 binarized 伪向量）。这不是巧合——"打包派"（Repomix/code2prompt/files2prompt）认为检索是上游 LLM 的事，"图谱派"（CodeGraph/SCIP）信奉精确符号优于语义模糊。**留给你一整块空地。**

2. **没有任何项目同时打通"打包 + 检索"**：最接近的是 llm-context（分层）和 CodeGraph（图谱+context），但前者无检索、后者无打包。**统一架构是差异化核心。**

3. **基础能力已被各家验证到可直接抄**：tree-sitter（AST）、Aider（PageRank）、Tabby（切分+RRF+增量）、LlamaIndex（skeleton 分层）、SCIP（精确引用）—— 每块最优解都有现成参考，你的工作是"缝合 + 补向量层"，不是"从零发明"。

---

## 二、两大阵营的割裂（生态地图）

```
                    打包派 (Packing)                     检索派 (Retrieval)
                    "全量/摘要塞给 LLM"                    "按需召回片段"
        ┌─────────────────────────────────┐   ┌──────────────────────────────┐
  轻    │  files-to-prompt  (~50行骨架)     │   │                              │
  ↑     │  Repomix          (全量+AST压缩)  │   │  llm-context (分层+规则)      │
  │     │  code2prompt      (模板可编程)    │   │                              │
  重    │                                  │   │  CodeGraph  (SQLite图���)      │
  ↓     │                                  │   │  Tabby      (向量+RRF+切分)   │
        └─────────────────────────────────┘   │  SCIP       (编译器级引用)     │
                                               └──────────────────────────────┘
        基础设施底座（两派都依赖）：
        tree-sitter (AST) · llms-txt (入口标准) · LlamaIndex-CH (分层范式)
```

- **打包派**：输入=整个 repo，输出=一份静态文件。优点：零检索、确定性、离线。缺点：token 爆炸、无相关性。
- **检索派**：输入=query，输出=top-k 片段。优点：精准、省 token。缺点：需索引、需 query、部署重。
- **你的机会**：**同一套索引，两种出口**——既能一键导出"分层压缩包"（打包模式），又能按 query 做"向量+图谱混合检索"（RAG 模式）。索引一次，双模复用。

---

## 三、架构分层与可复用模块清单

整个系统本质是**一条流水线（4 阶段）+ 两条横切能力 + 一个双模出口**。数据从磁盘流向 LLM，途中被 token 预算和增量缓存两条横切线贯穿。

```
        ┌─────────── 横切 A：Token 预算 ───────────┐
        ┌─────────── 横切 B：增量缓存 ─────────────┐
   磁盘 → ① 摄取 → ② 解析 → ③ 索引 → ④ 组装 → 出口 → LLM
                              (SQLite)      三模：打包 / 检索 / 观测
                                 │                          ↑
                                 └────────→ ⑤ Dashboard ────┘
                                     (读索引+运行时状态，可视化)
```

> 出口是**三模态**：CLI 打包、MCP 检索、Dashboard 观测。Dashboard 不在���据流主线上，是一条**旁路观测层**——���接读 SQLite 索引 + 各阶段运行时状态，把系统内部状态可视化。因所有状态本就沉淀在索引里，它只是"读端"，不影响核心架构。

下表每条给出来源项目 + file:line + 借鉴要点，**直接可抄**。

### 阶段 ① 摄取（发现文件 · 过滤 · 读取解码）
| 模块 | 来源 | 位置 | 借鉴要点 |
|------|------|------|---------|
| 多源 ignore 合并 + 延迟忽略 | Repomix | `fileSearch.ts:127/332` | .gitignore+.repomixignore+默认列表叠加，控制文件延迟剔除 |
| os.walk + dirs[] 原地剪枝 | files-to-prompt | `cli.py:122-172` | 最小骨架，`dirs[:]=[...]` 剪枝惯用法 |
| 三阶段并行遍历 | code2prompt | `path.rs:77` | I/O 顺序、CPU 并行、最后归并 |
| 重要文件白名单 | Aider | `special.py:3-203` | 177 项 README/CI/manifest，"永远内联" |
| 三级降级读文件(编码检测) | Repomix | `fileRead.ts:70` | UTF-8 快路径 → jschardet 慢路径，处理 GBK/Shift-JIS |
| is_valid_file 廉价过滤 | Tabby | `index.rs:212-218` | max/avg line + alphanum frac 挡 minified/生成代码 |

### 阶段 ② 解析（tree-sitter AST · 切分 · 抽符号/引用）
| 模块 | 来源 | 位置 | 借鉴要点 |
|------|------|------|---------|
| tree-sitter 标准 tags 范式 | tree-sitter | `docs/4-code-navigation.md:55` | `(comment)*@doc . (def)@definition.kind name:@name` |
| scm capture 约定 | tree-sitter | — | `@definition.*`/`@reference.*`/`@name`/`@doc` 直接采用 |
| AST 语义切分(容量目标) | Tabby | `intelligence.rs:165-185` | 沿 AST 找"塞得进 chunk_capacity 的最大语义单元" |
| 声明式 per-language extractor | CodeGraph | `tree-sitter-types.ts:80` | 每语言=一个配置文件+一行注册，hook 覆盖差异 |
| WASM worker 生命周期管理 | CodeGraph | `index.ts:602-732` | 周期回收 + OOM 重试，web-tree-sitter 必备 |
| thread_local parser registry | code2prompt | `entity_map.rs:52` | 摊销多语言 grammar 注册成本 |
| AST 压缩 + 优雅降级 | Repomix | `parseFile.ts:44` | WASM 失败静默回退原文 |

### 阶段 ③ 索引（SQLite：符号图谱 + 向量 + FTS5 入库）
| 模块 | 来源 | 位置 | 借鉴要点 |
|------|------|------|---------|
| SQLite schema(nodes/edges/unresolved) | CodeGraph | `db/schema.sql:20-144` | 只存元数据不存正文，provenance 标记边来源 |
| FTS5 external-content + 触发器 | CodeGraph | `schema.sql:97-123` | BM25 列权重 name=20，避免文本冗余 |
| SCIP Symbol/Occurrence/Relationship | SCIP | `scip.proto` | 精确引用图谱 schema，enclosing_range 调用链钩子 |
| binarize_embedding(伪向量入库) | Tabby | `index/mod.rs:343-383` | 向量二值化塞全文索引，零向量库依赖 |

### 阶段 ④ 组装（检索/排序 → 分层压缩 → 打包输出）
| 模块 | 来源 | 位置 | 借鉴要点 |
|------|------|------|---------|
| Personalized PageRank + 启发式乘子 | Aider | `repomap.py:481-525` | 私有×0.1/通用×0.1/对话内×50/长真名×10 |
| 双路 RRF 融合 | Tabby | `code.rs:86-162` | embedding+BM25，`1/(60+rank)` 相加 |
| 混合搜索 + CamelCase 边界 | CodeGraph | `context/index.ts:284-911` | FTS5+LIKE+模糊+co-location，无 embedding 语义-ish |
| 三级搜索降级 | CodeGraph | `queries.ts:481` | FTS5→LIKE→Levenshtein |
| impact radius 容器下钻 | CodeGraph | `traversal.ts:456-522` | 改类方法→追所有 caller，同 depth 下钻 |
| json_each 边恢复 | CodeGraph | `queries.ts:1054` | 一次查回选中节点集所有内部边 |
| **skeleton + uuid 展开入口** | LlamaIndex-CH | `code_hierarchy.py:795` | 子节点→signature+`See node_id{uuid}`，按需下钻 |
| 行级大纲压缩(█/⋮...) | llm-context | `code_outliner.py:44` | 定义行前缀█，省略段⋮...，语言无关 |
| to_tree 折叠渲染 | Aider | `repomap.py:710-784` | grep_ast.TreeContext 生成幽灵图 |
| inclusive_scopes 祖先栈 | LlamaIndex-CH | `code_hierarchy.py:389` | {name,type,signature} 栈，还原归属 |
| full/outline/selected 三态 | llm-context | `state.py:12` | full_files + excerpted_files 并存 |
| Handlebars 可编程模板 | code2prompt | `template.rs:69` | 用户写 .hbs 自定义输出格式 |
| 多格式输出(XML/MD/JSON) | Repomix | `outputGenerate.ts:255` | 动态反引号围栏计算 |
| llms.txt 入口清单 + Optional 段 | llms-txt | `core.py:101-117` | 索引层+全量层两级，Optional 作预算闸门 |
| 反引号冲突自适应 | files-to-prompt | `cli.py:87-98` | `while backticks in content: backticks+="`"` |

### 横切 A · Token 预算（贯穿 ②切分 → ④输出）
| 模块 | 来源 | 位置 | 借鉴要点 |
|------|------|------|---------|
| token 计数持久缓存 | Repomix | `tokenCountCache.ts:327` | 内容寻址 `encoding:byteLen:md5`，原子写+FIFO |
| 骨架渲染分离结构 token | code2prompt | `session.rs:474` | 空内容渲染算"外壳"，加 Σ文件 token |
| 二分搜索裁剪到预算 | Aider | `repomap.py:676-703` | Top-K 符号 vs token 上限二分收敛 |
| token_map 优先队列剪枝 | code2prompt | `analysis.rs:86` | BinaryHeap 按 token 占比选 top-N |

### 横切 B · 增量缓存（贯穿 ①摄取 → ③索引）
| 模块 | 来源 | 位置 | 借鉴要点 |
|------|------|------|---------|
| **git blob hash 当缓存键** | Tabby | `intelligence/id.rs:14-54` | 内容不变→hash 不变→跳过，零状态 |
| content-hash + git fast path | CodeGraph | `index.ts:1231-1372` | `git status --porcelain` 只 hash changed |
| mtime SQLite diskcache | Aider | `repomap.py:177-264` | 故障降级 dict 的稳健缓存 |

### 出口 · 三模接口（CLI 打包 / MCP 检索 / Dashboard 观测）
| 模块 | 来源 | 位置 | 借鉴要点 |
|------|------|------|---------|
| MCP tools + lazy project open | CodeGraph | `mcp/tools.ts:441` | projectPath 参数 lazy open + cache |
| lc_missing 按需取文件(四分类) | llm-context | `context_generator.py:246` | timestamp 找历史选区，missing/modified/deleted |
| YAML rule 递归组合 + 环检测 | llm-context | `rule.py:182-217` | frozenset 栈防循环，字段合并策略 |
| status 统计汇总 | CodeGraph | `index.ts` `status` | 文件/符号/边计数 + DB 大小 + 上次同步 |
| token_map treemap 数据 | code2prompt | `analysis.rs:86` | BinaryHeap 按 token 占比，直接喂前端 treemap |

### 观测层 · Dashboard（旁路，读索引 + 运行时状态）

Dashboard 是出口的第三模态，把系统内部状态可视化。6 个板块，全部数据源已存在于索引/运行时，无需新增采集。

| 板块 | 展示内容 | 数据来源 | 参考实现 |
|------|---------|---------|---------|
| **① 索引概览** | 文件/符号/边/chunk/向量计数、DB 大小、上次同步时间、语言分布、解析健康度(成功/降级/失败/跳过) | 阶段③ SQLite 统计查询 | CodeGraph `status` |
| **② Token 地图** ⭐ | treemap（目录/文件按 token 占比着色）+ 预算条（已用/上限）+ 超预算文件高亮 | 横切A token 缓存 | code2prompt `analysis.rs:86` dust 风格 |
| **③ 代码图谱** | force-directed 符号关系图、调用链高亮、impact radius 可视化、PageRank 热度着色 | 阶段③ edges 表 + 阶段④ 遍历 | CodeGraph 图谱 + Aider PageRank |
| **④ 检索检查器** ⭐ | query → 三路召回对比（向量/BM25/图谱各命中什么）→ RRF 融合过程 → top-k 结果 + 各路分数 | 阶段④ 检索管线 | Tabby 双路 RRF `code.rs:86` |
| **⑤ 打包预览** | 当前分层选择实时预览、每文件层级标注(full/skeleton/outline/omit)、导出前 token 估算 | 阶段④ 组装 + 横切A | llm-context 三态 `state.py:12` |
| **⑥ 同步状态** | git blob hash 变更列表、上次索引耗时分解、worker 状态、失败 chunk 重试队列 | 横切B 增量缓存 | Tabby blob hash `id.rs:14` |

**技术选型建议**：
- 后端：核心已是本地服务（MCP server 同进程），Dashboard 复用同一 SQLite 连接 + 一个轻量 HTTP/WebSocket endpoint 推送运行时事件（索引进度、检索日志）
- 前端：单页 + 零构建优先（对标 Repomix `browser/` 或 CodeGraph 无前端）。图谱用 D3-force / Cytoscape，treemap 用 D3-treemap，其余用轻量图表库
- 定位：**开发/调试期观测工具**，不是生产监控。重点服��两类高频调试场景——「token 花在哪」（板块②）和「为什么这段代码没被检索到」（板块④）
- 落地阶段：放 **v1 之后**（需先有 SQLite 索引和检索管线才有状态可看），MVP 阶段可先出板块②的纯 CLI 版（token treemap 文本输出，对标 code2prompt）

---

## 四、你的工具的差异化定位

### 核心命题
> **"索引一次，双模出口"** —— 一套统一的 tree-sitter + 向量 + 图谱索引，既能导出**分层压缩包**（打包模式，对标 Repomix），又能做**混合检索**（RAG 模式，对标 Tabby），且两模共享同一份增量索引。

### 三个差异化支柱（现有生态全缺）

**支柱 1：统一分层索引（打包派 + 检索派合流）**
- 现状：打包派无检索，检索派无打包，两套系统重复扫仓库
- 你做：单次扫描 → 建立 {AST 符号 + 向量 + 调用图} 三合一索引 → 打包和检索都从此索引读
- 落地：CodeGraph 的 SQLite schema（阶段③）+ Tabby 的 binarized embedding（阶段③）合表，加一列 `embedding_tokens`

**支柱 2：真·分层压缩（skeleton 下钻 + Optional 预算闸门）**
- 现状：Repomix 只有 full/compress/directory 三档静态分级；llm-context 有 full/outline 但无"下钻入口"
- 你做：概览层(repo_map) → 模块层(signature) → 函数层(skeleton+uuid) → 全文层，按 token 预算自动选层，LLM 可用 uuid 主动下钻
- 落地：LlamaIndex-CH 的 skeleton 机制（阶段④）+ llms-txt 的 Optional 段（阶段④）+ Aider 二分预算（横切A）

**支柱 3：向量 + 图谱混合检索（全生态盲区）**
- 现状：Tabby 只有向量+BM25，无调用图；CodeGraph 只有图谱+FTS5，无向量
- 你做：query → 向量召回 + BM25 + 图谱扩展（沿调用链拉相关节点）→ RRF 融合 → 按 impact 排序
- 落地：Tabby 双路 RRF（阶段④）+ CodeGraph impact 遍历（阶段④）+ Aider PageRank 排序（阶段④）

### 定位一句话
> 现有工具是"打包 OR 检索、向量 OR 图谱"的单选题；你做的是"打包 AND 检索、向量 AND 图谱"的合集，且用统一索引避免重复造。

---

## 五、技术选型建议

### 语言/运行时
| 决策点 | 建议 | 理由 |
|-------|------|------|
| 主语言 | **TypeScript/Node** 或 **Rust** | TS：生态近 MCP/LLM 工具、CodeGraph/Repomix 可直接参考；Rust：性能、Tabby/code2prompt 可参考。若求快出 MVP 选 TS |
| AST 引擎 | **web-tree-sitter (WASM)** | 跨平台零编译（CodeGraph 路线），代价是需 worker 内存管理 |
| 向量方案 | **起步 binarized(Tabby 路线)，可选升级 sqlite-vec** | binarized 零依赖单文件；需高精度语义再上真向量 |
| 存储 | **SQLite (FTS5 + 自定义 embedding 列)** | CodeGraph schema 直接扩展，单文件、可移植 |
| 引用解析 | **tree-sitter 默认 + SCIP 可选增强** | 快速场景 tree-sitter 句法级；深度场景接 SCIP indexer |

### 分阶段路线
| 阶段 | 交付 | 复用模块 |
|------|------|---------|
| **MVP** | 打包模式：扫仓→AST 摘要→分层压缩→导出（对标 Repomix+分层） | ①Repomix发现 + ②Tabby切分 + ④skeleton + ④模板 + 横切A token |
| **v1** | 索引 + 检索：建 SQLite 索引→向量+BM25 混合检索→MCP 暴露 | + ③CodeGraph schema + ④Tabby RRF + 横切B git blob 增量 + 出口 MCP |
| **v2** | 图谱增强：调用链遍历→impact 排序→SCIP 可选精确引用 | + ④impact下钻 + ④PageRank + SCIP 接入 |
| **v2.5** | Dashboard 观测层：索引概览/Token 地图/图谱/检索检查器 | + 观测层 6 板块（复用已有索引数据） |
| **v3** | 规则化 + 可编程：YAML rule 组合→自定义模板→llms.txt 自动生成 | + 出口 rule 组合 + ④llms.txt |

> Dashboard 的板块②（Token 地图 CLI 版）可提前到 MVP，纯文本 treemap 输出；完整可视化面板放 v2.5（需 v1 的 SQLite 索引 + 检索管线就绪）。

### 明确不做（避免过度设计）
- **不自己写跨文件类型推断**：动态/重载/泛型语言手写解析是无底洞，深度场景直接接 SCIP indexer
- **不自建向量库**：起步用 binarized 塞 SQLite，需要再上 sqlite-vec，不引 Chroma/Qdrant 重依赖
- **不绑死 LlamaIndex 框架**：CodeHierarchy 的 schema 绑死 BaseNode，只抄 skeleton 范式不抄框架
- **不追求 completion 级切片**：Tabby 的 512 字符 chunk 是 FIM 场景，你是 chat 上下文，切片走"AST 语义单元"粒度

---

## 六、关键风险与缓解

| 风险 | 来源经验 | 缓解 |
|------|---------|------|
| WASM 内存只涨不缩 | CodeGraph 周期回收 worker | 抄 `WORKER_RECYCLE_INTERVAL` + OOM 重试 |
| 大仓初次索引慢 | Aider 自己提示"scan can be slow" | git blob hash 增量 + 首次并行 |
| tree-sitter 无语义→引用不准 | Aider/CodeGraph 都只是启发式 | 明确分级：句法快路径 + SCIP 精确可选 |
| token 估算偏差 | Aider 采样近似有误差 | 抄 Repomix 精确 tokenizer + 缓存 |
| binarized 向量精度损失 | Tabby 1-bit 量化 | 提供真向量升级路径，不锁死 |
| capture 名靠约定不校验 | tree-sitter 跨 binding 不一致 | 自建 capture 校验层 |

---

## 七、一页速查（决策浓缩）

- **架构**：4 阶段（①摄取 ②解析 ③索引 ④组装）+ 2 横切（Token 预算 / 增量缓存）+ 三模出口（CLI 打包 / MCP 检索 / Dashboard 观测）
- **Dashboard**：旁路观测层，读同一 SQLite 索引；6 板块，最有价值是 Token 地图 + 检索检查器（调试 RAG 神器）；放 v2.5，Token 地图 CLI 版可提前到 MVP
- **市场空位**：打包+检索合一、向量+图谱合一 —— 全生态无人做
- **抄谁**：①摄取抄 Repomix，②切分抄 Tabby，③索引抄 CodeGraph，④组装抄 Aider(排序)+LlamaIndex-CH(分层)+code2prompt(模板)，横切增量抄 Tabby(blob hash)，出口抄 llm-context/CodeGraph(MCP)
- **补什么**：统一索引 + 向量检索 + 真分层下钻（三个支柱）
- **底座**：tree-sitter(WASM) + SQLite(FTS5+embedding) + 可选 SCIP
- **不做**：跨文件类型推断、重向量库、绑框架、completion 切片
- **MVP 最短路**：Repomix 发现 + Tabby 切分 + skeleton 分层 + token 预算 = 一个"带分层的 Repomix"，2-3 周可出
