# 第三批深挖卡片（基础设施层 4 项目）

> 用途：为"全面 Code RAG 工具库"提供基础设施层选型依据
> 仓库位置：`_reference/{scip, tree-sitter, llms-txt, llama_index + llama_index_pack_code_hierarchy}/`
> 配套：第一批见 `batch1_deepdive.md`，第二批见 `batch2_deepdive.md`

---

## SCIP 深挖卡片

### 一句话定位
跨语言代码索引协议，定义/引用/实现的 protobuf 传输格式

### 协议定位与架构
- SCIP 是什么：SCIP（发音 "skip"）是 Sourcegraph 推出的**语言无关代码索引协议**，用 Protobuf 定义，用于驱动 Go-to-definition / Find-references / Find-implementations 等 IDE 级代码导航。它是 **LSIF 的继任者**——LSIF（基于 JSON/图结构的旧协议）因开发速度慢、调试难、indexer 性能瓶颈已被 Sourcegraph 完全废弃，SCIP 通过"传输格式而非存储格式"的定位、字符串 ID 而非整数 ID、避免直接编码图等设计修正了 LSIF 的痛点。
- 仓库结构：
  - `scip.proto`（962 行，唯一权威 schema）
  - `bindings/`：go（最全，含 parse/canonicalize/sort/symbol 等工具）、rust（src/symbol.rs + generated）、typescript、haskell、java、kotlin（后四者为自动生成桩）
  - `cmd/scip/`：Go 实现的 CLI（lint/print/snapshot/stats/test/expt-convert）
  - `docs/`：DESIGN.md（设计理据）、CLI.md、scip.md（proto 自动生成的参考）、Development.md、test_file_format.md
  - `reprolang/`：专为测试 SCIP 全部能力设计的"可复现语言"，用 tree-sitter 解析 `.repro` 文件生成确定性 SCIP 索引
  - `buf.yaml` / `buf.gen.yaml`：Protobuf 工具链配置
- 核心数据模型：`Index` → `Metadata` + `Document[]` + `external_symbols[]`；`Document` → `Occurrence[]` + `SymbolInformation[]`；`SymbolInformation` → `Relationship[]`；Symbol 用标准化字符串语法（`<scheme> <package> <descriptor>+`）

### 核心数据模型
- **Symbol**（URI 式标识）：`scheme`(string) + `package`(Package{manager,name,version}) + `descriptors[]`(Descriptor{name,disambiguator,suffix})；另有标准化字符串形式，文法为 `<scheme> ' ' <package> ' ' (<descriptor>)+`，descriptor 后缀用 `/` `#` `.` `:` `!` `()` `[]` 区分 Namespace/Type/Term/Meta/Macro/Method/TypeParameter/Parameter；局部符号用 `local <id>` 前缀（文件内可见，不可跨文档）
- **Occurrence**（源位置 + 符号/高亮关联）：`range`(deprecated repeated int32, [startLine,startChar,endChar] 或 4 元素) / `typed_range`(oneof: `single_line_range` SingleLineRange | `multi_line_range` MultiLineRange) + `symbol`(string) + `symbol_roles`(int32 位集) + `override_documentation[]` + `syntax_kind`(SyntaxKind) + `diagnostics[]` + `enclosing_range`(deprecated) / `typed_enclosing_range`(oneof)。SymbolRole 位集含 Definition/Import/WriteAccess/ReadAccess/Generated/Test/ForwardDefinition
- **Relationship**（符号间关系）：`symbol`(string, 指向另一符号) + `is_reference`(bool, Find references 联动) + `is_implementation`(bool, Find implementations 联动) + `is_type_definition`(bool, Go to type definition) + `is_definition`(bool, 覆盖多定义/继承场景的 Go-to-definition 行为)
- **Document**（源文件元数据）：`language`(string, 可用 Language 枚举值) + `relative_path`(string, 相对 project_root，强制 '/' 分隔、canonical) + `occurrences[]` + `symbols[]`(SymbolInformation) + `text`(optional, 默认不存) + `position_encoding`(PositionEncoding: UTF8/UTF16/UTF32)
- **Index**（完整索引根）：`metadata`(Metadata{version, tool_info{ name,version,arguments }, project_root, text_document_encoding}) + `documents[]`(Document) + `external_symbols[]`(SymbolInformation, 跨包外部符号的 hover 文档)。设计支持**流式消费**——metadata 必须在流首且只出现一次，其余字段顺序任意，TLV 格式天然支持流式

### 索引消费方式
- 生成：由**独立语言 indexer** 产生 `.scip` protobuf 文件。各 indexer 通常复用语言编译器/LSP server 的语义信息（如 rust-analyzer 直接内置、scip-java 基于 JDK 编译器、scip-typescript 基于 tsserver）。当前已发布的 indexer：scip-java（Java/Scala/Kotlin）、scip-typescript（TS/JS）、rust-analyzer（Rust）、scip-clang（C/C++）、scip-ruby、scip-python、scip-dotnet（C#/VB）、scip-dart、scip-php。生成端设计目标：易并行、文件级增量、低内存（可逐文件 append 后清理）、producer 友好
- 查询：SCIP **本身不是查询格式**（DESIGN.md 明确 Non-goals：不支持高效代码导航查询，需消费者自建查询引擎）。Sourcegraph 服务端将上传的 `.scip` 索引转换为内部 LSIF-based 存储后查询。仓库内 `cmd/scip/expt-convert` 提供**实验性**转 SQLite 方案，schema 包含 documents/chunks(occurrences 以 zstd blob)/global_symbols/mentions(chunk↔symbol↔role)/defn_enclosing_ranges 五张表，并对 (symbol_id, role)、(document_id, line range) 等建索引。`ParseStreaming`（parse.go）提供 IndexVisitor 模式的流式遍历（VisitMetadata/VisitDocument/VisitExternalSymbol），避免全量加载
- query tool：**有，但有限**——`scip` CLI 提供 lint/print(可 --json)/snapshot/stats/test/expt-convert 六个子命令，均为**调试/检查/统计**用途，无专门的 query 子命令（如"查某符号的所有引用"）。真正的查询能力需：(a) 用 Go/Rust bindings 自写遍历逻辑，(b) `scip expt-convert` 转 SQLite 后用 sqlite3 查（mentions 表 + idx_mentions_symbol_id_role 索引可支持 Find references），(c) 接入 Sourcegraph 后端。对于 RAG 工具，最现实路径是直接用 Go bindings 的 IndexVisitor 流式遍历或转 SQLite

