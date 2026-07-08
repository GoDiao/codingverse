import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingest } from "./index.js";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-ingest-"));
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "node_modules", "dep"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(dir, "src", "b.ts"), "export const b = 2;\n");
  await fs.writeFile(path.join(dir, "README.md"), "# Hello\n");
  await fs.writeFile(path.join(dir, ".gitignore"), "ignored.txt\n");
  await fs.writeFile(path.join(dir, "ignored.txt"), "should be ignored\n");
  await fs.writeFile(path.join(dir, "node_modules", "dep", "index.js"), "module.exports = {};\n");
  await fs.writeFile(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("ingest", () => {
  it("discovers source files, respects .gitignore and default ignore", async () => {
    const { files } = await ingest(dir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain("src/b.ts");
    expect(paths).toContain("README.md");
    // .gitignore respected
    expect(paths).not.toContain("ignored.txt");
    // default ignore excludes node_modules
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
  });

  it("skips binary files with a reason", async () => {
    const { skipped } = await ingest(dir);
    const png = skipped.find((s) => s.path === "logo.png");
    expect(png).toBeDefined();
    expect(png?.reason).toBe("binary-extension");
  });

  it("returns decoded content for text files", async () => {
    const { files } = await ingest(dir);
    const a = files.find((f) => f.path === "src/a.ts");
    expect(a?.content).toBe("export const a = 1;\n");
    expect(a?.size).toBeGreaterThan(0);
  });

  it("honors include patterns", async () => {
    const { files } = await ingest(dir, { include: ["**/*.ts"] });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("honors exclude patterns", async () => {
    const { files } = await ingest(dir, { exclude: ["**/*.md"] });
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain("README.md");
  });
});
