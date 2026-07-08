# 第二批深挖卡片（差异化能力 3 项目）

> 用途：为"全面 Code RAG 工具库"提供可复用模块清单 + 差异化机会对照
> 仓库位置：`_reference/{code2prompt, files-to-prompt, tabby}/`
> 配套：第一批见 `batch1_deepdive.md`（Repomix / Aider RepoMap / CodeGraph / llm-context）

---

## code2prompt 深挖卡片

### 一句话定位
Handlebars 模板驱动的 Rust 仓库打包器

### 核心架构
- 入口：`crates/code2prompt/src/main.rs:30`（`#[tokio::main] async fn main`），分流 TUI / CLI 两条路径（main.rs:49-58）
- 主要模块（`crates/code2prompt-core/src/`）：
  - `session.rs` — 工作流编排器（加载→渲染→计数）
  - `configuration.rs` — `Code2PromptConfig` + Builder + TOML 反序列化
  - `path.rs` — 三阶段目录遍历与文件处理
  - `template.rs` — Handlebars 设置与渲染
  - `git.rs` — 基于 git2 的 diff/log 抓取
  - `entity_map.rs` — 可选 tree-sitter 实体抽取（通过 sem-core）
  - `file_processor/` — 按扩展名分派的内容处理器（csv/tsv/jsonl/ipynb/default）
  - `filter.rs` + `selection.rs` — glob 过滤 + 用户动作 A,A',B,B' 优先级引擎
  - `tokenizer.rs` — tiktoken-rs token 计数
  - `analysis.rs` — dust 风格 token-map 拓扑分析
  - `builtin_templates.rs` — 13 个内嵌 .hbs 任务模板
- 关键类/函数：
  - `Code2PromptSession` — `crates/code2prompt-core/src/session.rs:55`
  - `TemplateContext<'a>` — `session.rs:77`（零拷贝借用 + `#[serde(flatten)]` 用户变量）
  - `traverse_directory` — `path.rs:77`（discover→process_parallel→assemble 三阶段）
  - `handlebars_setup` / `render_template` — `template.rs:69` / `template.rs:162`
  - `extract_entities` — `entity_map.rs:52`（feature gate 双实现）

### Handlebars 模板系统
- 变量/helper（`template.rs:108-119` 注册白名单 + `session.rs:77-105` 字段）：
  - `absolute_code_path`、`source_tree`、`files`（数组）、`path`、`code`、`extension`、`no_codeblock`、`git_diff`、`git_diff_branch`、`git_log_branch`、`code_map`（实体聚合）
  - 用户变量：通过 `user_variables: &'a HashMap<String,String>` + `#[serde(flatten)]` 注入（session.rs:101-102）
  - helper 仅用 Handlebars 内置 `{{#each}}` / `{{#if}}` / `{{#unless}}` / `{{#if code}}` 等，未注册自定义 helper（template.rs:69-78 只设了 `no_escape`）
- 加载渲染机制：
  - 默认模板用 `include_str!` 编译进二进制（md: `session.rs:376`；xml: `session.rs:378`）
  - `handlebars_setup` 注册模板字符串到指定 name → `render_template` 渲染并 `trim()`（template.rs:167-170）
  - JSON 输出格式时把渲染结果再包成 `{prompt, directory_name, token_count, files, code_map}`（session.rs:406-417）
- 自定义模板机制（三条路径）：
  - CLI `-t/--template <path>`：`config.rs:217 parse_template` 读文件，模板名固定为 `"custom"`
  - TOML 配置 `.c2pconfig`：`template_str` / `template_name` 字段（configuration.rs:177-178, 237-243）
  - 未定义���量自动发现：`template.rs:107 extract_undefined_variables` 用正则 `\{\{\s*(?P<var>...)\s*\}\}` 扫描，剔除白名单后剩余变量在 `config.rs:241 handle_undefined_variables` 中用 `inquire::Text` 交互式向用户询问
  - 13 个内置任务模板（refactor / fix-bugs / write-git-commit / find-security-vulnerabilities / 各类 CTF solver 等）通过 `OnceLock<HashMap>` 惰性注册（builtin_templates.rs:20-149）

### Git diff 集成
- 抓取：直接用 `git2`（libgit2 绑定，Cargo.toml:36-40 vendored 编译），不 shell out
  - `get_git_diff`（git.rs:33）：先 `diff_tree_to_index` 拿 staged diff（HEAD vs index，`ignore_whitespace(true)`，git.rs:41-47），再用 `diff_index_to_workdir` 检测 unstaged（git.rs:65-67），无 staged 时返回 `"no diff between HEAD and index"`（git.rs:60-62）
  - `get_git_diff_between_branches`（git.rs:99）：先 `branch_exists` 校验（git.rs:107-111），再 `diff_tree_to_tree`（git.rs:119-125）
  - `get_git_log`（git.rs:149）：`revwalk` + `push(branch2)` + `hide(branch1)` + `Sort::REVERSE`，输出 `<short-hash> - <summary>` 行（git.rs:172-181）