### 对 Code RAG 工具的可复用价值
- **Symbol/Occurrence/Relationship 三元组直接等价于"调用链图谱"的边表**：Occurrence(symbol_roles 含 Definition/ReadAccess/WriteAccess) 是节点定位，Relationship(is_reference/is_implementation/is_type_definition/is_definition) 是显式语义边，enclosing_range 天然给出"函数体内引用了哪些符号"（Call hierarchy 的现成数据）。无需自己设计图谱 schema
- **可替代手写 tree-sitter 引用解析**：tree-sitter 只能给语法树，无法解析跨文件/跨包的"这个调用指向哪个定义"。SCIP indexer 复用各语言编译器语义，给出**已消歧的 symbol 字符串**（如 `scip-python ast#walk().`），跨文件/跨包引用直接通过字符串相等匹配。对 Python/Java/TS/Rust/C++ 等动态/重载语言，手写解析几乎不可行，SCIP 是现成答案
- **成熟度排序**：最成熟 = rust-analyzer（rust-lang 官方维护，集成在 LSP server 中）、scip-typescript、scip-java（Sourcegraph 亲维护，覆盖 JVM 三语言）；次成熟 = scip-python、scip-clang、scip-dotnet、scip-ruby；社区/较新 = scip-dart(Workiva)、scip-php(个人)。对 Code RAG 场景，**TS/JS、Python、Java/Kotlin、Rust、Go** 这五类主流语言覆盖最好
- **protobuf + 流式 + 字符串 ID 设计对打包友好**：`ParseStreaming` 支持逐 Document 遍历不爆内存，`Index.metadata.project_root` + `Document.relative_path` 给出绝对定位，`Document.text` 字段虽默认空但可按需嵌入。可以直接 stream 一份 `.scip` 索引，按 symbol 抽取定义块 + 关联引用块，组装成 LLM 上下文
- **enclosing_range 是"调用链感知打包"的天然钩子**：proto 注释明确说 enclosing_range 用于 "Call hierarchies: to determine what symbols are referenced from the body of a function"。对某个函数 symbol，取其 definition occurrence 的 enclosing_range（覆盖整个函数体 AST），再扫该范围内所有 reference occurrence 的 symbol → 即得该函数的完整依赖集，可直接驱动"按调用链拉取上下文"

### 设计取舍 / 缺口
- **无向量检索 / 无嵌入**：SCIP 是纯符号级精确索引，没有任何 embedding/语义相似度概念。Code RAG 的"语义相似 chunk 检索"层必须另建，SCIP 只能补强"精确调用链"层。两者是互补关系，不是替代
- **无 token 预算 / 无上下文压缩机制**：SCIP 只描述"哪里有什么符号"，不关心"如何把符号对应的源码裁剪进 LLM 上下文窗口"。token 预算分配、按相关性截断、源码片段抽取与去重，都需要 RAG 工具自己在 SCIP 之上加一层
- **偏 IDE navigation，非 LLM 上下文**：SymbolRole/Relationship/SyntaxKind 全部为 IDE 体验设计（hover、跳转、高亮），没有"这段代码对理解 X 的重要性"这类 RAG 专用信号。documentation 字段是 markdown docstring，质量依赖 indexer，不一定适合直接喂 LLM
- **consumer 侧工具薄弱**（DESIGN.md 明确 Non-goal "Ease of writing consumers"）：没有官方 query DSL/REST API，Find-references 需自建反向索引（expt-convert 的 SQLite mentions 表是个起点但仍是实验性）。对一个独立 Code RAG 工具而言，需自己写遍历/索引层，不能指望"装个 scip CLI 就能查"
- **indexer 质量参差 + 需构建环境**：各 indexer 往往需要项目能编译（scip-java 需 JDK 构建、scip-clang 需 compile_commands.json、scip-typescript 需能 resolve 依赖）。对"快速打包任意仓库给 LLM"的轻量场景，SCIP indexer 的构建成本可能过重；tree-sitter 的"无需编译、纯语法"反而更轻。**SCIP 适合需要精确调用链的深度场景，不适合快速/兜底打包**
- **无跨索引合并的运行时支持**：external_symbols 字段允许声明外部包符号的 hover 文档，但跨 repo 的引用解析（A 仓库引用 B 仓库的 symbol）需消费者自己按 symbol 字符串匹配多个 Index。SCIP 只定义了传输格式，跨仓库图谱缝合在 Sourcegraph 后端完成

### 关键 proto 片段

**片段 1 — Index / Metadata / Document（顶层容器与流式设计）**
```protobuf
// Index represents a complete SCIP index for a workspace rooted at a single directory.
// To permit streaming consumption, `metadata` must appear at the start of the stream
// and must only appear once. Other field values may appear in any order.
message Index {
  Metadata metadata = 1;
  repeated Document documents = 2;
  // Symbols referenced from this index but defined in an external package.
  repeated SymbolInformation external_symbols = 3;
}

message Metadata {
  ProtocolVersion version = 1;
  ToolInfo tool_info = 2;             // {name, version, arguments[]}
  string project_root = 3;            // URI-encoded absolute path
  TextEncoding text_document_encoding = 4;
}

message Document {
  string language = 4;                // e.g. "Python", "TypeScript"
  string relative_path = 1;           // relative to project_root, '/' separator
  repeated Occurrence occurrences = 2;
  repeated SymbolInformation symbols = 3;  // symbols "defined" in this doc
  string text = 5;                    // optional, usually read from filesystem
  PositionEncoding position_encoding = 6;  // UTF8/UTF16/UTF32
}
```

