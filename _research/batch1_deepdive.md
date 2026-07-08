# 第一批深挖卡片（核心 4 项目）

> 用途：为"全面 Code RAG 工具库"提供可复用模块清单 + 差异化机会对照
> 仓库位置：`_reference/{repomix, aider, codegraph, llm-context}/`

---

## Repomix 深挖卡片

### 一句话定位
把整个代码仓库压成一份 LLM 友好的单文件上下文

### 核心架构
- 入口：`bin/repomix.cjs` → `src/cli/cliRun.ts:50` (commander CLI) → `src/index.ts:4` (库 API `pack()`)
- 主要模块：
  - `src/core/packager.ts` — 主编排管线（并行调度搜索/收集/安全/处理/输出/指标）
  - `src/core/file/` — 文件搜索(globby)、收集(并发池)、读取(二进制+编码检测)、处理(注释剥离/压缩)
  - `src/core/git/` — git diff/log 抓取、GitHub archive 流式下载
  - `src/core/security/` — secretlint worker 池扫描
  - `src/core/metrics/` — gpt-tokenizer token 计数 + 持久化缓存
  - `src/core/output/` — Handlebars 模板渲染 (xml/markdown/plain) + fast-xml-builder (parsable XML) + JSON
  - `src/core/treeSitter/` — WASM AST 解析，按语言策略提取签名做"压缩"
  - `src/config/` — valibot 配置 schema + 默认 ignore 列表
  - `src/mcp/` — MCP server 暴露给 AI 工具
- 关键类/函数：
  - `pack()` — `src/core/packager.ts:70` 全流程编排，6 阶段并行
  - `searchFiles()` — `src/core/file/fileSearch.ts:127` globby + 多层 ignore
  - `runSecurityCheck()` — `src/core/security/securityCheck.ts:30` secretlint 批处理
  - `TokenCounter` — `src/core/metrics/TokenCounter.ts:47` 懒加载 BPE 计数
  - `parseFile()` — `src/core/treeSitter/parseFile.ts:44` AST 压缩，失败降级
  - `generateOutput()` — `src/core/output/outputGenerate.ts:255` 多格式分发

### 打包策略
- **文件收集**：三层过滤叠加。`searchFiles` (fileSearch.ts:127) 用 globby 走 include glob；ignore 来源 = `.gitignore`(globby gitignore 选项) + `.ignore` + `.repomixignore` + `.git/info/exclude` (fileSearch.ts:414) + `defaultIgnoreList` (defaultIgnore.ts，含 node_modules/dist/lock 文件等 163 条) + `customPatterns` + 输出文件自身。控制文件(.gitignore 等)用"延迟忽略"技巧：先让 globby 看到它们以加载规则，最后再从结果集剔除 (fileSearch.ts:100-124)。stdin 模式支持显式文件列表。远程仓库走 `downloadGitHubArchive` (gitHubArchive.ts:50) 流式 tar.gz 解压（HTTP→progress→gunzip→tar extract），3 种 URL fallback (main/master/tag) + 指数退避重试。
- **输出格式**：4 种，默认 XML。结构 = `file_summary` + `directory_structure`(树形) + `files`(逐文件 path 属性 + 全内容) + `git_diffs` + `git_logs` + `instruction`。XML/Markdown/Plain 走 Handlebars 编译模板（缓存编译结果，outputGenerate.ts:29）；Parsable XML 走 `fast-xml-builder` (outputGenerate.ts:108)；JSON 直接 `JSON.stringify`，files 用 `{path: content}` map。Markdown 模板会动态计算反引号围栏长度（取文件中最大反引号数+1，outputGenerate.ts:55）。支持 `--split-output` 按字节切分多文件。
- **Token 计数**：`gpt-tokenizer` 纯 JS BPE（无 WASM），默认 `o200k_base`(GPT-4o)。懒加载 encoding 模块并缓存 (TokenCounter.ts:25)。两个关键优化：(1) 持久化磁盘缓存 `tokenCountCache.ts` — key = `${encoding}:${byteLength}:${md5_16}`，FIFO 限 100k 条，原子写(tmp+rename)，per-repo "seen" 标记预测冷热；(2) "Fast-path wrapper" (calculateMetrics.ts:120) — 从总输出中按 indexOf 抠掉每个文件内容，只对剩余"外壳"（header/树/模板标签）单独计数，加上各文件 token 之和，避免对整份 ~4MB 输出重复 tokenize。Worker 池 + 50 条/批降 IPC。
- **安全检查**：`@secretlint/core` + `@secretlint/secretlint-rule-preset-recommend`，跑在 worker_threads 里 (securityCheckWorker.ts:97)。50 文件/批，最多 2 个 worker（避免与 metrics 池争抢）。扫文件内容 + git diff + git log。结果分流：可疑**文件**被从输出剔除 (validateFileSafety.ts:41)；可疑 **git diff/log** 仅告警仍保留输出 (validateFileSafety.ts:54)。worker 里还 hack 了 `performance.mark` 为 no-op 以规避 secretlint profiler 的 O(n²) 累积开销 (securityCheckWorker.ts:54)。

### 可复用模块（带 file:line）
1. **searchFiles + prepareIgnoreContext** — 多源 ignore 合并 + 延迟忽略控制文件的技巧，可直接复用做仓库文件发现 — `src/core/file/fileSearch.ts:127` / `:332`
2. **tokenCountCache.ts** — 内容寻址(`encoding:byteLen:md5`)的 token 计数持久缓存，原子写 + FIFO 驱逐 + 冷热预测，RAG 工具做 token 预算必备 — `src/core/metrics/tokenCountCache.ts:327` (key) / `:229` (save)
3. **readRawFile** — 三级降级读文件：扩展名二进制探测 → NULL 字节探针 + BOM 豁免 → UTF-8 fatal 解码快路径 → isBinaryFile → jschardet 编码检测 + iconv-lite 解码，处理 Shift-JIS/EUC-KR/GBK — `src/core/file/fileRead.ts:70`
4. **parseFile (tree-sitter 压缩)** — WASM AST 解析 + 按语言 query 捕获签名 + 去重 + 邻接合并，失败优雅降级到原文，可作为"代码摘要"层的基础 — `src/core/treeSitter/parseFile.ts:44`；语言注册表 `src/core/treeSitter/languageConfig.ts:64`（16 种语言）
5. **downloadGitHubArchive** — 流式 HTTP→gunzip→tar extract，无临时归档文件，3 URL fallback + 重试，做"远程仓库快速取包"直接借鉴 — `src/core/git/gitHubArchive.ts:50`
6. **extractOutputWrapper 快路径** — 用 indexOf 从输出反推"外壳"，把 N 次大块 tokenize 降为 1 次小块，做 RAG token 预算统计时极有用 — `src/core/metrics/calculateMetrics.ts:120`

