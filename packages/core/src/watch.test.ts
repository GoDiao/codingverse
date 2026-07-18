import { describe, it, expect, afterEach, afterAll } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "./Engine.js";
import { watchRepo } from "./watch.js";
import { disposeParsers } from "./parse/index.js";

afterAll(() => disposeParsers());

let dir: string;

afterEach(async () => {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// Wait until `predicate()` is truthy or timeout — polling avoids racing the
// debounce + async re-index cycle. Predicate may be sync or async.
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return await predicate();
}

describe("watchRepo — continuous indexing (V3-4)", () => {
  it("re-indexes after a file change and picks up the new symbol", async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-watch-"));
    await fsp.writeFile(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");

    const engine = await Engine.open(dir);
    await engine.index();
    await engine.rank();

    let reindexCount = 0;
    const handle = watchRepo(engine, {
      debounceMs: 100,
      rank: false,
      onReindex: () => {
        reindexCount++;
      },
    });

    // Add a new file with a distinctive symbol.
    await fsp.writeFile(
      path.join(dir, "b.ts"),
      "export function betaZephyr() { return 2; }\n",
    );

    const gotReindex = await waitFor(() => reindexCount >= 1);
    expect(gotReindex).toBe(true);

    // The new symbol is now searchable.
    const found = await waitFor(async () => {
      const hits = await engine.search("betaZephyr");
      return hits.some((h) => h.body.includes("betaZephyr"));
    });
    expect(found).toBe(true);

    handle.close();
    await engine.close();
  });

  it("close() stops further re-indexing", async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-watch-stop-"));
    await fsp.writeFile(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");

    const engine = await Engine.open(dir);
    await engine.index();

    let reindexCount = 0;
    const handle = watchRepo(engine, {
      debounceMs: 80,
      rank: false,
      onReindex: () => {
        reindexCount++;
      },
    });
    handle.close();

    await fsp.writeFile(path.join(dir, "c.ts"), "export function gamma() { return 3; }\n");
    // Give it time to (not) fire.
    await new Promise((r) => setTimeout(r, 400));
    expect(reindexCount).toBe(0);

    await engine.close();
  });
});