**片段 2 — Occurrence + SymbolRole（位置↔符号绑定 + enclosing_range 调用链钩子）**
```protobuf
message Occurrence {
  oneof typed_range {                 // half-open [start, end) source range
    SingleLineRange single_line_range = 8;
    MultiLineRange multi_line_range = 9;
  }
  string symbol = 2;                  // formatted per Symbol grammar
  int32 symbol_roles = 3;             // bitset of SymbolRole
  SyntaxKind syntax_kind = 5;
  repeated Diagnostic diagnostics = 6;
  oneof typed_enclosing_range {       // nearest enclosing AST node range
    SingleLineRange single_line_enclosing_range = 10;  // — enables call hierarchies,
    MultiLineRange multi_line_enclosing_range = 11;     //   symbol outline, expand selection
  }
}

enum SymbolRole {                     // bitset: test with (role & X) > 0
  Definition = 0x1;                   // defined here? else it's a reference
  Import = 0x2;
  WriteAccess = 0x4;
  ReadAccess = 0x8;
  Generated = 0x10;
  Test = 0x20;
  ForwardDefinition = 0x40;           // C/C++ forward decl, OCaml 'val' in .mli
}
```

**片段 3 — SymbolInformation + Relationship（符号元数据 + 语义边，调用链图谱核心）**
```protobuf
message SymbolInformation {
  string symbol = 1;                  // e.g. "scip-python python ast#walk()."
  repeated string documentation = 3;  // markdown docstring
  repeated Relationship relationships = 4;
  SymbolInformation.Kind kind = 5;    // 87 种细粒度种类: Class/Method/Function/Struct/Trait...
  string display_name = 6;            // "myMethod" (human-readable)
  Signature signature_documentation = 7;  // {language, text, occurrences[]} for hover
  string enclosing_symbol = 8;        // parent symbol for local symbols
}

message Relationship {
  string symbol = 1;                  // target symbol string
  bool is_reference = 2;       // Find references: include this symbol together
  bool is_implementation = 3;  // Find implementations: include this symbol
  bool is_type_definition = 4; // Go to type definition
  bool is_definition = 5;      // override Go-to-definition for multi-def/mixin cases
  // Example: class Dog implements Animal {}
  //   Dog# has Relationship{symbol:"Animal#", is_implementation:true}  (no is_reference)
  //   Dog#sound() has Relationship{symbol:"Animal#sound()", is_implementation:true, is_reference:true}
}
```

---

## tree-sitter 深挖卡片

### 一句话定位
跨语言增量 AST 解析的事实标准基础设施

### 核心架构
- 仓库结构：
  - `lib/src/` — 纯 C 核心（`parser.c`/`tree.c`/`node.c`/`tree_cursor.c`/`query.c`/`lexer.c`/`stack.c`/`subtree.c`/`language.c`/`wasm_store.c`/`get_changed_ranges.c` + `portable/`/`unicode/`/`wasm/`），单文件入口 `lib.c`
  - `lib/include/tree_sitter/api.h` — 公共 C API（唯一头文件，ABI 版本 15，最低兼容 13）
  - `lib/binding_rust/` — Rust binding（`lib.rs` ~4025 行，`ffi.rs`，`wasm_language.rs`）
  - `lib/binding_web/` — `web-tree-sitter`（Emscripten 编译的 JS/WASM binding）
  - `crates/` — `cli`、`loader`、`generate`、`highlight`、`tags`、`language`、`config`、`xtask`
  - `docs/src/` — mdBook 文档；`Cargo.toml` workspace v0.27.0，edition 2024，rust-version 1.90；另含 `CMakeLists.txt`/`build.zig`/`Makefile`/`Package.swift` 多语言构建
- 解析 API：四个核心对象 `TSLanguage`（CLI 生成的不可透视对象）/`TSParser`（有状态）/`TSTree`（整棵 CST）/`TSNode`（16 字节值类型，带 byte/point 位置）。`ts_parser_parse(self, old_tree, TSInput)` 支持回调式输入 + UTF8/UTF16LE/UTF16BE/Custom 编码；`ts_tree_edit` + 带 `old_tree` 重解析实现增量解析。`TSTreeCursor` 用于高效命令式遍历。Rust 侧 `Parser`/`Tree`/`Node<'tree>`/`TreeCursor`/`Language` 是 FFI 透明包装
- grammar 机制：`grammar.js` 用 JS DSL 编写（`seq`/`choice`/`repeat`/`optional`/`prec`/`prec.left`/`prec.right`/`prec.dynamic`/`token`/`alias`/`field`/`reserved`），`tree-sitter generate` 生成 `src/parser.c` + `grammar.json` + `node-types.json`。可选字段 `extras`/`inline`/`conflicts`/`externals`/`precedences`/`word`/`supertypes`。GLR + dynamic precedence 解决冲突；`externals` 调用 C external scanner 处理非正则词法（如 Python 缩进）
- query 机制：`.scm`（Scheme 风格）pattern 匹配语言，独立于 grammar。`TSQuery` 不可变且线程安全，`TSQueryCursor` 持运行状态。C 库只编译并暴露结构化 pattern/predicate 数据，predicate/directive 的实际执行交给上层 binding

### 查询系统
- scm 语法：pattern 是匹配节点的 S-expr。元素：节点类型 `(binary_expression ...)`、字段 `left: (...)`、否定字段 `!type_parameters`、匿名节点 `"!="`、通配 `(_)`/`_`、特殊节点 `ERROR`/`MISSING`、supertype `(expression)` 及 `supertype/subtype` 语法。操作符：capture `@name`、量词 `+ * ?`、分组 `(...)`、alternation `[...]`、anchor `.`（首位/末位/相邻兄弟）
- capture 约定：**约定，非 C 库规范**。`docs/src/4-code-navigation.md` 定义标准词汇：`@definition.{class,function,interface,method,module}` / `@reference.{call,class,implementation}`，外加 `@name`（必填）、`@doc`（可选）。highlight 体系另用 `@local.scope`/`@local.definition`/`@local.definition-value`/`@local.reference`/`@injection.content`/`@injection.language`。C 库把 capture 名当不透明字符串；`tree-sitter-tags` crate 会**强制校验**（非 `definition.*`/`reference.*` 或特殊名会返回 `InvalidCapture`，见 `crates/tags/src/tags.rs:82-86,161-167`），`tree-sitter-highlight` 只识别 `local.*` 等 6 个 capture（`highlight.rs:424-434`）
- predicate 指令：C 库不执行，binding 实现。Rust binding 识别的（`lib.rs:2607-2776`）：
  - `#eq?` / `#not-eq?` / `#any-eq?` / `#any-not-eq?` — 字符串/capture 相等
  - `#match?` / `#not-match?` / `#any-match?` / `#any-not-match?` — 对 capture 文本跑正则
  - `#any-of?` / `#not-any-of?` — 多字符串成员
  - `#set!` — 关键值属性（如 `injection.language`、`local.scope-inherits`）
  - `#is?` / `#is-not?` — 属性断言（如 `local`）
  - `#strip!` / `#select-adjacent!` — 不被 Rust binding 识别，落入 `general_predicates`，由 `tree-sitter-tags` 自行处理（`tags.rs:213-228`）：strip 用正则删文本、select-adjacent 仅保留与另一 capture 相邻的节点
  - 任何未知 operator 同样以 `general_predicates` 透传给消费者