### 设计取舍 / 缺口
- **无向量检索/语义切分**：文件是原子单元，全量塞入；没有 embedding、没有 chunk、没有召回，纯"全量打包"。用户做 Code RAG 必须自己加向量化 + 语义切分层。
- **AST 压缩只到签名级**：`--compress` 只提取函数/类/接口/类型的签名行 + 注释，丢弃函数体 (TypeScriptParseStrategy.ts:84 `findSignatureEnd` 只到 `{`/`=>`)。没有函数体摘要、没有调用链/依赖图感知、没有跨文件引用解析。query 里有 `@reference.type/@reference.class` 捕获但策略类并未使用。
- **无分层压缩**：`output.patterns` (fileLevelResolve.ts:38) 只能按 glob 给单文件分级 `full/compress/directory-only`，没有"概览层→模块层→文件层"的多层级上下文结构，不能按 LLM 上下文窗口动态调整粒度。
- **无增量/差异打包**：git diff 是"附加"到输出末尾的一节，不是"只发变更文件"。每次都是全量重打，没有基于上次打包结果的增量。
- **安全检查纯模式匹配**：secretlint 是正则/规则 preset，不识别语义敏感数据（如无固定格式的内部密钥、业务敏感字段）。可疑文件直接剔除会丢上下文，没有"脱敏替换"选项。
- **无文件重要性排序的语义信号**：排序只能按 git 变更频次 (outputSort.ts:132，变更多的排底部)，没有按"入口度/被引用数/PageRank"等代码结构信号排序。

### 关键代码片段

**片段 1 — pack() 管线的并行编排**（6 阶段，体现核心设计）
```ts
// src/core/packager.ts:164-233
// 阶段3：文件收集 与 git操作 并行（互不依赖）
const [collectResults, gitDiffResult, gitLogResult] = await Promise.all([
  withMemoryLogging('Collect Files', async () =>
    Promise.all(sortedFilePathsByDir.map(({ rootDir, filePaths }) =>
      deps.collectFiles(filePaths, rootDir, config, progressCallback)))),
  deps.getGitDiffs(rootDirs, config),
  deps.getGitLogs(rootDirs, config),
]);
// ...
// 阶段4：安全检查(worker) 与 文件处理(主线程) 并行——不抢 CPU
const [validationResult, allProcessedFiles] = await Promise.all([
  withMemoryLogging('Security Check', () =>
    deps.validateFileSafety(rawFiles, progressCallback, config, gitDiffResult, gitLogResult)),
  withMemoryLogging('Process Files', () => {
    progressCallback('Processing files...');
    return deps.processFiles(rawFiles, config, progressCallback);
  }),
]);
```
说明：把 I/O 任务、子进程任务、worker 任务、主线程任务按依赖关系编组并行，是性能关键。还预取 token 缓存和 git 排序数据 (`prefetchSortData`) 与搜索重叠。

**片段 2 — tree-sitter AST 压缩 + 优雅降级**
```ts
// src/core/treeSitter/parseFile.ts:44-127 (节选)
export const parseFile = async (fileContent, filePath, config): Promise<string | undefined> => {
  const lines = fileContent.split('\n');
  let tree: Tree | null | undefined;
  try {
    const languageParser = await getLanguageParserSingleton();
    const lang = languageParser.guessTheLang(filePath);
    if (lang === undefined) return undefined;            // 不支持的语言：静默回退原文
    const query = await languageParser.getQueryForLang(lang);
    const parser = await languageParser.getParserForLang(lang);
    tree = parser.parse(fileContent);                    // 解析为 AST
    if (!tree) return undefined;
    const parseStrategy = await languageParser.getStrategyForLang(lang);
    const captures = query.captures(tree.rootNode);      // 应用 query 捕获
    captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row);
    for (const capture of captures) {
      const chunk = parseStrategy.parseCapture(capture, lines, processedChunks, context);
      if (chunk !== null) capturedChunks.push({ content: chunk.trim(), startRow, endRow });
    }
    return filterDuplicatedChunks(capturedChunks)        // 同 startRow 取最长
      .map(c => c.content).join(`\n${CHUNK_SEPARATOR}\n`).trim();
  } catch (error) {
    logger.warn(`Failed to compress ${filePath}, using uncompressed content: ${message}`);
    return undefined;                                    // WASM abort 等失败 → 回退原文
  } finally { tree?.delete(); }
};
```
说明：query 驱动 + 策略模式 + 单例复用 + 失败降级。query 文件见 `queries/queryTypescript.ts`（捕获 import/function/method/class/interface/type/enum/comment）。

**片段 3 — 文件读取的三级降级（二进制 + 编码）**
```ts
// src/core/file/fileRead.ts:70-146 (节选核心)
export const readRawFile = async (filePath, maxFileSize): Promise<FileReadResult> => {
  if (isBinaryPath(filePath)) return { content: null, skippedReason: 'binary-extension' };
  const buffer = await fs.readFile(filePath);
  if (buffer.length > maxFileSize) return { content: null, skippedReason: 'size-limit' };
  // NULL 字节探针（SIMD），BOM 文本豁免
  if (!hasTextBom(buffer) && buffer.indexOf(0) !== -1)
    return { content: null, skippedReason: 'binary-content' };
  // 快路径：UTF-8 fatal 解码（覆盖 ~99% 源码）
  try {
    let content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    return { content };
  } catch { /* 非 UTF-8，继续 */ }
  // 慢路径：isBinaryFile → jschardet 检测 → iconv-lite 解码
  if (await isBinaryFile(buffer)) return { content: null, skippedReason: 'binary-content' };
  const { encoding: detected } = jschardet.detect(buffer) ?? {};
  const content = iconv.decode(buffer, encoding, { stripBOM: true });
  if (content.includes('\uFFFD')) return { content: null, skippedReason: 'encoding-error' };
  return { content };
};
```
说明：把昂贵的 jschardet/isBinaryFile 推到慢路径，快路径只靠原生 TextDecoder + `Buffer.indexOf(0)`，是处理多编码仓库时性能与正确性兼顾的范本。

---

## Aider RepoMap 深挖卡片

### 一句话定位
tree-sitter 抽定义/引用 → PageRank 排序 → 按 token 预算二分压缩成"代码幽灵图"

### RepoMap 核心架构
- 入口：`aider/repomap.py:42` (`class RepoMap`)
- 关键方法：
  - `get_repo_map` - `aider/repomap.py:103` 公共入口，按是否在 chat 里决定 token 预算，返回拼接好的字符串
  - `get_ranked_tags_map_uncached` - `aider/repomap.py:629` 主流程：拿 ranked tags → 二分搜索 token 上限 → `to_tree` 渲染
  - `get_ranked_tags` - `aider/repomap.py:365` 构图 + 运行 PageRank 的核心
  - `get_tags_raw` - `aider/repomap.py:279` tree-sitter 解析 + scm query 抽 def/ref
  - `to_tree` / `render_tree` - `aider/repomap.py:710` / `748` 抽到的行号 → grep_ast.TreeContext 输出"省略号 + 选中行"的折叠视图