- 组合：diff 字符串存入 `SessionData.{git_diff, git_diff_branch, git_log_branch}`（session.rs:69-71），再作为 `TemplateContext` 字段（session.rs:87-93）暴露给模板；默认 md 模板末尾 `{{#if git_diff}} Git Diff: {{git_diff}} {{/if}}`（default_template_md.hbs:33-36），xml 模板包成 `<git-diff>` 标签（default_template_xml.hbs:19-22）

### tree-sitter 摘要
- 使用情况：code2prompt-core 本身**不直接依赖** tree-sitter；通过可选 feature `entity-map` 引入外部 crate `sem-core = "0.13"`（Cargo.toml:24, 30），由 sem-core 内部使用 tree-sitter 解析多语言。`#[cfg(feature = "entity-map")]` 双实现保证关闭时零开销（entity_map.rs:51 vs 105）
- 摘要策略：
  - 抽取**结构实体**而非全文摘要：每个文件返回 `Vec<EntitySummary>`，字段 = `name / kind / start_line / end_line / signature(首行trim) / parent`（entity_map.rs:21-36）
  - `thread_local! { ParserRegistry }` 每个工作线程复用一个 registry，避免每文件重建（entity_map.rs:63-65）
  - 在 rayon 并行管道中按扩展名选语言 parser，未支持语言返回空 Vec（entity_map.rs:52-53 注释）
  - 双暴露：per-file `FileEntry.entities`（path.rs:294-298, 字段 path.rs:48-49）+ 顶层聚合 `code_map: Vec<FileCodeMap>`（session.rs:300-311 build_code_map，过滤空实体文件）
  - 模板渲染为紧凑 outline：`- {{kind}} {{name}}{{#if signature}} \`{{signature}}\`{{/if}} (lines {{start_line}}-{{end_line}})`（default_template_md.hbs:13-18）
  - 注释明确说明 sem-core 离线无遥测，保持 air-gapped（entity_map.rs:10-11, Cargo.toml:27-29）

### 可复用模块（带 file:line）
1. **`file_processor` 模块** — `crates/code2prompt-core/src/file_processor/mod.rs:63` — 策略模式按扩展名分派 + 各处理器提取 schema 而非原文（CSV 抽 header+1 行 sample 见 csv.rs:58-75，ipynb 抽前 3 个 code cell 见 ipynb.rs:68-94）。借鉴价值：用户的 RAG 工具可直接套这套 trait + factory 加 parquet/xml/pdf 等抽取器
2. **`SelectionEngine`** — `crates/code2prompt-core/src/selection.rs:31` — A,A',B,B' 优先级系统（specificity 高者胜，平手时 recent 胜 old，selection.rs:107-116），带 `HashMap<PathBuf,bool>` 缓存（selection.rs:64-69）。借鉴价值：交互式 RAG 选片/TUI 勾选文件时直接复用
3. **`tokenizer` + `count_tokens`** — `crates/code2prompt-core/src/tokenizer.rs:85` — tiktoken-rs 五种 BPE（o200k/cl100k/p50k/p50k_edit/r50k）+ `OnceLock` 全局缓存 encoder（tokenizer.rs:69-95）。借鉴价值：token 预算管理的基石
4. **`CodebaseAnalysis::token_map`** — `crates/code2prompt-core/src/analysis.rs:86` — dust 风格 `BinaryHeap` 优先队列按 token 占比选 top-N 路径，`(other files)` 聚合隐藏项（analysis.rs:313-355, 150-169）。借鉴价值：token 预算可视化 + 自动剪枝
5. **`calculate_structural_tokens` 骨架渲染** — `crates/code2prompt-core/src/session.rs:474` — 把 FileEntry 替换成空 code 的 skeleton，渲染同一模板拿"结构开销"token 数，再 + Σ(FileEntry.token_count) 得精确总数（session.rs:446-459）。借鉴价值：避免对整包重新 tokenize 的性能技巧
6. **`git.rs`** — `crates/code2prompt-core/src/git.rs:33` — git2 抓 staged/unstaged/branch diff/log + `branch_exists` 校验。借鉴价值：RAG 上下文增量更新（只塞 diff）的现成实现