- 编译执行：`ts_query_new(language, source, len, &err_offset, &err_type)` 编译（建 capture/field/string 表 + 结构校验，失败返回 `TSQueryError{Syntax,NodeType,Field,Capture,Structure,Language}`）。`ts_query_cursor_exec(cursor, query, node)` 启动；`ts_query_cursor_next_match` 按 match 顺序迭代，`ts_query_cursor_next_capture` 按 capture 出现顺序迭代。可设 `set_byte_range`/`set_point_range`（相交）/`set_containing_*`（完全包含）/`set_max_start_depth`/`set_match_limit`/progress 回调；capture 量词可经 `ts_query_capture_quantifier_for_id` 查询

### 语言集成方式
- native binding：C 链 `libtree-sitter.a` + 把 grammar 的 `src/parser.c` 直接编进二进制（最简路径，见 `docs/src/using-parsers/1-getting-started.md:108-114`）。Rust 用 `tree-sitter` crate + 每语言 crate（如 `tree-sitter-rust` 暴露 `LANGUAGE: LanguageFn`）；`tree-sitter-language` crate（`crates/language/src/language.rs` 仅 23 行）用 `LanguageFn` 包装 C 函数指针，解耦 grammar crate 与 tree-sitter 版本。动态加载走 `tree-sitter-loader`：运行时 `cc` 编 grammar → `.dll`/`.so` → `libloading` dlopen（`loader.rs:1066-1219`）
- WASM binding：两条路径
  - `web-tree-sitter`（JS/浏览器/Node）：Emscripten 产物，运行时 `tree-sitter.wasm` + 每语言 `tree-sitter-X.wasm`。`tree-sitter build --wasm` 自 v0.26.1 起用 wasi-sdk（自动下载）+ wasm-opt（binaryen）
  - Rust `wasm` feature：用 `wasmtime-c-api`。`WasmStore::new(engine)` + `load_language(name, bytes) -> Language`（`wasm_language.rs:46-81`），`parser.set_wasm_store(store)`。C 核心 `wasm_store.c` 把 external scanner 的 `lex_main`/`lex_keyword`/`scanner_create/scan/serialize/deserialize` 桥接进 wasm 导出函数，所以带复杂 scanner 的 grammar（如 Python）在 wasm 下也能跑
- grammar 包来源：官方每语言仓库（`tree-sitter-X`）的 npm/crates.io/PyPI 包；GitHub Releases 通过官方 reusable workflow 自动发布含 `.wasm`。第三方聚合：`tree-sitter-languages`（Python，预编译多语言）、`tree-sitter-language-pack`、`tree-sitter-wasms`（GitLab 预构建 wasm 集合）
- 新增语言流程：1) `tree-sitter init` 生成 `grammar.js`/`tree-sitter.json`/`test/` 骨架；2) 用 DSL 写 `grammar.js`；3) `tree-sitter generate` 生成 `src/parser.c`；4) 必要时写 `src/scanner.c`（external scanner）；5) 写 `queries/{highlights,locals,injections,tags}.scm`；6) `tree-sitter test`（corpus + 带注释的 query 断言）；7) `tree-sitter version` + git tag，reusable workflow 发版到 npm/crates.io/PyPI/GH（含 wasm）

### 对 Code RAG 工具的可复用价值
- **scm 是跨语言符号抽取的最薄抽象层**：你只写一次 def/ref 提取逻辑，每语言只维护一份 `tags.scm`（社区 grammar 多已自带），极大降低多语言支持成本
- **`@definition.*` / `@reference.*` / `@name` / `@doc` 词汇表值得直接采用**：GitHub search-based code nav 用的就是这套，社区 grammar 的 `queries/tags.scm` 现成可用，扩展 `@import`/`@export`/`@module` 等 RAG 专用 capture 即可
- **locals query 提供单文件作用域解析**：`@local.scope`/`@local.definition`/`@local.reference` 可让 chunking 时把局部定义上下文附到引用上，减少跨文件歧义
- **`#strip!` + `#select-adjacent!` 现成的 docstring 清洗**：strip 去注释符、select-adjacent 只留与定义相邻的 doc 注释，比手写正则更鲁棒（见 `docs/src/4-code-navigation.md:55-75` 的 Ruby 例子）
- **错误恢复对 RAG 必备**：`ERROR`/`MISSING` 节点让未完成/有语法错的代码也能出 CST，对索引任意 commit/草稿文件至关重要；增量解析（`ts_tree_edit` + `old_tree`）适合编辑器内 live 索引