- tree-sitter 集成：依赖外部包 `grep_ast`（`filename_to_lang`、`get_language`、`get_parser`），自己只负责 scm query 文件分发（`get_scm_fname` at `repomap.py:805`）。两套 以及 后端：`tree-sitter-languages` 和 `tree-sitter-language-pack`，按 `USING_TSL_PACK` 切换。Query 通过 `tree_sitter.Query(language, scm_text).captures(root_node)` 运行；兼容 0.23 直接 `query.captures` 和 0.24 的 `QueryCursor`（`_run_captures` at `repomap.py:266`）。
- 符号抽取流程：`get_tags` 缓存检查（mtime） → `get_tags_raw`：① `filename_to_lang` 判语言；② `get_parser(lang).parse(bytes(code,"utf-8"))` 拿 AST；③ 读 `queries/<subdir>/<lang>-tags.scm`；④ `Query.captures(root_node)` 拿到 `{capture_name: [node]}`；⑤ 按 capture name 前缀 `name.definition.` → kind="def"，`name.reference.` → kind="ref"；⑥ 组装 `Tag(rel_fname, fname, line=node.start_point[0], name=node.text, kind)`。若 scm 只产出 def（比如 cpp），退化用 pygments `Token.Name` 当 ref 兜底（`repomap.py:347-363`）。
- 重要性排序：**Personalized PageRank**（`nx.pagerank` at `repomap.py:525`）。
  - 节点：文件（rel_fname）。
  - 边：对每个 ident，每条 `referencer → definer` 加权边：`weight = mul * sqrt(num_refs)`。
  - 权重乘子 `mul`：被 `mentioned_idents` 命中 ×10；长得像真名（snake/kebab/camel 且 len≥8）×10；下划线私有 `_xxx` ×0.1；被定义在 >5 个文件里的"过热"符号 ×0.1；引用者是 chat 文件 ×50（强调"对话上下文相关"）。
  - personalization：chat 文件/mentioned 文件各加 `100/len(fnames)`；mentioned_idents 通过路径组件匹配上再加一份。
  - PageRank 出分后，对每条边分配 `rank = src_rank * weight / out_total_weight`，累加到 `ranked_definitions[(dst, ident)]`，排序后即 ranked tags。无任何 tag 的文件按文件 PageRank 分追加 `(fname,)` 占位。
- 分桶压缩：**二分搜 + 折叠渲染**。
  - `get_ranked_tags_map_uncached` at `repomap.py:676`：从 `middle = max_map_tokens // 25` 起，循环 `to_tree(ranked_tags[:middle])` → `token_count`，若误差 < 15% 就 break，否则按 token 多少二分调 `middle`。
  - `to_tree` 调 `render_tree` 用 `grep_ast.TreeContext`，传入"指关心的行号 lois"，输出长这样（来自 `repomap.md:38-69`）：
    ```
    aider/coders/base_coder.py:
    ⋮...
    │class Coder:
    │    abs_fnames = None
    ⋮...
    │    def run(self, with_message=None):
    ```
    单行截到 100 字符（防 minified js）。
  - `token_count` 用"按步长采样 token 数推算"（`repomap.py:89`），加速大文件估 token。
  - 默认预算 `map_tokens=1024`，聊天里没文件时按 `map_mul_no_files=8` 放大并夹到 `max_context_window - 4096`。
  - 三级缓存：mtime cache（diskcache SQLite，对单文件 Tag 结果）+ `map_cache`（对最终成图）+ `tree_context_cache`/`tree_cache`（对 TreeContext 对象和渲染结果）。

### tree-sitter queries
- 支持语言（共 ~40，分两套后端，`<subdir>/<lang>-tags.scm`）：
  - `tree-sitter-languages/` (28 scm)：python, typescript, scala, rust, ruby, ql, php, ocaml, ocaml_interface, matlab, kotlin, julia, javascript, java, hcl, haskell, go, fortran, elm, elixir, elisp, dart, c_sharp, cpp, c, bash, zig
  - `tree-sitter-language-pack/` (32 scm)：新增 swift, solidity, racket, r, lua, pony, properties, gleam, d, commonlisp, clojure, chatito, arduino, udev；csharp 而非 c_sharp
- query 示例（**Python**，`aider/queries/tree-sitter-languages/python-tags.scm`，12 行）：
  ```scheme
  (class_definition
    name: (identifier) @name.definition.class) @definition.class

  (function_definition
    name: (identifier) @name.definition.function) @definition.function

  (call
    function: [
        (identifier) @name.reference.call
        (attribute
          attribute: (identifier) @name.reference.call)
    ]) @reference.call
  ```
  注意 capture 命名约定：`name.definition.<kind>` / `name.reference.<kind>` —— `get_tags_raw` 直接拿这两个前缀分流到 def / ref。
- 抽取节点类型（跨语言汇总）：
  - 定义：`class_definition`, `function_definition`, `method_declaration`, `method_definition`, `interface_declaration`, `struct_specifier`, `class_specifier`, `enum_specifier`, `type_spec`, `type_definition`, `function_declaration`, `module`-级 `assignment`(常量), `lexical_declaration`(arrow function), `pair`(对象方法)
  - 引用：`call`, `call_expression`, `method_invocation`, `function_call`, `new_expression`, `type_identifier`, `superclass`, `type_list`(impl), `attribute`(a.b)
  - 附加修饰（JS/Go 等用 `#strip!`、`#select-adjacent!`、`#set-adjacent!` 把 doc comment 与定义绑在一起，但 RepoMap 实际只看 `name.definition.*` / `name.reference.*` capture，doc 在最终输出里通过 TreeContext 自然带出）。

### 可复用模块（带 file:line）
1. `RepoMap.get_tags_raw` - 直接拿来当"代码 → (def/ref Tag) 流"的现成 pipeline，含语言分发、scm 加载、Query 运行、pygments fallback。 - `aider/repomap.py:279-363`
2. `RepoMap.get_ranked_tags` - "文件=节点、ident 引用=加权边、Personalized PageRank"思想可直接搬到一个 RAG 工具库的"重要性排序层"，乘子规则（私有/通用/对话内）是现成可调的启发式。 - `aider/repomap.py:365-574`
3. `RepoMap.to_tree` + `RepoMap.render_tree` - 把"行号集合"渲染成 `⋮... ⋮class Foo: ⋮...` 格式的折叠视图，正是一个"代码压缩成 LLM 可读上下文"的实现样板（依赖 `grep_ast.TreeContext`）。 - `aider/repomap.py:710-784`
4. `RepoMap.get_ranked_tags_map_uncached` 的二分搜 token 预算逻辑 - 任何"按 token 上限裁剪输出"的场景都能照抄这套二分。 - `aider/repomap.py:676-703`
5. `get_scm_fname` + `queries/` 目录 - 双后端（`tree-sitter-languages` / `tree-sitter-language-pack`）的 scm 文件分发，可作为多语言 query 注册表的模板。 - `aider/repomap.py:805-829`
6. `RepoMap.tags_cache_error` + `get_tags` mtime cache 模式 - SQLite diskcache + 故障时降级到 dict 的稳健缓存设计，对 RAG 工具的"扫一次仓库后复用"很实用。 - `aider/repomap.py:177-264`
7. `special.filter_important_files` + `ROOT_IMPORTANT_FILES` - 177 项硬编码的"重要配置/清单/CI 文件名"，可直接用作"打包仓库时永远内联"的白名单。 - `aider/special.py:3-203`

