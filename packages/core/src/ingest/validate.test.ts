import { describe, it, expect } from "vitest";
import { isValidFile, computeMetrics } from "./validate.js";

describe("computeMetrics", () => {
  it("computes line and character-class metrics", () => {
    const m = computeMetrics("abc\nde12\n");
    expect(m.numLines).toBe(3); // "abc", "de12", ""
    expect(m.maxLineLength).toBe(4);
    expect(m.numberFraction).toBeGreaterThan(0);
    expect(m.alphaNumFraction).toBeGreaterThan(0);
  });
});

describe("isValidFile", () => {
  it("accepts normal source code", () => {
    const src = `function add(a, b) {\n  return a + b;\n}\n`;
    expect(isValidFile(src)).toBe(true);
  });

  it("accepts empty file", () => {
    expect(isValidFile("")).toBe(true);
  });

  it("rejects minified (huge single line)", () => {
    const minified = "a".repeat(5000);
    expect(isValidFile(minified)).toBe(false);
  });

  it("rejects a number-heavy data blob", () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push("1234567890,9876543210,1111111111");
    expect(isValidFile(lines.join("\n"))).toBe(false);
  });

  it("rejects low-alphanumeric content (mostly symbols)", () => {
    const symbols = "!@#$%^&*(){}[]".repeat(200);
    expect(isValidFile(symbols)).toBe(false);
  });

  it("rejects a long code line as .ts", () => {
    const longLine = `const x = ${"a".repeat(500)};`;
    expect(isValidFile(longLine, "foo.ts")).toBe(false);
  });

  it("accepts markdown with long table rows (prose exemption)", () => {
    const longRow = `| ${"col ".repeat(200)}|`;
    const md = `# Title\n\n${longRow}\n\nSome prose here.\n`;
    expect(isValidFile(md, "doc.md")).toBe(true);
  });
});