### 设计取舍 / 缺口
- **无向量检索 / 语义搜索**：纯模板打包，不生成 embedding、不支持"按问题召回 top-k 文件"，需用户外接 RAG
- **无调用链 / 跨文件引用图**：entity_map 只输出扁平实体清单，没有 who-calls-who 关系图，无法做依赖感知选片
- **无 token 预算自动剪枝**：`count_tokens` 只计数不裁剪，超预算时需用户手动 `--exclude`；`token_map` 仅展示不闭环
- **无分层 / 渐进式披露**：单层 flat 模板，没有"高层 outline → 按需展开细节"的多级上下文结构
- **无 MCP / agent 工具接口**：产物是静态字符串写文件/剪贴板（main.rs:197-242），没有暴露 tool 让 agent 回查特定文件
- **无 RAG 友好的分块**：输出一份单体 prompt，不切 chunk、不带稳定 chunk ID、不做重叠切片，需另起 chunker
- **VCS 绑死 git**：vendored libgit2 编译重（Cargo.toml:36-40），不支持 hg/svn/未版本化目录的 diff
- **tree-sitter 覆盖受 sem-core 限制**：未支持语言静默返回空（entity_map.rs:50-51），用户无法插自有 grammar

### 关键代码片段

**1. 三阶段并行遍历管道** — `crates/code2prompt-core/src/path.rs:77-89`
```rust
pub fn traverse_directory(config, selection_engine) -> Result<(String, Vec<FileEntry>)> {
    // Phase 1: Discovery - Walk dirs, build tree, collect files (sequential)
    let (tree, files_to_process) = discover_files(config, selection_engine)?;
    // Phase 2: Processing - Read + tokenize + extract entities (rayon parallel)
    let mut files = process_files_parallel(files_to_process, config)?;
    // Phase 3: Assembly - Sort tree and files, return
    assemble_results(tree, &mut files, config)
}
```
说明：Discover 顺序（保留 SelectionEngine 缓存）→ Process 并行（`par_iter`, path.rs:179-182）→ Assemble 排序。这种"I/O 顺序、CPU 并行、最后归并"的分层是大型仓库打包的性能骨架。

**2. 骨架渲染分离结构 token** — `crates/code2prompt-core/src/session.rs:474-509`
```rust
fn calculate_structural_tokens(&self, tokenizer_type) -> usize {
    let skeleton_files: Option<Vec<FileEntry>> = self.data.files.as_ref().map(|files| {
        files.iter().map(|file| {
            let empty_code_block = wrap_code_block("", self.config.line_numbers);
            FileEntry { path: file.path.clone(), extension: file.extension.clone(),
                        code: empty_code_block, token_count: 0,
                        metadata: file.metadata, mod_time: file.mod_time,
                        entities: file.entities.clone() } // 保留 entities 以计入 code_map 开销
        }).collect()
    });
    let skeleton_context = TemplateContext { files: skeleton_files.as_deref(), /* 其余字段同 */ .. };
    match handlebars_setup(&template_str, &template_name) {
        Ok(hb) => match render_template(&hb, &template_name, &skeleton_context) {
            Ok(rendered) => count_tokens(&rendered, tokenizer_type),
            Err(_) => self.fallback_structural_estimate(tokenizer_type) } }
}
```
说明：用空内容渲染同一模板拿"骨架 token"，加上并行缓存的 Σ(FileEntry.token_count) 得精确总数（session.rs:446-459），避免对整包重新 tokenize 的顺序瓶颈。

**3. tree-sitter 实体抽取的 thread-local registry** — `crates/code2prompt-core/src/entity_map.rs:52-101`
```rust
#[cfg(feature = "entity-map")]
pub fn extract_entities(file_path: &str, content: &str) -> Vec<EntitySummary> {
    use sem_core::parser::plugins::create_default_registry;
    thread_local! {
        static REGISTRY: RefCell<ParserRegistry> = RefCell::new(create_default_registry());
    }
    REGISTRY.with(|cell| {
        let registry = cell.borrow();
        let entities = registry.extract_entities(file_path, content);
        let name_by_id: HashMap<&str, &str> =
            entities.iter().map(|e| (e.id.as_str(), e.name.as_str())).collect();
        entities.iter().map(|e| {
            let signature = e.content.lines().next().map(|l| l.trim().to_string())
                .filter(|s| !s.is_empty());
            let parent = e.parent_id.as_deref()
                .and_then(|pid| name_by_id.get(pid).map(|n| n.to_string()));
            EntitySummary { name: e.name.clone(), kind: e.entity_type.clone(),
                start_line: e.start_line, end_line: e.end_line, signature, parent }
        }).collect()
    })
}
```
说明：thread_local 复用 parser registry 摊销多语言 grammar 注册成本；signature 取实体首行、parent 通过 `parent_id` 反查 name，给模板一个紧凑可编程的 outline。用户做 RAG 摘要时可复用这种"thread_local + 投影成小 DTO"的模式。