### 设计取舍 / 缺口
- **没有调用链 / 控制流图**：边只表达"文件 X 提到了 ident Y，ident Y 定义在文件 Z"，没有按调用点、参数、返回值做类型解析。对"找这个函数被谁调"这类追溯不够精确（只有"被哪些文件提到"）。
- **没有向量检索 / 语义相似度**：纯结构化 PageRank，"想找跟 'user login' 相关的代码"这种自然语言召回做不到，必须靠 `mentioned_idents`（用户手工提）或外部先做语义检索再喂进来。
- **没有"整文件原样保留"策略**：所有文件都走"压缩成符号+签名"的同一种 lossy 渲染。无法配置"这几个核心文件全文内联、其它文件只压缩"——RAG 工具常常要做这种分层。
- **没有分层 / 多分辨率输出**：只有一套粒度（类/函数签名级别）。无法按需输出"模块级摘要 vs 函数级细节 vs 全文"三档。`map_tokens` 是单一标量、不能按目录/语言/优先级分配预算。
- **没有跨仓 / 依赖仓库信息**：只在当前 repo 文件集合里赋分，外置库（pip/npm 包）的符号不会进图，理解"A 调用了 B 库的 X"完全靠训练知识。
- **没有增量更新**：单文件 mtime 一变整文件重 parse；没有 AST diff、没有 re-rank 增量。初审大仓很慢（代码自己也提示 `Initial repo scan can be slow`，`repomap.py:391-395`）。
- **def-only 语言降级到 pygments token 兜底**（cpp 等）会把所有 `Token.Name` 都算 ref（包括变量名），噪声大、可能误导 PageRank。
- **rank 分配粒度粗**：`ranked_definitions[(dst, ident)]` 只给"定义点"打分，调用点的位置不影响顺序，无法精细到"挑选哪个调用片段进上下文"。
- **`mentioned_idents` 匹配只靠路径组件/标识符完全相等**，没有 fuzzy 或 AI 辅助消歧（同名类、动态查找等不可靠）。
- **token 估算用采样近似**（`repomap.py:89-101`），对爆量注释/空行文件可能偏高偏低，影响二分收敛精度。

### 关键代码片段

**片段 1：PageRank 边权重 + personalization 的核心启发式**（`aider/repomap.py:481-525`）
```python
for ident in idents:
    definers = defines[ident]
    mul = 1.0
    is_snake = ("_" in ident) and any(c.isalpha() for c in ident)
    is_kebab = ("-" in ident) and any(c.isalpha() for c in ident)
    is_camel = any(c.isupper() for c in ident) and any(c.islower() for c in ident)
    if ident in mentioned_idents:
        mul *= 10
    if (is_snake or is_kebab or is_camel) and len(ident) >= 8:
        mul *= 10
    if ident.startswith("_"):
        mul *= 0.1
    if len(defines[ident]) > 5:
        mul *= 0.1
    for referencer, num_refs in Counter(references[ident]).items():
        for definer in definers:
            use_mul = mul
            if referencer in chat_rel_fnames:
                use_mul *= 50
            num_refs = math.sqrt(num_refs)
            G.add_edge(referencer, definer, weight=use_mul * num_refs, ident=ident)
...
ranked = nx.pagerank(G, weight="weight", **pers_args)
```
说明：核心创新点不在算法本身（普通 PageRank），而是这套"私有/通用/对话内/长真名"乘子——非常容易照搬到自己的 RAG 排序层。

**片段 2：二分搜索裁剪到 token 预算**（`aider/repomap.py:676-703`）
```python
middle = min(int(max_map_tokens // 25), num_tags)
while lower_bound <= upper_bound:
    tree = self.to_tree(ranked_tags[:middle], chat_rel_fnames)
    num_tokens = self.token_count(tree)
    pct_err = abs(num_tokens - max_map_tokens) / max_map_tokens
    ok_err = 0.15
    if (num_tokens <= max_map_tokens and num_tokens > best_tree_tokens) or pct_err < ok_err:
        best_tree = tree
        best_tree_tokens = num_tokens
        if pct_err < ok_err:
            break
    if num_tokens < max_map_tokens:
        lower_bound = middle + 1
    else:
        upper_bound = middle - 1
    middle = int((lower_bound + upper_bound) // 2)
```
说明：把"取 Top-K 符号"和"token 上限"解耦——简单粗暴但有效的 token-budget fitting，可直接复用到"打包代码到 LLM"工具的输出阶段。

**片段 3：tree-sitter capture → Tag 流**（`aider/repomap.py:299-336`，节选）
```python
tree = parser.parse(bytes(code, "utf-8"))
captures = self._run_captures(Query(language, query_scm), tree.root_node)
...
for node, tag in all_nodes:
    if tag.startswith("name.definition."):
        kind = "def"
    elif tag.startswith("name.reference."):
        kind = "ref"
    else:
        continue
    saw.add(kind)
    yield Tag(
        rel_fname=rel_fname, fname=fname,
        name=node.text.decode("utf-8"),
        kind=kind, line=node.start_point[0],
    )
# 若只有 def 没 ref -> pygments 兜底（cpp 等情况）
if "ref" in saw: return
if "def" not in saw: return
lexer = guess_lexer_for_filename(fname, code)
tokens = [tok[1] for tok in lexer.get_tokens(code) if tok[0] in Token.Name]
for tok in tokens:
    yield Tag(rel_fname, fname, tok, "ref", -1)
```
说明：tree-sitter 抽象层极浅——把 scm query 的 capture 名约定（`name.definition.*` / `name.reference.*`）直接当成类型标签，再加 pygments 兜底，是值得借鉴的"小而美"集成模式。

---

## CodeGraph 深挖卡片

### 一句话定位
本地 SQLite + tree-sitter 的代码图谱 MCP 服务

### 核心架构
- **入口**：`src/index.ts:128`（`Codegraph` 类，对外唯一 API surface）；CLI 入口 `src/bin/codegraph.ts`；MCP 入口 `src/mcp/index.ts`
- **主要模块**（`src/` 下）：
  - `extraction/` — tree-sitter WASM 解析 + 每语言一个 extractor + 独立 worker 线程
  - `db/` — SQLite 适配（better-sqlite3 原生 / node-sqlite3-wasm 回退）+ `schema.sql` + `QueryBuilder` 预编译语句
  - `resolution/` — `ReferenceResolver` 编排 import-resolver / name-matcher / 13 个 framework resolvers / path-aliases
  - `graph/` — `GraphTraverser`（BFS/DFS/impact/path）+ `GraphQueryManager`（高层查询）
  - `context/` — `ContextBuilder` + `formatter.ts`（markdown/json）
  - `search/` — FTS5 查询解析 + 路径相关性打分
  - `sync/` — 原生 OS 文件事件 watcher（FSEvents/inotify/RDCW）+ git hook
  - `mcp/` — MCP server + 8 个工具定义
  - `installer/` — 多 agent 安装器（Claude/Cursor/Codex/opencode）
