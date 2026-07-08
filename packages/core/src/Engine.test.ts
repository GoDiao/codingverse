import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "./Engine.js";
import { disposeParsers } from "./parse/index.js";
import { STATE_DIR } from "@codingverse/shared";
import type { IndexStats, SearchHit, PackResult } from "@codingverse/shared";

afterAll(() => disposeParsers());

const SAMPLE_A = `export function widgetMaker() {
  // widget helper marker
  return 1;
}
export function useWidget() {
  return widgetMaker();
}
`;

const SAMPLE_B = `export function sorcery() {
  return 42;
}
`;

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-engine-"));
  await fsp.writeFile(path.join(dir, "a.ts"), SAMPLE_A);
  await fsp.writeFile(path.join(dir, "b.ts"), SAMPLE_B);
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const indexPath = (repo: string): string => path.join(repo, STATE_DIR, "index.db");

describe("Engine.index — real SQLite write", () => {
  it("returns IndexStats with non-zero symbols/chunks and writes index.db", async () => {
    const engine = await Engine.open(dir);
    const stats = await engine.index();

    expect(stats.filesProcessed).toBeGreaterThan(0);
    expect(stats.symbols).toBeGreaterThan(0);
    expect(stats.chunks).toBeGreaterThan(0);
    expect(stats.edges).toBeGreaterThanOrEqual(0);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);

    expect(fs.existsSync(indexPath(dir))).toBe(true);
    await engine.close();
  });

  it("resolves at least one edge from useWidget → widgetMaker", async () => {
    const engine = await Engine.open(dir);
    const stats: IndexStats = await engine.index();
    expect(stats.edges).toBeGreaterThanOrEqual(1);
    await engine.close();
  });

  it("is idempotent: a second index() keeps counts stable", async () => {
    const engine = await Engine.open(dir);
    const first = await engine.index();
    const second = await engine.index();
    expect(second.symbols).toBe(first.symbols);
    expect(second.chunks).toBe(first.chunks);
    expect(second.edges).toBe(first.edges);
    await engine.close();
  });
});

describe("Engine.search — hits after index", () => {
  it("returns SearchHit[] with the correct shape for a term that exists", async () => {
    const engine = await Engine.open(dir);
    await engine.index();

    const hits = await engine.search("widget");
    expect(hits.length).toBeGreaterThan(0);

    const hit: SearchHit = hits[0]!;
    expect(typeof hit.chunkId).toBe("string");
    expect(hit.chunkId.length).toBeGreaterThan(0);
    expect(hit.filePath).toBe("a.ts");
    expect(typeof hit.startLine).toBe("number");
    expect(typeof hit.endLine).toBe("number");
    expect(typeof hit.body).toBe("string");
    expect(hit.scores.vector).toBe(0);
    expect(typeof hit.scores.bm25).toBe("number");
    expect(Number.isFinite(hit.scores.bm25)).toBe(true);
    expect(typeof hit.scores.graph).toBe("number");
    expect(Number.isFinite(hit.scores.graph)).toBe(true);
    expect(typeof hit.scores.rrf).toBe("number");
    expect(Number.isFinite(hit.scores.rrf)).toBe(true);
    expect(Array.isArray(hit.relatedNodes)).toBe(true);
    await engine.close();
  });

  it("respects topK", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    const hits = await engine.search("widget", { topK: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
    await engine.close();
  });
});

describe("Engine.search — empty / no-match", () => {
  it("returns [] for a term that does not exist", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    expect(await engine.search("nonexistentterm")).toEqual([]);
    await engine.close();
  });

  it("returns [] (not throw) on a fresh engine with an empty index", async () => {
    const engine = await Engine.open(dir);
    expect(await engine.search("widget")).toEqual([]);
    expect(await engine.search("anything")).toEqual([]);
    await engine.close();
  });
});

describe("Engine.close — lifecycle", () => {
  it("is idempotent", async () => {
    const engine = await Engine.open(dir);
    await engine.close();
    await expect(engine.close()).resolves.toBeUndefined();
  });

  it("makes subsequent search() throw (connection closed)", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.close();
    await expect(engine.search("widget")).rejects.toThrow();
  });

  it("makes subsequent index() throw (connection closed)", async () => {
    const engine = await Engine.open(dir);
    await engine.index();
    await engine.close();
    await expect(engine.index()).rejects.toThrow();
  });
});

describe("Engine.pack — regression guard (unaffected by index wiring)", () => {
  it("still produces a PackResult with content after the index changes", async () => {
    const engine = await Engine.open(dir);
    const result: PackResult = await engine.pack();
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.fileCount).toBeGreaterThan(0);
    await engine.close();
  });

  it("coexists with index(): index then pack on the same engine", async () => {
    const engine = await Engine.open(dir);
    const stats = await engine.index();
    expect(stats.symbols).toBeGreaterThan(0);

    const result = await engine.pack();
    expect(result.content.length).toBeGreaterThan(0);
    await engine.close();
  });

  it("close() after pack() does not throw", async () => {
    const engine = await Engine.open(dir);
    await engine.pack();
    await expect(engine.close()).resolves.toBeUndefined();
  });
});