---

## files-to-prompt 深挖卡片

### 一句话定位
单文件 CLI，把目录递归拼成 LLM 提示

### 核心架构
- 入口：files_to_prompt/__main__.py:4（`cli()`）；console_script 声明于 pyproject.toml:23
- 主要模块：仅一个 —— `cli.py`（334 行）；`__init__.py` 为空文件（0 行）
- 关键函数：
  - `cli()` —— click 命令、参数装配、循环调用 process_path —— cli.py:248
  - `process_path()` —— 单文件/单目录的递归收集 + 过滤 + 读取核心 —— cli.py:101
  - `print_path()` / `print_as_xml()` / `print_as_markdown()` / `print_default()` —— 输出格式分派 —— cli.py:55 / 74 / 87 / 64
  - `read_gitignore()` + `should_ignore()` —— gitignore 解析与匹配 —— cli.py:36 / 27

### 文件收集策略
- include/exclude：用 `--ignore <pattern>`（fnmatch 通配，cli.py:140-151）；`--ignore-files-only` 让 ignore 模式只作用于文件、保留目录（cli.py:141-146）；正向包含只靠 `-e/--extension` 后缀过滤（cli.py:153-154）；没有正向 `--include` 模式
- gitignore：在 `os.walk` 每一层 `read_gitignore(root)` 读取该层 `.gitignore`，规则累加进共享 `gitignore_rules` 列表（cli.py:128）；`should_ignore()` 用 `fnmatch` 只匹配 basename（cli.py:27-33），对目录额外尝试加 `/` 后缀匹配（cli.py:31）；`--ignore-gitignore` 可整体关闭（cli.py:127）
- 二进制：没有真正的二进制检测。统一以文本模式 `open(path, "r")` 读取（cli.py:116、159），捕获 `UnicodeDecodeError` 后向 stderr 打红色 warning 并跳过（cli.py:118-120、168-172）

### 输出格式
- 结构：三选一
  - 默认：`path\n---\n<内容>\n\n---\n`（cli.py:64-71）
  - `--cxml`：`<documents>` 包裹，每文件 `<document index="N"><source>path</source><document_content>...</document_content></document>`，index 由模块级 `global_index` 自增（cli.py:74-84、317/332）
  - `--markdown`：fenced code block，语言标签查 `EXT_TO_LANG` 表（cli.py:9-24，仅 14 项）；遇内容含三反引号则自动加一个反引号防冲突（cli.py:90-92）
- 目录树：无
- token 计数：无（只有 `-n/--line-numbers` 行号，padding 自适应，cli.py:46-52）

### 可复用模块（带 file:line）
1. `process_path()` —— 整个"遍历+过滤+读取+输出"单函数流水线，~70 行写完核心算法，是"最小可行"范本 —— cli.py:101-172
2. Markdown 反引号冲突自适应（`print_as_markdown` 内）—— 用 `while backticks in content: backticks += "`"` 一行解决嵌套围栏问题，极简优雅 —— cli.py:87-98
3. `read_gitignore()` + `should_ignore()` —— "gitignore 即 fnmatch" 的简化模型，~17 行可独立搬用（注意：非完整 gitignore 规范）—— cli.py:27-43
4. `read_paths_from_stdin()` —— stdin 读路径 + NUL 分隔符支持，便于和 `find -print0` 等 Unix 工具组合 —— cli.py:175-185

### 设计取舍 / 缺口
- 故意没做的（Simon 的极简哲学）：
  - 无 token 计数 / 无预算控制 —— 把"超长怎么办"留给上游 LLM/���具
  - 无目录树 / 仓库结构概览 —— 只给文件内容，不给地图
  - 无 chunking / 截断 / 文件大小上限 —— 全量原样拼接
  - 无文件元数据（大小、mtime、LOC、语言统计）
  - 无正向 `--include` 模式，正向选择只靠后缀
  - 无流式输出，全量进内存（`f.read()` 一次性）
  - 无去重（同一文件传两次会输出两次）
  - 不完整 gitignore 规范：不支持 `!` 取反、`**`、`/` 锚定路径、`.git/info/exclude`、全局 gitignore
  - 无真正的二进制检测（靠 UTF-8 解码失败兜底）
  - 语言表硬编码 14 项（cli.py:9-24），未覆盖的扩展名 markdown 不带语言标签
  - `global_index` 是模块级可变全局，靠 cli() 开头重置保证可测（cli.py:296-297）—— 可工作但非可重入