- **索引构建流程**（`src/extraction/index.ts:512` `indexAll`）：
  1. **扫描**：`scanDirectoryAsync` — git 仓库用 `git ls-files -c --recurse-submodules` + `git ls-files -o --exclude-standard`（尊重 .gitignore，递归嵌套 repo），非 git 项目回退 fs.walk；按 `config.include/exclude`（picomatch）过滤
  2. **框架检测**：`detectFrameworks` 一次性扫描文件特征
  3. **解析**：spawn `parse-worker.js` worker 线程，按 `FILE_IO_BATCH_SIZE=10` 并行读文件、串行送入 worker；worker 内 `extractFromSource` → tree-sitter WASM 解析 → 产出 nodes/edges/unresolvedRefs
  4. **WASM 内存回收**：每 `WORKER_RECYCLE_INTERVAL=250` 文件 recycle worker；超时 `PARSE_TIMEOUT_MS=10s + 10s/100KB` 终止；失败重试（fresh worker → strip 注释 → 再试）
  5. **存储**：`storeExtractionResult` — content hash 去重，delete-then-insert 单文件，批量 `insertNodes/insertEdges/insertUnresolvedRefsBatch` + `upsertFile`
  6. **解析引用**：`resolveReferencesBatched` — 把 unresolved_refs 解析成真实 edges（calls/imports/extends/references）
  7. **sync 增量**（`src/extraction/index.ts:1231`）：`git status --porcelain` 快路径，无 git 则全扫 + hash 对比
- **tree-sitter 集成**（与 Aider 不同点）：
  - 用 **`web-tree-sitter` (WASM)** 而非 native binding — 跨平台零编译，grammar 文件来自 `tree-sitter-wasms` 包；Pascal/Scala 自带 WASM
  - **声明式 extractor 配置**（`src/extraction/tree-sitter-types.ts:80` `LanguageExtractor` interface）— 每语言只填 `functionTypes/classTypes/...` 数组 + 可选 hook（`getSignature/getVisibility/extractImport/extractVariables/getReceiverType/resolveTypeAliasKind/extractBareCall` 等），新增语言 = 一个文件 + `EXTRACTORS` map 加一行（`src/extraction/languages/index.ts:27`）
  - **非 tree-sitter 语言**走独立 extractor：`svelte-extractor.ts`/`vue-extractor.ts`（抽 script 块后委托给 TS/JS grammar）、`liquid-extractor.ts`（regex）、`dfm-extractor.ts`（Delphi 表单）
  - Aider 只用 tree-sitter 做"找定义/引用"的 repo-map，Codegraph 把 AST 持久化为 SQLite 图谱并支持调用链 BFS/impact 半径
  - WASM heap 用 worker 隔离 + 周期性 terminate 回收（WASM 线性内存只涨不缩）

### SQLite schema
- **表结构**（`src/db/schema.sql`）：
  - `nodes`（`:20`）— `id(PK, hash), kind, name, qualified_name, file_path, language, start_line, end_line, start_column, end_column, docstring, signature, visibility, is_exported, is_async, is_static, is_abstract, decorators(JSON), type_parameters(JSON), updated_at`
  - `edges`（`:44`）— `id(auto), source(FK), target(FK), kind, metadata(JSON), line, col, provenance('tree-sitter'|'scip'|'heuristic')`；ON DELETE CASCADE
  - `files`（`:58`）— `path(PK), content_hash, language, size, modified_at, indexed_at, node_count, errors(JSON)`
  - `unresolved_refs`（`:70`）— `id, from_node_id(FK), reference_name, reference_kind, line, col, candidates(JSON), file_path, language`（冗余 file_path/language 提速 resolution）
  - `schema_versions`、`project_metadata`
  - **FTS5 虚表** `nodes_fts`（`:97`）— 索引 `id, name, qualified_name, docstring, signature`，`content='nodes'` external content；三个触发器 `nodes_ai/ad/au`（`:108-123`）保持同步
- **索引设计**（`:86-144`）：
  - `idx_nodes_kind / name / qualified_name / file_path / language / file_line(file_path,start_line) / lower_name(lower(name))`
  - edges：**故意省略** 单列 `source/target` 索引，改用 `(source,kind)` 和 `(target,kind)` 复合索引（左前缀覆盖单列查询）— Migration v4 删除冗余索引
  - `idx_edges_kind / idx_edges_provenance`
  - `idx_unresolved_from_node / name / file_path / (from_node_id, reference_name)`
- **存储取舍**：
  - 只存 AST 派生的**符号元数据 + 关系**，不存源码正文（context 时按 `start_line/end_line` 回文件读）— DB 体积小
  - unresolved_refs 表把"二阶段解析"显式持久化，避免内存 OOM；resolution 后转成 edges
  - FTS5 external-content 模式 + 触发器同步，避免冗余存文本
  - 用 `provenance` 字段标记 edge 来源（tree-sitter/heuristic），方便后续置信度筛选
  - 节点 ID = `hash(file_path + qualified_name)` — 跨重新索引稳定，支持 upsert 语义

### 查询能力
- **符号搜索**（`src/db/queries.ts:481` `searchNodes` → `src/index.ts:653`）：
  - 三级降级：FTS5 前缀匹配（`:695`，BM25 列权重 `name=20, qualified_name=5, docstring=1, signature=2`，5x over-fetch）→ LIKE 子串（`:764`）→ 模糊 Levenshtein（`:636`，`maxDist≤2`）
  - 补丁：保证**精确名匹配**必入候选（BM25 会埋掉短名）；多信号重排：`bm25 + kindBonus + scorePathRelevance + nameMatchBonus`
  - 支持 `kind:lang:path:name:` field-qualified 查询（`src/search/query-parser.ts`）
  - `findNodesByExactName`（`:830`）、`findNodesByNameSubstring`（`:918`，CamelCase 边界用）
- **调用链**（`src/graph/traversal.ts`）：
  - `getCallers`（`:236`）— 沿 `incoming edges of kind [calls, references, imports]` 递归 BFS，`maxDepth` 默认 1
  - `getCallees`（`:275`）— 沿 `outgoing edges of kind [calls, references, imports]` 递归
  - `getCallGraph`（`:314`）— 双向合并，默认 depth=2
  - `findUsages`（`:431`）— 所有 incoming edges
- **影响范围**（`src/graph/traversal.ts:456` `getImpactRadius`）：
  - 沿 incoming edges 反向 BFS，默认 `maxDepth=3`
  - **关键技巧**：对容器节点（class/interface/struct/trait/protocol/module/enum）先沿 `contains` 下钻到子方法（同 depth），再反向追调用者 — 改一个类的方法能波及到调用该方法的所有 caller