### 设计取舍 / 缺口
- **纯句法，无语义**：tree-sitter 只产 CST，不解析类型、不解析跨文件引用、不处理继承/重载。"谁调用了 X" 必须在 def/ref capture 之上自建 name resolver（这正是 CodeGraph/Aider 各自补的层）
- **capture 名是约定不是规范**：C 核心不校验。`tree-sitter-tags`/`tree-sitter-highlight` 各自校验自己关心的子集，但用 py-tree-sitter / web-tree-sitter 的 RAG 库必须自己做 capture 名校验或依赖 grammar 质量
- **predicate 执行割裂**：C 库只暴露结构化 step，每个 binding/下游重实现标准集。Rust binding 处理 eq/match/any-of/set/is，但 `strip!`/`select-adjacent!` 留给消费者；Python/JS binding 各有各的覆盖度，跨 binding 行为不完全一致
- **ABI 版本约束**：库支持 ABI 13–15，老 grammar 需重新生成；新增语言要么有预构建 wasm/dll，要么用户得装 C 工具链
- **GLR + external scanner + 大文件 query 的成本**：复杂 grammar 解析开销大；query 在巨型文件上可能触发 `match_limit`（默认无上限可设），需关注 `set_match_limit`/分块查询

### 关键代码片段

**1. C API 解析生命周期（`lib/include/tree_sitter/api.h:323-327, 133-143`）**
```c
typedef struct TSNode {
  uint32_t context[4];   // 16 字节值类型，携带位置/层级，零拷贝
  const void *id;
  const TSTree *tree;
} TSNode;

TSTree *ts_parser_parse(
  TSParser *self,
  const TSTree *old_tree,   // 传旧树即增量解析；NULL 为全量
  TSInput input             // read 回调 + 编码 + 自定义 decode
);
```
说明：`TSNode` 是值类型而非指针，遍历零分配；`TSInput.read` 回调让 tree-sitter 直接吃 piece table/rope，无需先拼成整字符串——对 RAG 流式读大文件很友好。

**2. 标准_tags_查询范式（`docs/src/4-code-navigation.md:55-75`）**
```query
(
  (comment)* @doc
  .
  [
    (class
      name: [
        (constant) @name
        (scope_resolution name: (_) @name)
      ]) @definition.class
    (singleton_class
      value: [
        (constant) @name
        (scope_resolution name: (_) @name)
      ]) @definition.class
  ]
  (#strip! @doc "^#\\s*")                 ; 去掉 Ruby 注释符
  (#select-adjacent! @doc @definition.class) ; 只留紧邻定义的 doc
)
```
说明：这是 RAG 符号抽取最该照抄的模板——`(comment)* @doc . (定义节点) @definition.kind name: (...) @name`，加 strip/select-adjacent 清洗 docstring。`@role.kind` + `@name` + `@doc` 三件套即可喂给向量库。

**3. Rust binding 的 predicate 分发（`lib/binding_rust/lib.rs:2698-2715, 2762-2776`）**
```rust
"set!" => property_settings.push(Self::parse_property(
    row, operator_name, &capture_names, &string_values, &p[1..]?)),
"is?" | "is-not?" => property_predicates.push((
    Self::parse_property(row, operator_name, &capture_names, &string_values, &p[1..])?,
    operator_name == "is?",
)),
// ...any-of?...
_ => general_predicates.push(QueryPredicate {
    operator: operator_name.to_string().into(),
    args: p[1..].iter().map(|a| match a.type_ {
        TYPE_CAPTURE => QueryPredicateArg::Capture(a.value_id),
        _ => QueryPredicateArg::String(string_values[a.value_id as usize].to_string().into()),
    }).collect(),
}),
```
说明：这是理解 tree-sitter query 生态的关键——`#strip!`/`#select-adjacent!` 不在 Rust binding 的内置列表里，落入 `_ =>` 分支成为 `general_predicates`，由 `tree-sitter-tags`（`tags.rs:213-228` 按 `select-adjacent!`/`strip!` operator 字符串再分发）自己执行。意味着任何自建 RAG 抽取器都必须自己实现这两个指令，否则 docstring 清洗会静默失效。

---

## llms-txt 深挖卡片

### 一句话定位
给 LLM 看的项目根目录上下文入口标准（LLM 版 robots.txt）

### 标准规范
- **llms.txt spec**（`nbs/index.qmd:39-46`）：位于网站根路径 `/llms.txt`（可选子路径），用 Markdown 结构而非 XML，严格按序含：① 可选 BOM；② **H1**=项目名（唯一必填段）；③ **blockquote** `>` 开头的项目简短摘要；④ 零或多个非标题 markdown 段（项目详情）；⑤ 零或多个 **H2 `##` 章节分隔的"文件列表"**，每项为 `- [name](url): 可选备注` 的超链接列表。文法刻意设计成可用正则/经典解析器处理（`index.qmt:37`）。
- **llms-full.txt**：项目内**并无** `llms-full.txt` 变体；存在的是展开产物 **llms-ctx.txt**（不含 Optional 段）与 **llms-ctx-full.txt**（含 Optional 段），由 `llms_txt2ctx` 生成，spec 在 `index.qmd:27` 说明。
- **Optional 段特殊语义**（`index.qmd:66`）：名为 `## Optional` 的 H2 段在需要更短上下文时可整体跳过，用于次要信息。
- **.md 后缀约定**（`index.qmd:23`）：网站任何对 LLM 有用的页面，应在**同 URL 加 `.md`** 提供 markdown 版本；无文件名的目录 URL 则追加 `index.html.md`。nbdev 项目默认对所有页面生成 .md 版（`index.qmd:31`）。
- **llms-ctx 展开机制**（`index.qmd:27`，实现见 `llms_txt/core.py:101-117`：`mk_ctx`→`create_ctx`→`_section`→`_doc`）：把 llms.txt 解析后并行 fetch 每个 URL，剔除 HTML 注释与 base64 图片（`core.py:90-92`），pack成 XML 结构 `<project title=... summary=...><{h2小写}><doc title=... desc=...>正文</doc>...</{h2小写}></project>`，喂给 Claude 类模型；可选跳过 `Optional` 段。