- 用户做"Code RAG 工具库"需要但 files-to-prompt 没做的：
  - token 计数 + 预算感知截断 / 优先级丢弃
  - 仓库结构树（帮 LLM 导航）
  - 分块策略：按 AST/符号/滑窗切大文件、带 overlap
  - embedding / 向量检索 / 相关性排序（这是 RAG 的"检索"半边，本项目只做"打包"半边）
  - 完整 gitignore 规范 + `.git/info/exclude` + 全局 gitignore + `.gitignore` 之外的 ignore（如 `.dockerignore`）
  - 二进制检测（magic bytes / mimetype）
  - 文件大小/数量上限、增量更新/缓存、变更感知（diff-only）
  - 符号提取 / import 图 / 调用图
  - 多仓库支持、子模块过滤
  - 每文件元数据头部（LOC、size、语言、最后修改）

### 关键代码片段

[片段 1：Markdown 反引号冲突自适应 —— cli.py:87-98]
```python
def print_as_markdown(writer, path, content, line_numbers):
    lang = EXT_TO_LANG.get(path.split(".")[-1], "")
    # Figure out how many backticks to use
    backticks = "```"
    while backticks in content:
        backticks += "`"
    writer(path)
    writer(f"{backticks}{lang}")
    if line_numbers:
        content = add_line_numbers(content)
    writer(content)
    writer(f"{backticks}")
```
说明：三行 `while` 解决"代码里本身含三反引号"的嵌套围栏问题——给围栏加反引号直到不在内容中出现。这是全文件最值得偷的小技巧：用最小逻辑处理边界冲突。

[片段 2：单遍 walk + 多级过滤的核心 —— cli.py:122-172]
```python
for root, dirs, files in os.walk(path):
    if not include_hidden:
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        files = [f for f in files if not f.startswith(".")]

    if not ignore_gitignore:
        gitignore_rules.extend(read_gitignore(root))
        dirs[:] = [d for d in dirs
                   if not should_ignore(os.path.join(root, d), gitignore_rules)]
        files = [f for f in files
                 if not should_ignore(os.path.join(root, f), gitignore_rules)]

    if ignore_patterns:
        if not ignore_files_only:
            dirs[:] = [d for d in dirs
                       if not any(fnmatch(d, p) for p in ignore_patterns)]
        files = [f for f in files
                 if not any(fnmatch(f, p) for p in ignore_patterns)]

    if extensions:
        files = [f for f in files if f.endswith(extensions)]

    for file in sorted(files):
        file_path = os.path.join(root, file)
        try:
            with open(file_path, "r") as f:
                print_path(writer, file_path, f.read(),
                           claude_xml, markdown, line_numbers)
        except UnicodeDecodeError:
            click.echo(click.style(
                f"Warning: Skipping file {file_path} due to UnicodeDecodeError",
                fg="red"), err=True)