- **context 构建**（`src/context/index.ts:181` `ContextBuilder`）：
  - `buildContext`（`:210`）：`findRelevantContext` → `getEntryPoints` → `extractCodeBlocks` → `getRelatedFiles` → `generateSummary` → `formatContextAsMarkdown/Json`
  - `findRelevantContext`（`:284`）— **混合搜索**：
    1. `extractSymbolsFromQuery`（`:43`）从自然语言抽 CamelCase/snake_case/SCREAMING/dot.notation/acronym 标识符，过滤 common English words
    2. `findNodesByExactName` 精确匹配 + **co-location boost**（同文件多 symbol 命中加分）+ stem 变体（"caching"→"cache"）
    3. 标题化前缀匹配定义类（"REST"→`RestController`）+ 简短名优先
    4. FTS5 多 term 搜索 + 多 term 共现加权
    5. **CamelCase 边界 LIKE**（`findNodesByNameSubstring`）— FTS 找不到 "Search" in "TransportSearchAction"，LIKE + CamelCase 边界检测能找到；多 term 在 CamelCase 边界共现 → 强 boost
    6. **复合 term 匹配** — 类名含 2+ query term（任意位置）即高分
    7. 去重 max score 合并 → minScore 过滤 → `resolveImportsToDefinitions` 把 import 节点解析成真实定义
    8. 类/接口 entry point 专门跑 `getTypeHierarchy` 扩展父类/子类（两 pass，预算 `maxNodes/4`）
    9. 每 entry point `traverseBFS` depth=1 both direction，limit = `maxNodes/entryPoints`
    10. **Per-file diversity cap**（每文件 ≤20% 预算）+ 非 production 文件 cap（test ≤15%）
    11. **Edge recovery**：`findEdgesBetweenNodes`（`src/db/queries.ts:1054`，`json_each` 一次查回选中节点间所有边）恢复 BFS 留下的断连
  - `getCode`（`:921`）/ `extractNodeCode`（`:933`）— 按节点 start/end line 回文件切片
  - `codegraph_explore`（`src/mcp/tools.ts:820` `handleExplore`）— MCP 专用的"一次调用深挖"：`findRelevantContext(searchLimit:8, depth:3, maxNodes:200)` → 按文件分组打分（entry=10, connected=3, other=1）→ 按 query term 相关性 + 低价值文件降级排序 → **聚类读连续源码段**（不是零散 snippet）— 按行号聚类、合并相邻 range（gap 阈值自适应），按 importance 评分裁剪；**输出预算自适应项目大小**（`getExploreOutputBudget` `:88`：<500 文件 18k 字符/5 文件；<5k → 28k/9 文件；<15k → 35k/12 文件；≥25k → 50k/20 文件）

### 可复用模块（带 file:line）
1. **`LanguageExtractor` interface + `EXTRACTORS` map**（`src/extraction/tree-sitter-types.ts:80` + `src/extraction/languages/index.ts:27`）— 声明式 per-language 配置，新增语言只需一个文件 + 一行注册；hook 系统（`extractImport/extractVariables/getReceiverType/resolveTypeAliasKind/extractBareCall`）覆盖各语种 AST 差异。借鉴价值：做"多语言扩展性"的范本。
2. **WASM worker 生命周期管理**（`src/extraction/index.ts:602-732` + `parse-worker.ts`）— worker 线程隔离 + `WORKER_RECYCLE_INTERVAL` 周期回收 + `PARSE_TIMEOUT_MS` 缩放 + WASM OOM 后 fresh worker 重试 + strip 注释二次重试。借鉴价值：任何用 web-tree-sitter 处理大 repo 的工具都需要这套内存兜底。
3. **混合搜索 + CamelCase 边界匹配 + 多 term 共现加权**（`src/context/index.ts:284-911`）— FTS5 + LIKE + 模糊 + 路径相关性 + co-location + stem 变体 + compound term，全是 zero-embedding 的纯 SQL + JS 启发式。借鉴价值：做 Code RAG 的"无向量检索"基线。
4. **`findEdgesBetweenNodes` + Edge recovery**（`src/db/queries.ts:1054` + `src/context/index.ts:894-908`）— `json_each` 一次性查回选中节点集的所有内部边，修复 BFS 多 entry point 留下的断连子图。借鉴价值：从子图重建连通性的高效 SQL 技巧。
5. **`getImpactRadius` 容器节点下钻**（`src/graph/traversal.ts:456-522`）— 对 class/interface 先沿 `contains` 同 depth 下钻到方法再反向追调用者，避免"改类的方法"时漏报 caller。借鉴价值：impact analysis 的语义正确性细节。
6. **content-hash + git fast path 增量 sync**（`src/extraction/index.ts:1231-1372` + `getGitChangedFiles:233`）— `git status --porcelain` 只 hash changed 文件，untracked 也 hash 对比避免循环重索引。借鉴价值：增量索引的工程实践。

### 设计取舍 / 缺口（Codegraph 没做但用户需要的）
- **无向量检索 / embedding**：纯 FTS5 + LIKE + Levenshtein + 启发式打分。`errors.ts` 里导出了 `VectorError` 但无实现。要做"语义 RAG"需���自己加 embedding 列 + 向量索引（sqlite-vec / chroma 等）。
- **无"打包输出"能力**：`buildContext`/`explore` 输出是给 LLM 直接看的 markdown 片段，**不是 Repomix 式的整仓 single-file 打包**。无 `pack`/`bundle` 命令，无 XML 标签包裹的文件清单输出。用户要的"压缩成一份上下文文件"需另写 formatter（`src/context/formatter.ts` 可作模板）。
- **无 token 计数 / 预算控制**：只有字符数 cap（`maxCodeBlockSize=1500`, `maxOutputChars` 按 fileCount 分档）。没有 tokenizer 集成，无法按 token 精确控预算。大文件靠 `... (truncated) ...` 硬切。
- **无跨仓库 / 全局索引**：每个项目独立 `.codegraph/` 目录，MCP 跨项目查询靠 `projectPath` 参数 lazy open + cache（`src/mcp/tools.ts:441`），但**没有跨仓的符号 join**。monorepo 内嵌 git repo 会递归索引（`collectGitFiles`），但不做跨独立 repo 的依赖图。
- **resolution 是启发式而非精确**：name-matcher + import-resolver + framework pattern，**不做完整类型推断 / 类型解析**。重载、动态 dispatch、反射调用、宏生成的代码都会漏。`provenance` 字段留了 `scip` 占位但未实现 SCIP 索引接入。
- **无文档/注释 embedding**：`extractDocstrings: true` 只把 docstring 存进 FTS5 索引列，不向量化；"用自然语言找代码"靠 term 匹配 + CamelCase 启发，语义弱。
- **图遍历无环路检测 / 性能保护**：BFS/DFS 用 `visited` Set 防死循环，但深度爆炸 / 超大节点集只有 `limit` 默认 1000 兜底，无按图规模自适应的剪枝。

### 关键代码片段

**片段 1 — FTS5 external-content + 触发器同步**（`src/db/schema.sql:97-123`）
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id, name, qualified_name, docstring, signature,
    content='nodes', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualifiedName, NEW.docstring, NEW.signature);
