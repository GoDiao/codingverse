import { describe, it, expect, afterAll } from "vitest";
import { parseFile, disposeParsers } from "./index.js";
import type { FileEntry } from "@codingverse/shared";

const mkFile = (path: string, content: string): FileEntry => ({
  path,
  absPath: `/tmp/${path}`,
  content,
  size: content.length,
});

afterAll(() => disposeParsers());

describe("parseFile — TypeScript", () => {
  it("extracts classes, functions, methods", async () => {
    const src = `
export class Greeter {
  greet(name: string): string {
    return format(name);
  }
}

export function format(name: string): string {
  return "hi " + name;
}
`;
    const parsed = await parseFile(mkFile("greet.ts", src));
    expect(parsed.language).toBe("typescript");
    expect(parsed.degraded).toBe(false);

    const names = parsed.symbols.map((s) => s.name);
    expect(names).toContain("Greeter");
    expect(names).toContain("greet");
    expect(names).toContain("format");

    const greet = parsed.symbols.find((s) => s.name === "greet");
    expect(greet?.kind).toBe("method");
    expect(greet?.scope).toContain("Greeter");

    const format = parsed.symbols.find((s) => s.name === "format");
    expect(format?.kind).toBe("function");
  });

  it("extracts call references", async () => {
    const src = `function a() { return b(); }\nfunction b() { return 1; }\n`;
    const parsed = await parseFile(mkFile("calls.ts", src));
    const callNames = parsed.refs.filter((r) => r.kind === "calls").map((r) => r.name);
    expect(callNames).toContain("b");
  });

  it("produces chunks", async () => {
    const src = `export function one() {}\nexport function two() {}\n`;
    const parsed = await parseFile(mkFile("chunks.ts", src));
    expect(parsed.chunks.length).toBeGreaterThanOrEqual(2);
    expect(parsed.chunks.every((c) => c.body.length > 0)).toBe(true);
  });
});

describe("parseFile — Python", () => {
  it("extracts classes and methods with scope", async () => {
    const src = `
class Animal:
    def speak(self):
        return sound()

def sound():
    return "woof"
`;
    const parsed = await parseFile(mkFile("animal.py", src));
    expect(parsed.language).toBe("python");
    expect(parsed.degraded).toBe(false);

    const names = parsed.symbols.map((s) => s.name);
    expect(names).toContain("Animal");
    expect(names).toContain("speak");
    expect(names).toContain("sound");

    const speak = parsed.symbols.find((s) => s.name === "speak");
    expect(speak?.kind).toBe("method");
    expect(speak?.scope).toContain("Animal");

    const sound = parsed.symbols.find((s) => s.name === "sound");
    expect(sound?.kind).toBe("function");
  });

  it("extracts call references", async () => {
    const src = `def a():\n    return b()\ndef b():\n    return 1\n`;
    const parsed = await parseFile(mkFile("calls.py", src));
    const callNames = parsed.refs.filter((r) => r.kind === "calls").map((r) => r.name);
    expect(callNames).toContain("b");
  });
});

describe("parseFile — JavaScript", () => {
  // Regression: JS/JSX must use JS_TAGS, not TS_TAGS. Compiling TS_TAGS
  // (which references `type_identifier`) against the JS grammar throws
  // `Bad node name 'type_identifier'` and breaks `cv index` on any repo
  // containing a .js file. This exercises the JS query path end-to-end.
  it("extracts classes, functions, methods without a query-compile throw", async () => {
    const src = `
class Greeter {
  greet(name) {
    return format(name);
  }
}

function format(name) {
  return "hi " + name;
}

const shout = (s) => format(s).toUpperCase();
`;
    const parsed = await parseFile(mkFile("greet.js", src));
    expect(parsed.language).toBe("javascript");
    expect(parsed.degraded).toBe(false);

    const names = parsed.symbols.map((s) => s.name);
    expect(names).toContain("Greeter");
    expect(names).toContain("greet");
    expect(names).toContain("format");
    expect(names).toContain("shout");

    const callNames = parsed.refs.filter((r) => r.kind === "calls").map((r) => r.name);
    expect(callNames).toContain("format");
  });
});

describe("parseFile — degraded", () => {
  it("degrades unsupported languages to whole-file chunk", async () => {
    const parsed = await parseFile(mkFile("data.xyz", "some content\nhere\n"));
    expect(parsed.language).toBe("unknown");
    expect(parsed.degraded).toBe(true);
    expect(parsed.symbols).toHaveLength(0);
    expect(parsed.chunks).toHaveLength(1);
  });
});
