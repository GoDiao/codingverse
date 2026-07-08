import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readRawFile } from "./reader.js";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-reader-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("readRawFile", () => {
  it("reads UTF-8 text via fast path", async () => {
    const p = path.join(dir, "hello.ts");
    await fs.writeFile(p, "const x = 1;\n", "utf8");
    const res = await readRawFile(p, 1024 * 1024);
    expect(res.content).toBe("const x = 1;\n");
    expect(res.skippedReason).toBeUndefined();
  });

  it("strips UTF-8 BOM", async () => {
    const p = path.join(dir, "bom.ts");
    await fs.writeFile(p, "\uFEFFconst x = 1;", "utf8");
    const res = await readRawFile(p, 1024 * 1024);
    expect(res.content).toBe("const x = 1;");
  });

  it("skips by binary extension without reading", async () => {
    const p = path.join(dir, "logo.png");
    await fs.writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await readRawFile(p, 1024 * 1024);
    expect(res.content).toBeNull();
    expect(res.skippedReason).toBe("binary-extension");
  });

  it("skips binary content via NULL-byte probe", async () => {
    const p = path.join(dir, "data.bin_txt"); // non-binary ext, but has NULL
    await fs.writeFile(p, Buffer.from([0x41, 0x00, 0x42]));
    const res = await readRawFile(p, 1024 * 1024);
    expect(res.content).toBeNull();
    expect(res.skippedReason).toBe("binary-content");
  });

  it("skips oversized files", async () => {
    const p = path.join(dir, "big.txt");
    await fs.writeFile(p, "x".repeat(100));
    const res = await readRawFile(p, 10);
    expect(res.content).toBeNull();
    expect(res.skippedReason).toBe("size-limit");
  });
});