### 参考实现
- **llms_txt2ctx**（CLI 入口 `llms_txt/core.py:120-131`，注册于 `pyproject.toml:26`）：`@callparse` 装饰，参数 `fname / optional / n_workers / save_nbdev_fname`，调 `create_ctx` 并按需写入 nbdev docs 目录或打印到 stdout。配套 `update.sh:1-4` 即 `llms_txt2ctx nbs/llms.txt --optional true > nbs/llms-ctx-full.txt` + 不加 flag 出 `llms-ctx.txt`。
- **解析 API**：① 生产版 `parse_llms_file`（`core.py:57-67`）返回 fastcore `AttrDict`，用 `opt_re/named_re/search` 小工具 + 正则 提 `title/summary/info`，`sections` 为 dict；② 演示版无依赖解析器 `parse_llms_txt`（`miniparse.py:8-20`，<20 行，仅 `re, itertools`）；③ 底层 `parse_link`（`core.py:36-43`）与 `_parse_links`（`core.py:46-47`）逐行解析 `- [title](url): desc`。两套实现行为基本一致（`tests/test-parse.py` 覆盖 summary 缺失/多链接/无链接）。
- **展开逻辑**：`_section`（`core.py:96-98`）用 fastcore `parallel(..., threadpool=True)` 并行下载；`_doc`（`core.py:85-93`）fetch 内容并过滤注释/内联图片；`get_doc_content`（`core.py:76-82`）对 nbdev 仓库优先读本地 `_proc/` 缓存，否则 `httpx.get`；`mk_ctx`（`core.py:101-105`）按 `optional` 旗标决定是否跳过 `Optional` 段，装成 `Project(info, *sections)`；`create_ctx`（`core.py:113-117`）串起来再 `to_xml(do_escape=False)` 输出。`get_sizes`（`core.py:108-110`）可统计各 doc 字符数以评估 context 预算。

### 对 Code RAG 工具的可复用价值
- 仓库打包工具应自动生成 `llms.txt` 作为"入口清单"：H2 段列出 README/架构文档/关键模块文档/核心源码的 markdown 链接，与 Repomix 式扁平全量包形成 **"索引层 + 全量层"** 两级结构。
- `.md` 后缀约定可直接复用为 **按需分层披露协议**：RAG 先只注入 llms.txt 概览，Agent 按问题相关性 fetch 指定 `.md`，避免一次性塞爆 context window —— 这是 Code RAG"先检索后展开"的标准范式。
- `## Optional` 段机制天然映射"核心 chunk vs 扩展 chunk"分级检索，给 RAG 提供了 spec 级别的预算闸门（短上下文丢 Optional）。
- **<20 行解析器**（`miniparse.py`）可直接嵌入 RAG 入口解析组件作零依赖兜底；`<project><section><doc>` XML 展开结构对 Claude 系/Anthropic 生态亲和，可作为打包格式之一。
- `update.sh` + `llms_txt2ctx` 的"入口文件 → 展开上下文"模式证明这类产物可作 **构建期资产** 由 CI 自动维护（更有 `save_nbdev_fname` 直接落盘 docs 目录）。

### 设计取舍 / 缺口
- **偏文档站点、非代码仓库**：H2 段是"文档文件列表"，无代码符号/调用链/import graph 概念，对 Code RAG 的代码语义场景覆盖不足。
- **链接以 markdown 为一等公民，源码入口无显式约定**：spec 强调 `.md`，example 里虽直接放 raw `.py` URL 但未规范源码文件的标记方式（无语言标注/无行号区间/无符号锚点）。
- **无元数据/预算治理**：URL 可重复、可跨站、可超长；缺 token 预算提示、chunk 大小、版本、依赖关系等 RAG 必需元信息（仅 `get_sizes` 事后量字符数）。
- **展开机制健壮性弱**：`get_doc_content` 仅 `httpx.get` 无重试/限流/缓存/离线回退，fetch 失败即抛错；`_doc` 用简单正则删注释/内联图，对复杂页面不彻底。
- **文法脆弱、层级浅**：仅 H1/H2 两级，表达不了"模块→子模块→文件"的代码树；`re.split('^## ...')` 对缩进异常或嵌套 H2 易误切。再者两套解析器对缺 summary 行为不同（core 版 `summary` 缺时键不存在，miniparse 版返回 `None`），需在 RAG 侧统一。

### 关键代码片段

**1）无依赖 <20 行解析器** — `llms_txt/miniparse.py:8-20`
```python
def parse_llms_txt(txt):
    "Parse llms.txt file contents in `txt` to a `dict`"
    def _p(links):
        link_pat = '-\s*\[(?P<title>[^\]]+)\]\((?P<url>[^\)]+)\)(?::\s*(?P<desc>.*))?'
        return [re.search(link_pat, l).groupdict()
                for l in re.split(r'\n+', links.strip()) if l.strip()]
    start,*rest = re.split(fr'^##\s*(.*?$)', txt, flags=re.MULTILINE)
    sects = {k: _p(v) for k,v in dict(chunked(rest, 2)).items()}
    pat = '^#\s*(?P<title>.+?$)\n+(?:^>\s*(?P<summary>.+?$)$)?\n+(?P<info>.*)'
    d = re.search(pat, start.strip(), (re.MULTILINE|re.DOTALL)).groupdict()
    d['sections'] = sects
    return d
```
说明：先按 `^## ` 切出头部 + 交替的(段名,段体) 列表，`chunked(rest,2)` 配对成 dict；头部再用单条正则提 title/可选 summary/info。核心思路 = **正则切章节 + 正则切链接**，可直接搬到 Code RAG 入口解析。

**2）XML context 装配（解析→并行 fetch→跳过 Optional→序列化）** — `llms_txt/core.py:101-117`
```python
def mk_ctx(d, optional=True, n_workers=None):
    "Create a `Project` with a `Section` for each H2 part in `d`, optionally skipping the 'optional' section."
    skip = '' if optional else 'Optional'
    sections = [_section(k, v, n_workers=n_workers) for k,v in d.sections.items() if k!=skip]
    return Project(title=d.title, summary=d.summary)(d.info, *sections)

def create_ctx(txt, optional=False, n_workers=None):
    "A `Project` with a `Section` for each H2 part in `txt`, optionally skipping the 'optional' section."
    d = parse_llms_file(txt)
    ctx = mk_ctx(d, optional=optional, n_workers=n_workers)
    return to_xml(ctx, do_escape=False)
```
说明：`optional` 旗标通过 `skip` 字符串控制是否排除 `Optional` 段；每个 H2 段 → 一个 XML tag（tag 名=段标题小写）内含多个 `<doc title=... desc=...>`。这套"清单→并行抓取→XML 包"正是 Code RAG "sparse/分层"打包可复用的骨架（但需补缓存/预算/源码语义三处短板）。