```
说明：整个项目的核心算法。亮点是用 `dirs[:] = [...]` 原地修改 walk 的 dirs 列表来做"剪枝"——这是用 os.walk 做目录过滤的惯用法，比 walk 完再过滤高效得多。gitignore 规则按层级累加（`extend(read_gitignore(root))`），实现"子目录 .gitignore 覆盖父目录"的近似语义。这 ~50 行就是"代码仓库打包"领域的本质骨架。

---

## Tabby 深挖卡片

### 一句话定位
生产级 Code RAG，靠 Tantivy + 二值化 embedding 走"伪向量检索"

### AST 切片 / 代码切分
- 核心实现：`crates/tabby-index/src/code/intelligence.rs:145-185`（`stream_code_chunks` / `chunks`），底层依赖第三方 `text-splitter = 0.13.3` 的 `CodeSplitter`（开 `code` feature，内部走 tree-sitter）
- 切分粒度：**递归语义切分 + 容量目标**。`CodeSplitter` 沿 AST 自顶向下找"能塞进 chunk_capacity 的最大语义单元"（class → function → statement → expression → line → char），并非纯函数级也非纯 token 级。默认 `CHUNK_SIZE = 512` 字符（`intelligence.rs:21`）；markdown/txt 走 1536（`assets/languages.toml:337,342`）；结构化文档走 2048（`structured_doc/types/page.rs:40`）。语言不支持时降级为 `TextSplitter`（段落/句/词/字符）。
- tree-sitter 用在**两处独立**：① `tree_sitter_tags::TagsContext` 抽符号元数据（class/function/method/trait/macro 定义），查询在 `crates/tabby-index/queries/*.scm`（如 `rust.scm`），结果存进 `SourceCode.tags` 但**不进入 chunk body**；② `CodeSplitter` 内部用 tree-sitter 做实际边界判定。
- 每个 chunk 字段：filepath / git_url / language / body / start_line（仅当非整文件）。embedding 时 body 被包成 ` ```{filepath}\n{body}\n``` ` 提交给模型（`code/mod.rs:117`）。
- 与 Repomix/Aider 对比：Repomix/Aider 走"签名级"——只抽 function/class 声明做仓库 outline，目标是**压缩给 LLM 看**；Tabby 保留**完整函数体**，只是按 AST 边界切成 512 字符块，目标是**检索后注入**。前者是概览视图，后者是可检索的全文索引。Tabby 的 tags 字段其实接近 Repomix 的签名能力，但它没有把 tags 输出成"可读 context"，只当 metadata。

### embedding / 向量检索
- embedding 模型：**不写死**。通过 `llama_cpp_server::create_embedding`（GGUF + `--embedding`，`llama-cpp-server/src/supervisor.rs:77-79`）或 OpenAI 兼容 HTTP（`http_api_bindings::create_embedding`）加载。Trait 只有 `async fn embed(&str) -> Vec<f32>`（`tabby-inference/src/embedding.rs:4-6`）。仓库内无具体模型名，由用户在 config 指定。
- 向量库：**没有真正的向量库**。用 **Tantivy**（quickwit fork，`Cargo.lock` 里 `git+...rev=4143d31`），一个 Rust 版 Lucene 全文索引。核心 trick 在 `tabby-common/src/index/mod.rs:343-383`：把每个 float 维度二值化成字符串 token，`value<=0 → "embedding_zero_{i}"`，`value>0 → "embedding_one_{i}"`，然后和代码 token 一起塞进 `chunk_tokens` 字段。查询时每个维度命中贡献 `1.0/embedding_dims` 分数（`ConstScoreQuery`）。等价于 1-bit LSH，把 cosine 相似度降成"二值哈希桶命中数"。
- 检索 pipeline（`crates/tabby/src/services/code.rs:52-83`）：双通道并行 + RRF 融合
  - 通道 A（embedding）：query.content → embed → binarize → `embedding_tokens_query` → Tantivy 布尔 term 查询
  - 通道 B（BM25）：query.content → `tokenize_code`（`RegexTokenizer` `\w+` + `RemoveLongFilter(64)`，`tabby-common/src/index/code/tokenizer.rs`）→ `body_query`（`BooleanQuery::union`）
  - 两路均按 corpus + source_id + language 过滤，排除当前 filepath
  - 融合：`merge_code_responses_by_rank`（`code.rs:88-143`），`RANK_CONSTANT=60`，每路 `1/(60+rank)` 相加得 `rrf`
  - 每文件最多 2 命中（`retain_at_most_two_hits_per_file`，`code.rs:145-155`）
  - 阈值过滤（`api/code.rs:96-107` 默认）：`min_embedding_score=0.75`、`min_bm25_score=8.0`、`min_rrf_score=0.028`；`num_to_score=40`/通道，`num_to_return=20`
- rerank：**无模型 rerank**。"重排"就是 embedding vs BM25 两路 RRF。没有 cross-encoder、没有 max-margin。结构化文档检索更简单——只跑 embedding 通道，按 score 去重取 topN，阈值 0.75（`services/structured_doc/tantivy.rs:27,114`）。

### 索引构建 pipeline
- 流程（`crates/tabby-index/src/code/index.rs:28-75` + `code/mod.rs:32-47`）：
  1. `sync_repository` → `tabby_git::sync_refs` clone/pull（`repository.rs:19-29`）
  2. `resolve_commits` → 取 (ref, sha)，无配置 refs 时用 HEAD（`repository.rs:49-100`）
  3. 逐 ref `checkout`，`Walk::new` 遍历（`ignore` crate，尊重 .gitignore）
  4. 文件按 100 个一批（`index.rs:65`），并发 `max(parallelism*4, 64)`（`index.rs:112`）
  5. 每文件算 `SourceFileId = {path, language, git_blob_hash}`（`intelligence/id.rs`）——这是增量键
  6. `require_updates`：已索引且无 failed_chunks 则跳过（`index.rs:176-182`）
  7. `is_valid_file` 过滤：max_line≤300、avg_line≤150、alphanum_frac≥0.25、num_lines≤100000、number_frac≤0.5（`index.rs:212-218`）——挡掉 minified/生成代码/二进制
  8. `compute_source_file`：读内容、算 metrics、`find_tags` 抽符号
  9. `builder.build`：逐 chunk → 包代码围栏 → `embed` → binarize → 拼上 `tokenize_code` 的 BM25 token → 写 Tantivy doc
  10. 批次结束 `index.commit()`，最后 `garbage_collection` 删除 source_file_id 已不匹配的旧 doc（`index.rs:79-104`）
- 增量更新：**git blob hash 当缓存键**。文件未改 → blob 不变 → id 不变 → 跳过；改了 → 新 id → delete 旧 + add 新；删了 → GC 清除。另有 `failed_chunks_count` 字段（`indexer.rs:121-128`）记录 embedding 失败的 chunk 数，下次重试。还有 `backfill_commit_in_doc_if_needed`（`index.rs:185-210`）——schema 升级时只补 doc 级属性，不重跑 chunk embedding。调度由 `@hourly` cron + 仓库分片（`calculate_current_shard`，`git.rs:91-96`）避免洪峰。

### 可复用模块（带 file:line）
1. `binarize_embedding` + `embedding_tokens_query` - "把向量塞进全文索引"的核心 trick，零外部依赖做近似向量检索 - `crates/tabby-common/src/index/mod.rs:343-383`
2. `CodeIntelligence::chunks` - AST 切片入口 + 不支持语言时优雅降级到 TextSplitter - `crates/tabby-index/src/code/intelligence.rs:165-185`
3. `merge_code_responses_by_rank` + `compute_rank_score` - embedding/BM25 双路 RRF 融合，纯函数易移植 - `crates/tabby/src/services/code.rs:86-162`
4. `SourceFileId`（path + git blob hash）- 最优雅的增量缓存键设计，零状态、无需外部 manifest - `crates/tabby-index/src/code/intelligence/id.rs:14-54`
5. `is_valid_file` + `metrics::compute_metrics` - 一次遍历算出 max/avg line、alphanum/number fraction，廉价挡掉 minified/二进制 - `crates/tabby-index/src/code/index.rs:212-251`
6. `tokenize_code`（RegexTokenizer `\w+` + RemoveLongFilter 64）- 简单但够用的代码 BM25 分词器 - `crates/tabby-common/src/index/code/tokenizer.rs:4-22`

### 设计取舍 / 缺口
- Tabby 没做但用户需要的：
  1. **打包输出**：Tabby 只做"检索 → 注入 prompt"，没有把整个仓库压缩成一份可保存/可复用的 LLM 上下文文件的"打包模式"。输出是 completion prompt 里的内联注释 snippet，不是 context bundle。
  2. **调用链 / cross-file 引用图**：tags 提取了 class/function/method/trait/macro 定义，但只存为 doc metadata，没有建 symbol→definition 引用图，做不了"找谁调用了 X"。
  3. **分层压缩**：没有 repo outline → file → function → body 的多粒度层级，chunk 是单层 512 字符，缺乏"先看概览再下钻"能力。
  4. **MCP 集成**：检索只通过内部 HTTP API（`/v1code_search` 等），未暴露 MCP server，外部 agent 接不进来。
  5. **签名级 context 视图**：tags 字段有能力但没输出成"仓库签名概览"文件——这恰好是 Repomix/Aider 的主战场。
- Tabby 偏 completion 的取舍：
  1. chunk 容量 512 字符——为 FIM completion prompt 注入设计，对"给 chat 模型看完整仓库"场景偏碎。
  2. 检索是 query-then-inject 模式：命中以 `# Path: x.py` 注释形式塞进 prefix（`completion_prompt.rs:109-143`），总预算仅 768 字符（`completion_prompt.rs:47`），完全是 completion prompt budget 口径。
  3. 双路 RRF + 每文件 2 命中 + 三重阈值——为"completion 注入少量精准片段"过度设计，对"打包整仓给 LLM"是错位需求。
  4. binarized embedding 用 Tantivy 而非真向量库——优势是单二进制零外部依赖、部署极简；代价是 1-bit 量化精度损失，对需要 rich semantic ranking 的场景偏弱。

### 关键代码片段

**片段 1：二值化 embedding → 全文索引 token（核心创新）**
```rust
// crates/tabby-common/src/index/mod.rs:343-383
pub fn binarize_embedding<'a>(
    embedding: impl Iterator<Item = &'a f32> + 'a,
) -> impl Iterator<Item = String> + 'a {
    embedding.enumerate().map(|(i, value)| {
        if *value <= 0.0 { format!("embedding_zero_{i}") }
        else { format!("embedding_one_{i}") }
    })
}

pub fn embedding_tokens_query<'a>(
    embedding_dims: usize,
    embedding: impl Iterator<Item = &'a f32> + 'a,
) -> BooleanQuery {
    let schema = IndexSchema::instance();
    let iter = binarize_embedding(embedding).map(Cow::Owned);
    new_multiterms_const_query(schema.field_chunk_tokens, embedding_dims, iter)
}
// new_multiterms_const_query: 每个维度命中 -> ConstScoreQuery(1.0/embedding_dims)
// 等价 1-bit LSH，最终分数 = 匹配维度数 / 总维度数
```

**片段 2：双通道检索 + RRF 融合（生产级检索 pipeline）**
```rust
// crates/tabby/src/services/code.rs:52-83
async fn search_in_language(&self, reader, query, params) -> Result<...> {
    let docs_from_embedding = {
        let embedding = self.embedding.embed(&query.content).await?;
        let q = Box::new(index::embedding_tokens_query(embedding.len(), embedding.iter()));
        let query = code::code_search_query(&query, q);
        self.search_with_query(reader, &query, params.num_to_score).await?
    };
    let docs_from_bm25 = {
        let body_tokens = tokenize_code(&query.content);
        let q = code::body_query(&body_tokens);
        let query = code::code_search_query(&query, q);
        self.search_with_query(reader, &query, params.num_to_score).await?
    };
    Ok(merge_code_responses_by_rank(reader, &params, docs_from_embedding, docs_from_bm25).await)
}
// RRF: compute_rank_score -> 1.0 / (60.0 + (rank+1))，两路相加
```

**片段 3：git blob hash 作增量缓存键（增量更新基石）**
```rust
// crates/tabby-index/src/code/intelligence/id.rs:10-54
fn get_git_hash(path: &Path) -> Result<String> {
    Ok(git2::Oid::hash_file(git2::ObjectType::Blob, path)?.to_string())
}
#[derive(Deserialize, Serialize, Debug)]
pub struct SourceFileId {
    path: PathBuf,
    language: String,
    git_hash: String,  // git blob oid，文件内容不变则 hash 不变
}
impl TryFrom<&Path> for SourceFileId {
    fn try_from(path: &Path) -> Result<Self> {
        if !path.is_file() { bail!("Path is not a file"); }
        let git_hash = get_git_hash(path)?;
        let ext = path.extension().context("Failed to get extension")?;
        let lang = get_language_by_ext(ext).context("Unknown language")?;
        Ok(Self { path: path.to_owned(), language: lang.language().into(), git_hash })
    }
}
// 配合 require_updates: is_indexed(id) && !has_failed_chunks(id) -> 跳过
```

**片段 4：文件有效性过滤（廉价挡 minified/生成代码）**
```rust
// crates/tabby-index/src/code/index.rs:212-218
static MAX_LINE_LENGTH_THRESHOLD: usize = 300;
static AVG_LINE_LENGTH_THRESHOLD: f32 = 150f32;
static MIN_ALPHA_NUM_FRACTION: f32 = 0.25f32;
static MAX_NUMBER_OF_LINES: usize = 100000;
static MAX_NUMBER_FRACTION: f32 = 0.5f32;

fn is_valid_file(file: &SourceCode) -> bool {
    file.max_line_length <= MAX_LINE_LENGTH_THRESHOLD
        && file.avg_line_length <= AVG_LINE_LENGTH_THRESHOLD
        && file.alphanum_fraction >= MIN_ALPHA_NUM_FRACTION
        && file.num_lines <= MAX_NUMBER_OF_LINES
        && file.number_fraction <= MAX_NUMBER_FRACTION
}
```

---

## 补充观察（Tabby，不进卡片）

- Tabby 还有 `tabby-crawler`（katana + Readability + htmd 抓网页，外加 `llms_txt_parser.rs` 解析 `llms-full.txt` 按 H1 切段）和 `structured_doc`（web/issue/pull/commit/page/ingested 六类文档），都用同一套 `TantivyDocBuilder` + binarized embedding 走 `corpus::STRUCTURED_DOC`。如果 Code RAG 工具库要覆盖"代码 + 文档"双类，这套 corpus 抽象值得抄。
- 真正的"打包给 LLM 看"能力在 Tabby 里**完全没有**——这正好是本项目相对 Tabby 的差异化空间。Tabby 解决的是"实时 completion 注入"，用户解决的是"离线打包 + chat 上下文"，两者切片粒度（512 vs 概览+多粒度）和输出形式（注入 prompt vs 导出文件）根本不同。
