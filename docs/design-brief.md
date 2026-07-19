# codingverse — Design Brief

**For:** External design team
**Deliverable:** Marketing landing page + reusable brand visual system
**Prepared by:** codingverse team
**Status:** Draft for design engagement
**Last updated:** 2026-07

---

## 0. How to read this brief

This document defines *what* we need and *why*, and gives you a working
prototype and a set of existing design tokens as a **starting point — not a
cage**. We have a clear direction we like (see §5–6), but you are the design
experts: if you can reinterpret or elevate it while serving the goals in §2,
we want to see that.

Everything marked **[MUST]** is a hard requirement (usually technical or
content). Everything else is direction and intent, open to your craft.

---

## 1. What codingverse is

codingverse is a **unified Code RAG toolkit** — a developer tool that turns a
code repository into a single local index, then serves that index three ways:

- **pack** — assemble a token-budgeted, layered context file for an LLM
- **search** — hybrid retrieval (lexical + a real call graph)
- **observe** — a live dashboard to inspect what the index holds

It is open-source (MIT), runs entirely locally (no cloud, no embeddings, no API
keys), and is built for developers who work with LLMs on real codebases.

The one-line positioning:

> **Index once. Three ways out.**

## 2. Objectives of this engagement

The landing page and brand system must:

1. **Establish a premium, distinctive identity.** codingverse should feel
   grand, sophisticated, and "cosmic" — not another generic dev-tool template.
   The name and the identity should feel inevitable together.
2. **Communicate the core idea in seconds.** A visitor should grasp "one index,
   three outputs" before scrolling.
3. **Earn developer trust.** The audience is technical and allergic to hype.
   Show substance (real commands, real concepts), not marketing fluff.
4. **Drive two actions:** *Get started* (to the GitHub repo / docs) and
   *Star / explore on GitHub*.
5. **Produce a reusable visual system** that we can later apply to the product
   dashboard and docs, so the whole ecosystem feels like one brand.

### Non-goals

- No e-commerce, sign-up, or account flows. This is a marketing + open-source
  entry page.
- No blog/CMS at this stage (may come later — keep the system extensible).
- Do not invent product features or claims not present in this brief.

## 3. Audience

**Primary:** Professional software engineers and AI engineers who use LLMs
(Claude, GPT, Cursor, etc.) against real, large codebases and feel the pain of
context limits. Comfortable with a CLI. Skeptical of marketing.

**Secondary:** Engineering leads and open-source enthusiasts evaluating tools;
contributors who might star, fork, or contribute.

**Implications for design:**
- Respect their intelligence. Precise language, real commands, no buzzwords.
- Dark UI is expected and welcomed in this space.
- Performance and accessibility matter to this audience specifically.

## 4. Tone & personality

| We are | We are not |
|--------|-----------|
| Grand, cosmic, spacious | Loud, busy, gimmicky |
| Precise, technical, honest | Hand-wavy, hype-driven |
| Editorial, considered | Templated, "startup landing page" |
| Confident, calm | Salesy, urgent |

Think: the title sequence of a serious science documentary, or the identity of
a high-end observatory — vast, quiet, and expensive-feeling.

## 5. Visual direction — "Monolith" (starting point, reinterpretable)

We explored several directions and chose one we call **Monolith**. Treat it as
a strong starting point you may reinterpret or elevate — not a locked spec.

**The essence of Monolith:**
- **Near-black "void" background** — deep, cosmic, almost black.
- **Ivory ink** — warm off-white text, not pure white.
- **A single accent color used sparingly** — a "cosmos" violet. Restraint is
  the point; the accent should feel precious, not decorative.
- **Oversized editorial typography** — a display serif at large sizes carries
  the grandeur. Scale and whitespace create the "monumental" feeling, *not*
  color or ornament.
- **Generous negative space** — luxury through emptiness.
- **A subtle starfield** — barely-there depth, never noisy.

What to avoid: gradient-heavy "SaaS" looks, glassmorphism overload, busy
illustrations, neon, or a dense instrument-panel aesthetic.

