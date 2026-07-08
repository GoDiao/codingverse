import { describe, it, expect } from "vitest";
import { render, renderTree } from "./index.js";
import type { PackedFile, RenderInput } from "./index.js";

const files: PackedFile[] = [
  {
    path: "src/a.ts",
    language: "typescript",
    layer: "full",
    content: "export const a = 1;",
    tokens: 10,
  },
  {
    path: "src/b.ts",
    language: "typescript",
    layer: "skeleton",
    content: "function b() { // … cv:abc }",
    tokens: 8,
  },
  {
    path: "README.md",
    language: "unknown",
    layer: "omit",
    content: "",
    tokens: 0,
  },
];

const input: RenderInput = { files, tokenCount: 18, expandableCount: 1 };

describe("renderTree", () => {
  it("builds a directory tree with layer markers", () => {
    const tree = renderTree(files.map((f) => ({ path: f.path, layer: f.layer })));
    expect(tree).toContain("src/");
    expect(tree).toContain("a.ts  [full]");
    expect(tree).toContain("b.ts  [skeleton]");
    expect(tree).toContain("README.md  [omit]");
  });

  it("sorts directories before files", () => {
    const tree = renderTree([
      { path: "z.ts", layer: "full" },
      { path: "src/x.ts", layer: "full" },
    ]);
    const lines = tree.split("\n");
    expect(lines[0]).toBe("src/");
    expect(lines[lines.length - 1]).toContain("z.ts");
  });
});

describe("render — XML", () => {
  it("emits valid structure with omit excluded from files", () => {
    const out = render(input, "xml");
    expect(out).toContain(`<codingverse token_count="18" expandable="1">`);
    expect(out).toContain("<directory_structure>");
    expect(out).toContain(`<file path="src/a.ts" layer="full" tokens="10">`);
    // omit file appears in tree but not as a <file>
    expect(out).toContain("README.md");
    expect(out).not.toContain(`path="README.md"`);
  });

  it("escapes XML special chars in content", () => {
    const out = render(
      { files: [{ path: "x.ts", language: "typescript", layer: "full", content: "a < b && c > d", tokens: 5 }], tokenCount: 5, expandableCount: 0 },
      "xml",
    );
    expect(out).toContain("a &lt; b &amp;&amp; c &gt; d");
  });
});

describe("render — Markdown", () => {
  it("emits headings, tree, and fenced files", () => {
    const out = render(input, "markdown");
    expect(out).toContain("# Repository Snapshot");
    expect(out).toContain("## Directory Structure");
    expect(out).toContain("### src/a.ts  `[full]`");
    expect(out).toContain("```typescript");
  });

  it("widens fence when content contains backticks", () => {
    const out = render(
      { files: [{ path: "x.md", language: "unknown", layer: "full", content: "here is ``` a fence", tokens: 5 }], tokenCount: 5, expandableCount: 0 },
      "markdown",
    );
    expect(out).toContain("````"); // widened to 4 backticks
  });
});

describe("render — JSON", () => {
  it("emits parseable JSON with files array", () => {
    const out = render(input, "json");
    const parsed = JSON.parse(out);
    expect(parsed.generator).toBe("codingverse");
    expect(parsed.tokenCount).toBe(18);
    expect(parsed.files).toHaveLength(2); // omit excluded
    expect(parsed.files[0].path).toBe("src/a.ts");
    expect(parsed.directoryStructure).toContain("src/");
  });
});