END;
-- nodes_ad (delete) / nodes_au (update: delete+insert) 同理
```
*说明：external-content FTS5 避免文本冗余存储，触发器保证一致性。BM25 列权重在 `searchNodesFTS`（`queries.ts:727`）里设 `bm25(nodes_fts, 0, 20, 5, 1, 2)` — name 列权重 20 远高于 docstring 1，确保按符号名精确匹配优于文档 INCIDENTAL 命中。*

**片段 2 — impact radius 容器下钻**（`src/graph/traversal.ts:493-509`）
```typescript
const containerKinds = new Set(['class', 'interface', 'struct', 'trait', 'protocol', 'module', 'enum']);
if (containerKinds.has(focalNode.kind)) {
  const containsEdges = this.queries.getOutgoingEdges(nodeId, ['contains']);
  for (const edge of containsEdges) {
    const childNode = this.queries.getNodeById(edge.target);
    if (childNode && !visited.has(childNode.id)) {
      nodes.set(childNode.id, childNode);
      edges.push(edge);
      // 同 depth 递归 — 子方法是同一"符号"的一部分
      this.getImpactRecursive(childNode.id, maxDepth, currentDepth, nodes, edges, visited);
    }
  }
}
```
*说明：改一个 class 的字段，要能波及到所有调用该 class 任何方法的 caller。先下钻到所有方法（同 depth 不消耗 depth 预算），再对每个方法反向追 incoming edges。这是 impact analysis 语义正确性的关键细节。*

**片段 3 — 混合搜索的 CamelCase 边界 + 多 term 加权**（`src/context/index.ts:614-622`）
```typescript
// camelNodeTerms: Map<nodeId, { result, termCount }>
// 一个类名在 CamelCase 边界命中 3 个 query term → 几乎必是目标
for (const [, info] of camelNodeTerms) {
  info.result.score = info.result.score * (1 + info.termCount) + (info.termCount - 1) * 30;
  camelResults.push(info.result);
}
```
*说明：FTS5 把 `TransportSearchAction` 当成一个 token，搜 "search" 命中不到。用 `findNodesByNameSubstring`（LIKE）拉大批候选 → 过滤 CamelCase 边界（前一个字符是字母）→ 按 path relevance + 简短名打分 → 多 term 在同一类名 CamelCase 边界共现给 `(termCount-1)*30` 的强 boost。这是无 embedding 做"语义-ish"检索的典型工程技巧。*

---

## llm-context 深挖卡片

### 一句话定位
规则驱动的分层代码上下文压缩器

### 核心架构
- **CLI 命令**：`lc-init`(初始化)、`lc-select`(选文件)、`lc-context`(生成上下文)、`lc-outlines`(仅大纲)、`lc-missing`(按需取文件/实现/排除段)、`lc-changed`(变更检测)、`lc-set-rule`(切规则)、`lc-prompt`、`lc-rule-instructions`、`lc-version`、`lc-mcp`(MCP server)。入口在 `cli.py`，经 `cmd_pipeline.py` 装饰器（with_env / with_clipboard / with_print / with_error）组装成"读环境→执行→剪贴板→打印"流水线。
- **主要模块**（`src/llm_context/`）：`cli.py`(入口) / `commands.py`(高层命令) / `cmd_pipeline.py`(装饰器流水线) / `exec_env.py`(ContextVar 执行环境) / `context_spec.py`(项目配置+规则) / `context_generator.py`(Jinja 渲染核心) / `rule.py`+`rule_parser.py`(规则系统) / `file_selector.py`(gitignore 选择) / `overviews.py`(full/focused 总览) / `state.py`(选区持久化) / `project_setup.py`(初始化脚手架) / `mcp.py`(FastMCP) / `excerpters/`(tree-sitter 摘要子包) / `utils.py`(Yaml/PathConverter/ProjectLayout)。
- **关键类/函数**：
  - `ContextGenerator` — 主渲染器，组装 overview+files+excerpts+implementations 并渲染 context.j2（`context_generator.py:170`）
  - `RuleResolver` — 递归规则组合，带环检测（`rule.py:182`，核心方法 `_compose_rule_config` 在 `rule.py:217`）
  - `CodeOutliner` — tree-sitter 大纲生成，█/⋮... 行级压缩（`excerpters/code_outliner.py:12`）
  - `ASTBasedTagger` + `ASTFactory` — 缓存的 tree-sitter 解析与定义提取（`excerpters/tagger.py:65`、`excerpters/parser.py:59`）
  - `ExecutionEnvironment` — 基于 ContextVar 的全局 env，携带 config/state/tagger（`exec_env.py:86`）

### 分层上下文机制
- **full / outline / selected 三层实现**：分层不是独立模式，而是 `FileSelection` 的两个字段并存（`state.py:12`：`full_files` + `excerpted_files`）。`ContextSelector` 用两套独立的 `FileSelector` 分别按 `gitignores["full-files"]`/`["excerpted-files"]` 选文件（`file_selector.py:183`，`select_full_files` 在 :214，`select_excerpted_files` 在 :227，自动去重：excerpted 中已属 full 的被移走）。第四态 `✗`（excluded）由 overview 标注。状态码 `✓/O/E/✗` 在 `overviews.py:9` 定义。
- **outline excerpting**：纯 **tree-sitter**（依赖 `tree-sitter` + `tree-sitter-language-pack`），非正则。`CodeOutliner._format_content`（`code_outliner.py:44`）用 `.scm` 查询抓 `@definition.class/function/constant` 的起始行，行级输出：定义行前缀 `█`，省略行用 `⋮...`。**支持 14 种语言**（`language_mapping.py:32` `_tag_languages`）：c, cpp, csharp, elisp, elixir, elm, go, java, javascript, php, python, ruby, rust, typescript（TS 复用 js 查询+ts 查询）。另有两种专用 excerpter：`Markdown`（按 heading/code/list/table 抽取，`excerpters/markdown.py:20`）和 `Sfc`（svelte/vue 抽 script 段，可配置 with-style/with-template，`excerpters/sfc.py:22`）。查询文件位于 `excerpters/ts-qry/*.scm`（如 `python-tags.scm` 仅 4 条 pattern 捕获 class/function/constant/reference.call）。
- **分层切换/组合**：通过规则组合实现——`flt-no-full`（`gitignores.full-files:["**/*"]` 关闭 full 层）、`flt-no-outline`（关闭 excerpted 层）、`flt-no-files`（组合前两者，全关）。`overview` 字段还可切 `full`/`focused` 两种总览视图（`overviews.py:61`/`:83`，focused 只对含 included 文件的文件夹展开详情）。运行时 `lc-set-rule` 触发 `env.with_rule`（`exec_env.py:130`）重建选区。

### Rule 系统
- **schema**（YAML frontmatter + markdown body，`rule_parser.py:31` 正则提取）：`name`、`description`、`overview`(full/focused)、`instructions`(list，引用 ins-/sty- 规则的 markdown 内容拼接)、`compose`({filters:[], excerpters:[]})、`gitignores`({overview-files/full-files/excerpted-files: [patterns]})、`limit-to`(同结构，白名单)、`also-include`(同结构，强制包含)、`implementations`([(path, name)])、`excerpt-modes`({glob: mode})、`excerpt-config`({mode: {config}})。`Rule.from_config`（`rule.py:48`）解析。
- **组合机制**：`RuleResolver._compose_rule_config`（`rule.py:217`）递归解析 `compose.filters` 与 `compose.excerpters`，对每个被引用规则调 `get_rule`，再用 `_merge_gitignores`/`_merge_limit_to`/`_merge_also_include`/`_merge_excerpt_modes`/`_merge_excerpt_config` 合并（`rule.py:287-328`）。**环检测**用 `_composition_stack: frozenset`（`rule.py:185`），入栈时检测重复。`instructions` 字段优先：若存在则拼接所引用 ins- 规则的 markdown body，否则用自身 body（`rule.py:222-235`）。`limit-to` 冲突时保留首个并 WARNING（`rule.py:295`），其他字段累加去重。
- **5 类规则职责**：
  - `prm-`（Prompt）：顶层入口规则，组合 filters+excerpters+instructions，生成完整上下文（`prm-developer`、`prm-rule-create`）
  - `flt-`（Filter）：纯 gitignores/limit-to 控制文件纳入，可被 prm- 组合（`flt-base` 大量二进制/锁文件排除、`flt-no-full`/`flt-no-outline`/`flt-no-files` 关层）
  - `ins-`（Instruction）：markdown body 作为 instructions 文本注入 prompt（`ins-developer` 人设、`ins-rule-framework` 规则创建框架）
  - `sty-`（Style）：编码规范类 instruction（`sty-python`/`sty-code`/`sty-javascript`/`sty-jupyter`）
  - `exc-`（Excerpt）：纯 `excerpt-modes`+`excerpt-config`，定义 glob→excerpter 映射（`exc-base` 把 `*.py→code-outliner`、`*.md→markdown`、`*.svelte→sfc`）