---

## LlamaIndex CodeHierarchy 深挖卡片

### 一句话定位
基于 tree-sitter AST 把代码切成父子层级 node，配 skeleton 摘要与关键词检索的代码 RAG 范式

### CodeHierarchyNodeParser 核心
- **继承关系**：`CodeHierarchyNodeParser(NodeParser)` —— 继承自 `NodeParser`（`interface.py:50`，进而 `TransformComponent`），**不**继承 `CodeSplitter`。主仓库 `node_parser/text/code.py:19` 的 `CodeSplitter(TextSplitter)` 是独立的扁平 AST 切分器，只被 pack 当作可选的「二级切分器」字段 `code_splitter: Optional[CodeSplitter]`（`code_hierarchy.py:223`）注入。即：**真正的 hierarchy 实现只在 pack 里，主仓库只提供了���层 CodeSplitter**。
- **切分策略**：纯 tree-sitter AST 递归遍历（`_chunk_node`，`code_hierarchy.py:328`），按 `signature_identifiers` 字典登记的 node type（如 `function_definition` / `class_definition` / `element`）作为「可切 scope」边界；**不按 chunk_size 切**，而是按 AST scope 边界。chunk_size 控制交给可选的 `CodeSplitter` 二次切（`code_hierarchy.py:617-685`）。太小（`< min_characters=80`）的 chunk 不生成 document，其子节点「上浮」给最近祖先（`code_hierarchy.py:369-372`）。
- **层级 node 生成**：`_chunk_node` 递归遍历 AST children，遇登记 type 或 root 就建一个 `TextNode`（`code_hierarchy.py:386`），并双向写 `NodeRelationship.CHILD` / `NodeRelationship.PARENT`（`code_hierarchy.py:420-436`）。根节点强制产出 document（`_root=True`）。父子关系存在 `relationships` 里而非 metadata，靠 `as_related_node_info()` 互引。
- **metadata 字段**：`inclusive_scopes`（List[{name, type, signature}]，祖先 scope 栈，`code_hierarchy.py:389`）、`start_byte`、`end_byte`（byte 偏移，非 line）、`language`（`code_hierarchy.py:604`）、`filepath`（从原 Document 继承，`code_hierarchy.py:606`）。**没有 start_line/end_line，没有显式 parent/children 字段在 metadata 里**——父子走 relationships。

### code_hierarchy pack
- **code_hierarchy.py**（905 行）：定义 `CodeHierarchyNodeParser`（`code_hierarchy.py:194`）。核心方法 `_chunk_node`（:328，递归 AST + 父子 wiring）、`get_code_hierarchy_from_nodes`（:464，把 inclusive_scopes 拼成 repo_map 嵌套 dict + markdown 大纲）、`_parse_nodes`（:522，主入口，含 SCM fallback 与 CodeSplitter 二级切）、`_get_replacement_text`（:795，skeleton 替换文本生成）。内置 5 语言 signature 配置（`_DEFAULT_SIGNATURE_IDENTIFIERS`，:74）+ 5 语言注释/作用域配置（`_COMMENT_OPTIONS`，:152）。
- **base.py**（48 行）：`CodeHierarchyAgentPack(BaseLlamaPack)`（`base.py:11`）。把 `CodeHierarchyKeywordQueryEngine` 包成 `QueryEngineTool`（name=`"code_search"`，`base.py:22-26`），交给 `FunctionAgent`，system_prompt 用 `query_engine.get_tool_instructions()`（即 repo_map 大纲 + 使用说明，`base.py:31`）。本质是「agent + 一个 code_search 工具」。
- **query_engine.py**（158 行）：`CodeHierarchyKeywordQueryEngine(CustomQueryEngine)`（`query_engine.py:22`）。建关键词倒排索引 `node_dict: Dict[keyword, (start_byte, text)]`（`_setup_node_dict`，:32），关键词来源 = uuid ∪ module name ∪ scope name（`_extract_keywords_from_node`，:43）。`custom_query`（:83）纯精确匹配；未命中则沿 `repo_map` 向上找 parent（`get_parent_dict_recursive`，:102）返回 parent text。
- **hierarchy-aware 检索**：**完全不用向量**。检索范式 = `repo_map markdown 大纲`（塞进 agent system_prompt / tool description）→ LLM 自主选关键词/uuid 调 `code_search` → engine 精确匹配返回 node 全文。skeleton 注释 `Code replaced for brevity. See node_id {uuid}`（`code_hierarchy.py:764`）让 LLM 看到 skeleton 后能用 uuid「展开」子节点。若查的 key 是子 scope 但未单独索引，回退到最近 parent（`query_engine.py:120-128`）。这是「用结构 + agent 自主展开」代替向量检索的范式。

### 对 Code RAG 工具的可复用价值
- **`inclusive_scopes`（祖先 scope 栈 = name+type+signature）+ byte 偏移**的 metadata schema 可直接采用，比单存 start/end line 信息量大得多，能还原「这个 chunk 属于哪个 class/method」且带 signature 供 LLM 读。
- **skeleton 机制**（父节点把子节点全文替换成 signature + `See node_id {uuid}` 注释）极巧妙：既压缩父节点 token，又给 LLM 一个明确的「展开入口」uuid，实现按需下钻。Code RAG 工具可直接借鉴，是 hierarchy-aware RAG 的精髓。
- **repo_map（filepath > class > method 嵌套 dict → markdown 大纲）作为 tool description**，让 agent 自主决定查哪个节点——「用结构代替向量」的轻量检索范式，零向量成本。
- **tree-sitter `signature_identifiers` 的配置化设计**（每种语言登记哪些 node type 是可切 scope、如何抓 signature 起止与 name identifier）可扩展到新语言；并保留 SCM `.scm` 文件作为 fallback（`pytree-sitter-queries/` 含 16 种语言 tags）。
- **两级切分 + 关系 rewire**（AST scope 切 → 可选 CodeSplitter 按 chunk_size 二次切，并把父子关系 rewire 到第一个子 chunk，`code_hierarchy.py:629-680`）值得参考，解决「scope 太大」问题同时保留层级。

