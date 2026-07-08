import { describe, it, expect, afterAll } from "vitest";
import { compress, symbolId } from "./index.js";
import { parseFiles, disposeParsers } from "../../parse/index.js";
import type { FileEntry } from "@codingverse/shared";

const TS = `export function format(name) {
  const p = "hi ";
  return p + name;
}

export class Greeter {
  greet(name) {
    return format(name);
  }
}
`;

const PY = `def foo(x):
    return bar(x)

class Animal:
    def speak(self):
        return 2
`;

const mk = (path: string, content: string): FileEntry => ({
  path,
  absPath: `/tmp/${path}`,
  content,
  size: content.length,
});

const REPO = "/tmp/_cv-compress-test";

afterAll(() => disposeParsers());

describe("compress — layer selection", () => {
  it("keeps everything full under a generous budget", async () => {
    const parsed = await parseFiles([mk("greet.ts", TS)]);
    const sources = new Map([["greet.ts", TS]]);
    const r = await compress(parsed, sources, { tokenBudget: 100000 }, REPO);
    expect(r.layerMap["greet.ts"]).toBe("full");
    expect(r.fits).toBe(true);
  });

  it("downgrades to omit under an impossibly tiny budget", async () => {
    const parsed = await parseFiles([mk("greet.ts", TS)]);
    const sources = new Map([["greet.ts", TS]]);
    const r = await compress(parsed, sources, { tokenBudget: 3 }, REPO);
    expect(r.layerMap["greet.ts"]).toBe("omit");
    expect(r.total).toBe(0);
  });

  it("respects forced skeleton strategy", async () => {
    const parsed = await parseFiles([mk("greet.ts", TS)]);
    const sources = new Map([["greet.ts", TS]]);
    const r = await compress(parsed, sources, { layerStrategy: "skeleton" }, REPO);
    expect(r.layerMap["greet.ts"]).toBe("skeleton");
    expect(Object.keys(r.expandMap).length).toBeGreaterThan(0);
  });

  it("pins alwaysFull files even under tiny budget", async () => {
    const parsed = await parseFiles([mk("greet.ts", TS)]);
    const sources = new Map([["greet.ts", TS]]);
    const r = await compress(
      parsed,
      sources,
      { tokenBudget: 3, alwaysFull: ["greet.ts"] },
      REPO,
    );
    expect(r.layerMap["greet.ts"]).toBe("full");
  });
});

describe("compress — skeleton (TS)", () => {
  it("preserves signatures, replaces bodies with cv: placeholders", async () => {
    const parsed = await parseFiles([mk("greet.ts", TS)]);
    const sources = new Map([["greet.ts", TS]]);
    const r = await compress(parsed, sources, { layerStrategy: "skeleton" }, REPO);
    const content = r.files[0]!.content;

    expect(content).toContain("function format(name)");
    expect(content).toContain("class Greeter");
    expect(content).toContain("greet(name)");
    expect(content).toMatch(/cv:[0-9a-f]{16}/);
    // body content must be gone
    expect(content).not.toContain('const p = "hi "');
  });

  it("expandMap ids match symbolId(path, qualifiedName)", async () => {
    const parsed = await parseFiles([mk("greet.ts", TS)]);
    const sources = new Map([["greet.ts", TS]]);
    const r = await compress(parsed, sources, { layerStrategy: "skeleton" }, REPO);

    const formatId = symbolId("greet.ts", "format");
    expect(r.expandMap[formatId]).toBeDefined();
    expect(r.expandMap[formatId]!.name).toBe("format");

    const greetId = symbolId("greet.ts", "Greeter::greet");
    expect(r.expandMap[greetId]).toBeDefined();
  });
});

describe("compress — outline (Python)", () => {
  it("lists symbols indented by scope, no bodies", async () => {
    const parsed = await parseFiles([mk("animal.py", PY)]);
    const sources = new Map([["animal.py", PY]]);
    const r = await compress(parsed, sources, { layerStrategy: "outline" }, REPO);
    const content = r.files[0]!.content;

    expect(content).toContain("def foo(x)");
    expect(content).toContain("class Animal");
    expect(content).toMatch(/\n {2}def speak\(self\)/); // method indented
    expect(content).not.toContain("return"); // bodies gone
  });
});

describe("compress — expand span", () => {
  it("expand entry span covers the full symbol source", async () => {
    const parsed = await parseFiles([mk("greet.ts", TS)]);
    const sources = new Map([["greet.ts", TS]]);
    const r = await compress(parsed, sources, { layerStrategy: "skeleton" }, REPO);
    const formatId = symbolId("greet.ts", "format");
    const entry = r.expandMap[formatId]!;
    const src = TS.slice(entry.startByte, entry.endByte);
    expect(src).toContain("function format");
    expect(src).toContain('const p = "hi "'); // full body recoverable
  });
});