### MCP 集成
- **暴露 tools**（`mcp.py`，FastMCP，4 个）：`lc_changed`(root_path, timestamp→变更文件列表)、`lc_outlines`(root_path→所有支持文件的摘要)、`lc_rule_instructions`(root_path→规则创建教程)、`lc_missing`(root_path, param_type, data, timestamp→统一按需取上下文)。每个 tool 内 `ExecutionEnvironment.create(Path(root_path))` + `with env.activate()`。
- **lc_missing 机制**：`param_type` 三态——`f`(files)、`i`(implementations)、`e`(excluded)。核心在 `ContextGenerator.missing_files`（`context_generator.py:246`）：用 `timestamp` 从 `AllSelections` 找匹配历史选区（`state.py:55`），将请求路径分四类：`already_included`(原 full)、`already_excerpted`(原 excerpted，附 metadata 提示用 -i/-e 取详情)、`files_to_fetch`(missing ∪ modified，按 `is_newer` 判 modified)、`deleted_files`。输出用 `missing-files.j2` 模板，文件内容以 `॥๛॥` 分隔符包裹（`missing-files.j2:25`）。`-i` 走 `tagger.extract_definitions` + `find_definition`（`tagger.py:97`）返回指定函数/类的源码；`-e` 走 excerpter 的 `excluded()` 方法返回被省略段（如 SFC 的 style/template、markdown 的段落）。模板还区分 `tools_available`：MCP 模式输出 JSON 调用示例，非 MCP 输出 `lc-missing` bash 命令（`overview.j2:32-85`）。

### 可复用模块（带 file:line）
1. **`RuleResolver` + `_compose_rule_config`** — 递归规则组合 + 环检测 + 字段合并策略，可复用为任意"声明式 YAML 规则组合"引擎（`rule.py:182`、`rule.py:217`）
2. **`ASTFactory` + `ASTBasedTagger`** — 带缓存的 tree-sitter 解析与定义提取，语言扩展只需加 `.scm` 查询文件（`excerpters/parser.py:59`、`excerpters/tagger.py:65`）
3. **`CodeOutliner._format_content`** — 行级大纲压缩（█/⋮... 模式），极简且语言无关，可直接复用为代码压缩基类（`excerpters/code_outliner.py:44`）
4. **`GitIgnorer`** — 层级化收集项目内所有 `.gitignore` 并按目录深度排序匹配，比单层 pathspec 更准确（`file_selector.py:30`）
5. **`ContextGenerator.missing_files`** — 基于 timestamp 的按需取文件+变更检测+四分类输出，是"会话内增量补上下文"的范本（`context_generator.py:246`）

### 设计取舍 / 缺口
- **无向量检索/语义搜索**：文件选择全靠 gitignore pattern + fnmatch（`rule.get_excerpt_mode` 用 `fnmatch.fnmatch`，`rule.py:91`），无 embedding，无法按语义相关度排序/召回。
- **无调用链/依赖图**：tree-sitter 只抓扁平定义（class/function/constant + reference.call capture 但未建图），不做跨文件调用链、import 图、影响面分析。
- **无 token 预算控制**：`_format_size` 仅用于日志展示（`utils.py:97`、`cmd_pipeline.py:50`），生成时不测量/截断/优先级排序，超长只能靠人调规则。
- **无跨仓库支持**：单 `project_root`，`PathConverter` 强制 `/project-name/` 前缀（`utils.py:140`），不支持多 repo 聚合或 monorepo 子项目独立规则。
- **无增量/diff 上下文**：`lc-changed`（`commands.py:33`）只列出 Added/Modified/Removed 文件名，不生成 diff 内容；`missing_files` 按 mtime 判变更，无 git diff 集成。
- **无索引持久化**：每次 `excerpt` 都重新 tree-sitter 解析（`ASTFactory` 缓存仅限单次运行内），不落盘 AST/定义索引，大仓库重复成本高。
- **规则编辑需手动写 YAML**：虽有 Claude Skill 辅助，但规则本身无 schema 校验/IDE 提示，`excerpt-config` 重复 key（如 `exc-base.md` 出现两次 `excerpt-config`）会被 YAML 静默后者覆盖。

### 关键代码片段

**1. tree-sitter 大纲压缩核心**（`excerpters/code_outliner.py:44-60`）— 用 █ 标定义行、⋮... 标省略段，是分层 outline 的灵魂：
```python
def _format_content(self, source: Source, definitions: list[Definition]) -> str:
    code_lines = source.content.split("\n")
    lines_of_interest = sorted(
        [tag.name.begin.ln if tag.name else tag.begin.ln for tag in definitions]
    )
    show_lines = sorted(set(lines_of_interest))
    formatted_lines = []
    for i, line in enumerate(code_lines):
        is_line_of_interest = i in lines_of_interest
        should_show_line = i in show_lines
        if should_show_line:
            line_prefix = "█" if is_line_of_interest else "│"
            formatted_lines.append(f"{line_prefix}{line}")
        else:
            if i == 0 or (i - 1) in show_lines:
                formatted_lines.append("⋮...")
    return "\n".join(formatted_lines)
```

**2. 规则递归组合 + 环检测**（`rule.py:199-219`）— compose 字段驱动，frozenset 栈防循环：
```python
def get_rule(self, rule_name: str) -> Rule:
    if rule_name in self._composition_stack:
        raise ValueError(
            f"Circular composition detected: {' -> '.join(self._composition_stack)} -> {rule_name}"
        )
    try:
        rule = self.rule_loader.load_rule(rule_name)
        composed_config = self._compose_rule_config(rule, rule_name)
        return Rule.from_config(composed_config)
    except RuleResolutionError:
        raise
    # ...

def _compose_rule_config(self, rule: RuleParser, rule_name: str) -> dict[str, Any]:
    new_resolver = RuleResolver(
        self.system_state, self.rule_loader, self._composition_stack | {rule_name}
    )
```

**3. 按需取文件的四分类**（`context_generator.py:253-273`）— 用 timestamp 找历史选区，区分 missing/modified/deleted/already，是 MCP 增量补全的关键：
```python
orig_full = set(matching_selection.full_files)
orig_excerpted = set(matching_selection.excerpted_files)
abs_paths = self.converter.to_absolute(paths)
deleted_files = {
    r for r, a in zip(paths, abs_paths)
    if (r in orig_full or r in orig_excerpted) and not Path(a).exists()
}
missing_files = {
    r for r, a in zip(paths, abs_paths)
    if r not in orig_full and r not in orig_excerpted and Path(a).exists()
}
modified_files = {
    r for r, a in zip(paths, abs_paths)
    if (r in orig_full or r in orig_excerpted)
    and Path(a).exists() and is_newer(a, timestamp)
}
files_to_fetch = missing_files | modified_files
```