### 设计取舍 / 缺口
- **pack 已 deprecated**：`__init__.py:3-8` 有 `DeprecationWarning`，主仓库未把 `CodeHierarchyNodeParser` 合进 `node_parser/`（那里只有底层 `CodeSplitter`）。上游对这套 hierarchy 方案的支持在收缩，不能当长期依赖，只能当范式参考。
- **检索是纯关键词 exact match + uuid**，无向量/语义检索：对「模糊描述找代码」无能为力；重载、同名、拼写差异都会失效。`_extract_name_from_node` 还用「同名字典里取 start_byte 更小的」做去重（`query_engine.py:74-80`），对重载/嵌套同名会丢节点。
- **不做调用链/引用关系**：SCM 文件里 capture 了 `name.reference.call`（如 `tree-sitter-python-tags.scm:7-12`），但 `_parse_nodes` 的 fallback 分支只用了 `name.definition.*`（`code_hierarchy.py:582`），引用信息被丢弃。没有「谁调用了这个函数」的能力。
- **不做重要性/中心性排序**：所有 node 平等进 `node_dict`，无 PageRank / 调用度数 / 文件热度等排序，检索结果无优先级。
- **强依赖 LlamaIndex 框架**：耦合 `NodeParser` / `TextNode` / `NodeRelationship` / `BaseLlamaPack` / `FunctionAgent` / `QueryEngineTool` / `CustomQueryEngine`，schema 绑死 LlamaIndex 的 `BaseNode`，无法直接移植到自研 Code RAG 工具，需重写 schema 层。
- **语言覆盖与 fallback 质量有限**：`_DEFAULT_SIGNATURE_IDENTIFIERS` 只内置 python/html/cpp/typescript/php（`code_hierarchy.py:74-138`）；其他 11 种语言走 SCM fallback，但 fallback 分支只抓 name、**不抓 signature 起止边界**（`code_hierarchy.py:582-590`），导致 skeleton 替换质量差。`_COMMENT_OPTIONS` 也只配了 5 语言，新语言会 `KeyError`（`code_hierarchy.py:778`）。
- **byte 偏移而非 line 偏移**：对人/编辑器/IDE 不友好，无 `start_line`/`end_line`；如要和 grep/diff 工具联动需自己换算。

### 关键代码片段

**片段 1 —— 层级 node 创建 + 父子关系 wiring**（`code_hierarchy.py:386-436`）
```python
# 遇到 signature_identifiers 登记的 type 或 root，建 TextNode
this_document = TextNode(
    text=current_chunk,
    metadata={
        "inclusive_scopes": [cl.dict() for cl in _context_list],  # 祖先 scope 栈
        "start_byte": start_byte,
        "end_byte": parent.end_byte,
    },
    relationships={NodeRelationship.CHILD: []},
)
# ...
# 子 document 挂到 this_document 的 CHILD，反向写 PARENT
this_document.relationships[NodeRelationship.CHILD].append(
    next_chunks.this_document.as_related_node_info()
)
next_chunks.this_document.relationships[NodeRelationship.PARENT] = this_document.as_related_node_info()
```
说明：层级关系的核心——`inclusive_scopes` 是祖先栈，父子走双向 `NodeRelationship`。

**片段 2 —— repo_map 拼装（hierarchy → 可检索大纲）**（`code_hierarchy.py:464-520`）
```python
@staticmethod
def get_code_hierarchy_from_nodes(nodes, max_depth=-1) -> Tuple[Dict, str]:
    out: Dict[str, Any] = defaultdict(dict)
    def recur_inclusive_scope(node, i, keys):
        if i >= len(node.metadata["inclusive_scopes"]): return
        scope = node.metadata["inclusive_scopes"][i]
        this_dict = get_subdict(keys)
        if scope["name"] not in this_dict:
            this_dict[scope["name"]] = defaultdict(dict)
        if i < max_depth or max_depth == -1:
            recur_inclusive_scope(node, i + 1, [*keys, scope["name"]])
    for node in nodes:
        filepath = node.metadata["filepath"].split("/")
        filepath[-1] = filepath[-1].split(".")[0]   # 文件名去扩展作为顶层 key
        recur_inclusive_scope(node, 0, filepath)
    return out, dict_to_markdown(out)   # 嵌套 dict + markdown 大纲
```
说明：把每个 node 的 `inclusive_scopes` 栈沿 filepath 拼成 `filepath > class > method` 嵌套 dict，再渲染成 markdown 给 LLM 当「目录」读。这是「结构代替向量」检索的入口。

**片段 3 —— skeleton 替换（父节点压缩 + uuid 展开入口）**（`code_hierarchy.py:795-867`，精简）
```python
@classmethod
def _get_replacement_text(cls, child_node: TextNode) -> str:
    signature = child_node.metadata["inclusive_scopes"][-1]["signature"]
    language = child_node.metadata["language"]
    comment_options = _COMMENT_OPTIONS[language]
    indent_char, indent_per_lvl, first_lvl = cls._get_indentation(child_node.text)
    replacement_txt = indent_char * indent_per_lvl * first_lvl + signature
    if comment_options.scope_method == _ScopeMethod.BRACKETS:        # C++/TS/PHP
        replacement_txt += " {\n" + indent*(first_lvl+1) + \
            comment_options.comment_template.format(
                cls._get_comment_text(child_node)) + "\n" + indent*first_lvl + "}"
    elif comment_options.scope_method == _ScopeMethod.INDENTATION:   # Python
        replacement_txt += "\n" + indent*(first_lvl+1) + \
            comment_options.comment_template.format(cls._get_comment_text(child_node))
    # _get_comment_text => "Code replaced for brevity. See node_id {uuid}"
    return replacement_txt
```
说明：父节点里子节点的全文被替换成 `signature + 注释(含子节点 uuid)`。LLM 读父节点看到 skeleton，需要子节点细节时拿 uuid 去 query engine 查——这是按需下钻的精髓，也是 Code RAG 压缩上下文同时保留可展开入口的关键技巧。
