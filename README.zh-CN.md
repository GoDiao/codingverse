# codingverse

[English](./README.md) · **简体中文**

> 统一的 Code RAG 工具箱 —— **一次建索引,三种出口:打包 / 检索 / 观测。**

**[→ 官方展示页 godiao.github.io/codingverse](https://godiao.github.io/codingverse/)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-233%20passing-success.svg)](#开发)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178c6.svg)](https://www.typescriptlang.org/)

codingverse 把一个代码仓库变成单一的 SQLite 索引(符号、调用边、代码块),再通过三种互补的出口对外提供服务:

- **打包(pack)** —— 按 token 预算组装分层的 LLM 上下文文件
- **检索(search)** —— 混合检索(BM25 + 调用图,经 RRF 融合)
- **观测(observe)** —— 六面板 Dashboard,直观查看索引里到底有什么

一切构建在 tree-sitter 解析和本地调用图之上 —— 无向量嵌入、无外部服务、无 API key。

---

## 目录

- [为什么](#为什么)
- [特性](#特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [三种模式](#三种模式)
- [CLI 命令参考](#cli-命令参考)
- [MCP 集成](#mcp-集成)
- [Dashboard](#dashboard)
- [语言支持](#语言支持)
- [架构](#架构)
- [开发](#开发)
- [贡献](#贡献)
- [许可证](#许可证)

## 为什么

把整个仓库喂给 LLM 浪费 token;手工挑文件又会丢上下文。codingverse 一次性建好索引,让你精确取出所需的切片:

- 按 **token 预算**打包最重要的代码,其余压缩成骨架/大纲而非直接丢弃。
- 只打包**变更**内容(`--changed` / `--since`)及其调用图影响半径。
- 只打包**查询**命中的内容(`--query`)及其调用图邻域。
- 检索基于真实调用图,结果包含调用者/被调用者,而不只是文本匹配。

## 特性

- **分层打包** —— 每个符号以四种保真度之一渲染(`full` / `skeleton` / `outline` / `omit`)以适配 token 预算,按调用图上的 PageRank 排序。
- **变更范围打包** —— `cv pack --changed` / `--since <ref>` 打包变更文件及其反向调用图影响。
- **检索驱动打包** —— `cv pack --query "<文本>"` 打包检索命中及其双向调用图邻域。
- **混合检索** —— BM25 词法检索与真实调用图扩展(调用者 + 被调用者)经 RRF(倒数排名融合)融合。
- **调用图导航** —— 在已解析的边上做 `callers` / `callees` / `impact` 遍历。
- **持续索引** —— `cv watch` 在文件变更时重建索引;`cv serve --watch` 让 Dashboard 实时刷新。
- **观测 Dashboard** —— 由 `node:http` 提供的零构建 SPA,共六个面板。
- **MCP 服务** —— 通过 stdio 暴露 7 个工具,便于编辑器/智能体集成。
- **多语言** —— TypeScript、JavaScript、Python、Go、Rust、Java。
- **纯本地** —— SQLite 索引,无嵌入向量,无网络请求。

## 安装

需要 **Node ≥ 20** 与 **pnpm**。codingverse 是 pnpm monorepo,从源码构建:

```bash
git clone <你的-fork-地址> codingverse
cd codingverse
pnpm install
pnpm -r build
```

CLI 入口是 `packages/cli/dist/bin.js`。可直接运行,或配置一个 shell 别名:

```bash
alias cv="node /绝对路径/codingverse/packages/cli/dist/bin.js"
```

下文假设 `cv` 已指向该二进制。

## 快速开始

```bash
# 1. 为仓库建索引(符号、调用边、代码块)
cv index /path/to/repo

# 2. 计算 PageRank,让打包/检索能优先重要符号
cv rank /path/to/repo

# 3a. 打包 —— 写出 32k token 的上下文文件
cv pack /path/to/repo --budget 32000 -o context.xml

# 3b. 检索 —— 混合检索
cv search "token budget" /path/to/repo

# 3c. 观测 —— 打开 Dashboard(http://127.0.0.1:7331)
cv serve /path/to/repo

# 工作时保持索引常热
cv watch /path/to/repo
```

聚焦上下文的范围打包:

```bash
# 仅相对 HEAD 变更的文件 + 其影响半径
cv pack . --changed --budget 16000

# 仅相对某 ref 变更的文件
cv pack . --since main --budget 16000

# 仅查询命中的文件 + 其调用图邻域
cv pack . --query "retry backoff" --budget 16000
```

## 三种模式

| 模式 | 命令 | 你得到什么 |
|------|------|-----------|
| **打包** | `cv pack` | 单个分层上下文文件(`xml` / `markdown` / `json`),按 token 预算裁剪。重要符号保持 `full`,其余降级为 `skeleton` → `outline` → `omit`。骨架可用 `cv expand` 按需重新展开。 |
| **检索** | `cv search` | 融合 BM25(词法)与调用图扩展(结构)的排序结果。加 `--json` 输出机器可读格式。 |
| **观测** | `cv serve` | 本地 Dashboard,含六个面板:总览、Token 地图、代码图、检索、打包、同步。 |

## CLI 命令参考

| 命令 | 说明 |
|------|------|
| `cv index [path]` | 构建/刷新 SQLite 索引(符号、边、块)。`--scip <file>` 导入 SCIP 索引以获得精确边。 |
| `cv rank [path]` | 在调用图上计算 PageRank,写回 `nodes.pagerank`。`--damping`、`--max-iter`。 |
| `cv pack [path]` | 打包为分层 LLM 上下文文件。`-o`、`-f xml\|markdown\|json`、`-b <tokens>`、`--changed`、`--since <ref>`、`--query <text>`、`-k`、`-d`、`--always-full <globs>`。 |
| `cv search <query> [path]` | 混合检索(BM25 + 调用图,经 RRF)。`-k <n>`、`--json`。 |
| `cv expand [id] [path]` | 按 id 展开骨架符号,或 `--list` 列出上次打包的可展开 id。`--meta` 仅显示元数据。 |
| `cv callers <node\|name> [path]` | 谁调用了该节点(反向 BFS)。`-d <depth>`。 |
| `cv callees <node\|name> [path]` | 该节点调用了谁(正向 BFS)。`-d <depth>`。 |
| `cv impact <node\|name> [path]` | 影响半径(反向 BFS + 容器下钻)。`-d <depth>`。 |
| `cv status [path]` | 索引状态与观测状态。`--token-map`、`--json`。 |
| `cv serve [path]` | 启动 Dashboard HTTP 服务。`-p <port>`、`--host`、`--watch`。 |
| `cv watch [path]` | 文件变更时持续重建索引。`--debounce <ms>`、`--no-rank`。 |

完整选项见 [docs/cli-reference.md](./docs/cli-reference.md)。

## MCP 集成

`cv-mcp` 服务(位于 `@codingverse/mcp`)通过 Model Context Protocol 以 stdio 暴露引擎,共 7 个工具:

`search` · `pack` · `expand` · `get_file` · `callers` · `callees` · `impact`

让支持 MCP 的客户端指向构建产物(`packages/mcp/dist/bin.js`)。客户端配置示例:

```json
{
  "mcpServers": {
    "codingverse": {
      "command": "node",
      "args": ["/绝对路径/codingverse/packages/mcp/dist/bin.js", "/path/to/repo"]
    }
  }
}
```

使用前需先建索引(`cv index`)。

## Dashboard

`cv serve` 在 `127.0.0.1:7331` 启动零构建单页应用(默认仅本机可访问)。六个面板:

1. **总览(Overview)** —— 索引统计、健康度、语言分布
2. **Token 地图(Token map)** —— token 预算去向的树状图
3. **代码图(Code graph)** —— 可交互调用图,支持调用者/被调用者高亮
4. **检索(Retrieval)** —— 检索检查器:BM25 路 vs 调用图路,经 RRF 融合
5. **打包(Pack)** —— 实时分层打包预览,含预算/策略控件与完整产出导出
6. **同步(Sync)** —— 上次索引运行与变更文件状态

用 `cv serve --watch` 让面板随代码编辑实时刷新。

## 语言支持

| 语言 | 扩展名 | 提取的符号 |
|------|--------|-----------|
| TypeScript | `.ts` `.mts` `.cts` `.tsx` | class、interface、type、enum、function、method |
| JavaScript | `.js` `.mjs` `.cjs` `.jsx` | class、function、method |
| Python | `.py` `.pyw` | class、function、method |
| Go | `.go` | func、method、struct、interface、type |
| Rust | `.rs` | fn、struct、enum、trait、type |
| Java | `.java` | class、interface、enum、method、constructor |

新增一门语言只需一个 tree-sitter tags 查询加一条注册项 —— 见 [docs/architecture.md](./docs/architecture.md#adding-a-language)。

## 架构

codingverse 是包含五个包的 pnpm monorepo:

| 包 | 职责 |
|----|------|
| `@codingverse/shared` | 共享类型、常量、SQLite schema |
| `@codingverse/core` | 引擎:ingest → parse → index → assemble 管线 |
| `codingverse` (cli) | `cv` 命令行界面 |
| `@codingverse/dashboard` | 观测模式 HTTP 服务 + SPA |
| `@codingverse/mcp` | 基于 stdio 的 MCP 服务 |

管线:**ingest**(遍历 + gitignore)→ **parse**(tree-sitter → 符号 + 引用 + 块)→ **index**(SQLite + FTS5,把引用解析成调用边)→ **assemble**(分层打包 / 混合检索)。完整设计见 [docs/architecture.md](./docs/architecture.md)。

## 开发

```bash
pnpm install
pnpm -r build       # 构建所有包
pnpm -r test        # 运行测试套件(233 个测试,集中在 core)
pnpm -r typecheck   # 只做类型检查,不产出
```

测试位于 `@codingverse/core`,覆盖解析、索引、引用解析、排序、打包、检索融合、范围打包、watch 与多语言抽取。

## 贡献

欢迎贡献。开发环境、项目结构与 PR 流程见 [CONTRIBUTING.md](./CONTRIBUTING.md),并请阅读[行为准则](./CODE_OF_CONDUCT.md)。

## 许可证

[MIT](./LICENSE)