**You may explore:** typographic pairing, a refined motion language, a
distinctive logo/wordmark, an original "cosmic" visual metaphor for the
"one index → three outputs" idea, and how the accent color is deployed.

## 6. Existing design tokens (baseline, not final)

We built a working prototype (see §11) with the tokens below. Use them as a
reference for the intended feel. You are free to refine values, propose a
better type pairing, and expand the palette (e.g. states, secondary accents) —
but keep the Monolith essence.

### Color

| Token | Value | Role |
|-------|-------|------|
| `void` | `#0a0a0c` | Primary background (near-black) |
| `void-2` | `#101014` | Raised surface |
| `void-3` | `#16161c` | Highest surface / bars |
| `ink` | `#f4f2ec` | Primary text (ivory) |
| `ink-dim` | `#a8a6a0` | Secondary text |
| `ink-faint` | `#6b6a66` | Tertiary / captions |
| `cosmos` | `#5b4bff` | The single accent (violet) |
| `cosmos-soft` | `#8b7dff` | Accent, lighter |
| `line` | `rgba(244,242,236,0.08)` | Hairline dividers |

### Type

- **Display:** Fraunces (serif) — used large for headlines, the "editorial" feel.
- **Sans:** Inter — body copy and UI.
- **Mono:** JetBrains Mono — code, labels, eyebrows, meta.

*You may propose alternatives.* If you do, keep: a characterful display serif
for grandeur, a clean neutral sans for reading, and a mono for code/technical
texture.

### Spacing & shape

- Content width: ~1180px max, ~92vw on smaller screens.
- Corner radius: ~14px for cards/containers; pill (999px) for buttons and tags.
- Rhythm: large section padding (100–160px vertical) to protect whitespace.

## 7. Page structure & content

The landing page is a single scrolling page. Below is the required section
order and the **actual approved copy in English and Chinese**. Copy is
**[MUST]** (it's product-accurate); layout and treatment are yours.

The site must be **bilingual (English + Simplified Chinese)** with a visible
in-page toggle (see §8).

### 7.1 Navigation (sticky)

- Brand wordmark: `codingverse`
- Links: *The three modes* / *Why* / *Get started* / *GitHub* (external)
- Language toggle (EN ⇄ 中文)

### 7.2 Hero **[MUST copy]**

| Element | English | 中文 |
|---------|---------|------|
| Eyebrow | Unified Code RAG toolkit | 统一的 Code RAG 工具箱 |
| Title | codingverse | codingverse |
| Tagline | Index once. Three ways out. | 一次索引,三种出口。 |
| Sub | Turn a repository into a single local index — then pack it for an LLM, search it with a real call graph, or observe it on a live dashboard. No embeddings. No services. No keys. | 把一个代码仓库变成单一的本地索引 —— 再为 LLM 打包、用真实调用图检索,或在实时 Dashboard 上观测。无向量嵌入,无外部服务,无 API key。 |
| Primary CTA | Get started | 开始使用 |
| Secondary CTA | View on GitHub | 在 GitHub 查看 |
| Meta row | 100% local · 6 languages · MIT | 100% 本地 · 6 种语言 · MIT |

### 7.3 The three modes **[MUST copy]**

Section title: **One index. Three outputs.** / **一次索引,三种出口。**
Lead: *Every repository becomes a single SQLite index of symbols, call edges,
and chunks. From that one index, three complementary modes.* /
*每个仓库都成为单一的 SQLite 索引 —— 符号、调用边、代码块。从这一份索引,派生三种互补的模式。*

| Mode | English name / desc | 中文 名称 / 描述 |
|------|--------------------|-----------------|
| pack | **Pack** — Assemble a token-budgeted, layered context file for an LLM. Important symbols stay full; the rest degrade to skeleton, outline, or omit — never blindly truncated. | **打包 Pack** —— 为 LLM 组装按 token 预算裁剪的分层上下文文件。重要符号保持完整,其余降级为骨架、大纲或省略 —— 绝不盲目截断。 |
| search | **Search** — Hybrid retrieval: BM25 lexical matching fused with a real call graph, so results carry callers and callees — not just text hits. | **检索 Search** —— 混合检索:BM25 词法匹配与真实调用图融合,结果带上调用者与被调用者 —— 而不只是文本命中。 |
| observe | **Observe** — A six-board dashboard to see what the index actually holds — token map, code graph, retrieval inspector, and live pack preview. | **观测 Observe** —— 六面板 Dashboard,直观查看索引里到底有什么 —— Token 地图、代码图、检索检查器、实时打包预览。 |

### 7.4 Why / value **[MUST copy]**

Section title: **Context, not the whole repo.** / **要上下文,不要整个仓库。**
Lead: *Feeding a whole repo to an LLM wastes tokens. Hand-picking files loses
context. codingverse extracts exactly the slice you need.* /
*把整个仓库喂给 LLM 浪费 token,手工挑文件又丢上下文。codingverse 精确取出你所需的那一片。*

Four value points:

| # | English | 中文 |
|---|---------|------|
| 1 | **Token budget, respected** — Pack the most important code at full fidelity and compress the rest to skeletons, ranked by PageRank over the call graph. | **尊重 token 预算** —— 把最重要的代码以完整保真度打包,其余压缩成骨架,按调用图上的 PageRank 排序。 |
| 2 | **Scoped by change or query** — Pack only what changed plus its impact radius, or only what a query matches plus its call-graph neighborhood. | **按变更或查询聚焦** —— 只打包变更内容及其影响半径,或只打包查询命中及其调用图邻域。 |
| 3 | **A real call graph** — Retrieval walks resolved caller/callee edges, so a match brings its structural neighbors with it. | **真实的调用图** —— 检索沿已解析的调用者/被调用者边行走,一次命中会带上它的结构近邻。 |
| 4 | **Entirely local** — A SQLite index built from tree-sitter parses. No embeddings, no external services, no API keys. | **完全本地** —— 由 tree-sitter 解析构建的 SQLite 索引。无嵌入向量,无外部服务,无 API key。 |

### 7.5 Get started / command demo **[MUST copy]**

Section title: **Get started in five commands.** / **五条命令即可上手。**
Lead: *Build from source (Node ≥ 20, pnpm), then index and go.* /
*从源码构建(Node ≥ 20、pnpm),然后建索引即用。*

Render as a terminal block. Commands are fixed; comments are localized:

```
# build the index for a repo        (# 为仓库建索引)
cv index ./my-repo
# rank symbols by importance         (# 按重要性给符号排序)
cv rank ./my-repo
# pack a 32k-token context file       (# 打包 32k token 的上下文文件)
cv pack ./my-repo --budget 32000 -o context.xml
# or search with the call graph       (# 或用调用图检索)
cv search "retry backoff" ./my-repo
# or open the dashboard               (# 或打开 Dashboard)
cv serve ./my-repo
```

### 7.6 Languages **[MUST copy]**

Section title: **Six languages, one convention.** / **六种语言,一套约定。**
Lead: *Adding a language is one tree-sitter query plus one registry entry.* /
*新增一门语言只需一个 tree-sitter 查询加一条注册项。*

Languages: TypeScript · JavaScript · Python · Go · Rust · Java

### 7.7 Footer

- Large brand wordmark
- Tagline (localized): *Index once. Three ways out.* / *一次索引,三种出口。*
- Links: GitHub · Architecture (docs) · CLI reference (docs) · MIT (license)
- Copyright: © 2026 godiao · MIT License

### Optional / future sections (design the system to accommodate)

- A hero visual or looped animation of the "one index → three outputs" idea.
- Real dashboard screenshots (the product dashboard will be re-themed to match
  this system later; leave a slot for a showcase).
- Social proof / stars, once available.

## 8. Interaction & motion

- **Bilingual toggle [MUST]:** one control switches all copy between English
  and Simplified Chinese. Preference should persist (localStorage) and default
  sensibly to the visitor's browser language. No page reload.
- **Motion:** restrained and elegant. Subtle scroll-reveal (fade + slight rise)
  is welcome; nothing bouncy or attention-seeking. Motion should reinforce
  "calm and vast," not "playful."
- **Reduced motion [MUST]:** honor `prefers-reduced-motion` — disable non-
  essential animation and reveal content immediately.
- **Hover states:** deliberate and quiet (e.g. accent on borders, gentle lift).
- Smooth in-page anchor scrolling for nav links.

## 9. Technical constraints **[MUST]**

The page ships as a **static site on GitHub Pages**. Please deliver accordingly:

- **Static only** — HTML/CSS/JS. No server runtime. A build step (e.g. Vite,
  Astro) is acceptable *if* the output is fully static; if you use one, provide
  the build config and instructions. A zero-build hand-authored option is also
  welcome and is what the current prototype uses.
- **No heavy frameworks required.** If you use one, justify it and keep the
  payload lean. Prefer system/near-native performance.
- **Self-contained assets** — fonts via a CDN link or self-hosted; all images
  optimized. Avoid tracking/analytics unless we request it.
- **Performance:** target Lighthouse ≥ 95 for Performance and Accessibility on
  desktop and mobile. First load should feel instant.
- **Responsive [MUST]:** flawless from 320px mobile to large desktop. Define
  behavior for the oversized display type at small sizes (it must not overflow).
- **Accessibility [MUST]:** semantic HTML, sufficient contrast (note: ivory on
  near-black passes easily; verify the violet accent on dark for any text use),
  visible focus states, keyboard-navigable, `alt` text, and correct `lang`
  attributes that update with the toggle.
- **Browser support:** current Chrome, Safari, Firefox, Edge.
- **SEO basics:** title, meta description, Open Graph / Twitter card image and
  tags for nice link previews.

## 10. Brand visual system — deliverables

Beyond the page, we need a reusable system so future surfaces (product
dashboard, docs, social) feel unified.

- **Logo / wordmark:** a distinctive treatment of "codingverse" (and a compact
  mark/monogram for favicon, avatars, social). Provide SVG.
- **Color system:** finalized palette with roles and usage rules, including
  states (success/warning/error) that fit the Monolith world, plus contrast
  notes.
- **Type system:** chosen families, the scale (sizes/weights/line-heights for
  display, headings, body, mono), and usage guidance.
- **Core components:** buttons (primary/ghost), tags/pills, cards, code/terminal
  block, navigation, section header pattern.
- **Iconography / motifs:** if any (e.g. the starfield, a "cosmic" motif for the
  three modes), define them as reusable assets.
- **Motion guidelines:** durations, easings, reveal patterns.
- **Open Graph / social image** template.
- **Favicon** set.

Delivered as a design file (Figma preferred) plus exported assets, and a short
usage guide.

## 11. Reference material

- **Working prototype (v0):** the current landing page lives in `/site`
  (`index.html`, `styles.css`, `main.js`) in this repository. It implements the
  Monolith direction and all §7 content, and is deployed via GitHub Pages. Treat
  it as a functional reference for intent and content — not as a design ceiling.
- **Design tokens:** `/site/styles.css` `:root` block (mirrored in §6).
- **Product context:** `README.md` (bilingual), `docs/architecture.md`,
  `docs/cli-reference.md` in this repository.
- **Repository:** https://github.com/GoDiao/codingverse

## 12. Deliverables checklist

- [ ] Concept / direction proposal for the landing page (Monolith reinterpreted)
- [ ] High-fidelity page design: desktop + mobile, EN + 中文 states
- [ ] Finalized brand visual system (§10) as a Figma file
- [ ] Exported production assets (logo/mark SVG, favicon set, OG image, any
      motifs)
- [ ] Motion spec
- [ ] Implemented static site (or design handoff + specs if we implement),
      meeting §9 constraints
- [ ] Short brand usage guide

## 13. Open questions for the design team

Please confirm or advise on:

1. Will you also implement the static site, or hand off design + specs for us to
   build?
2. Do you recommend keeping the current type pairing (Fraunces / Inter /
   JetBrains Mono) or propose alternatives?
3. Any recommendation on a hero visual / motion concept for "one index → three
   outputs"?
4. Timeline and milestones for the deliverables in §12.

---

*This brief is a starting point for collaboration. Where your expertise
suggests a stronger solution that still serves §2, we want your proposal.*
