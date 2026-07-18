import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Engine } from "./Engine.js";
import { disposeParsers } from "./parse/index.js";

afterAll(() => disposeParsers());

// helper.ts defines a helper; consumer.ts calls it. Changing helper.ts should,
// via reverse impact, pull consumer.ts into the scoped pack.
const HELPER = `export function computeBudget(n: number): number {
  return n * 2;
}
`;
const CONSUMER = `import { computeBudget } from "./helper";
export function planBudget(): number {
  return computeBudget(21);
}
`;
const UNRELATED = `export function sorcery(): number {
  return 42;
}
`;

let dir: string;
let hasGit = true;

function git(repo: string, args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-scoped-"));
  await fsp.writeFile(path.join(dir, "helper.ts"), HELPER);
  await fsp.writeFile(path.join(dir, "consumer.ts"), CONSUMER);
  await fsp.writeFile(path.join(dir, "unrelated.ts"), UNRELATED);
  // Real repos gitignore the index/cache dir; do the same so index.db files
  // don't show up as "changed" and pollute seedFiles.
  await fsp.writeFile(path.join(dir, ".gitignore"), ".codingverse/\n");
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "test"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "initial"]);
  } catch {
    hasGit = false; // git not available — tests self-skip below
  }
});

afterEach(async () => {
  // Windows can briefly hold a lock on the just-closed SQLite file; cleanup is
  // best-effort so a stray EBUSY doesn't fail an otherwise-passing test.
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    /* temp dir cleanup best-effort */
  }
});

describe("Engine.packScoped — diff-scoped pack (V3-1)", () => {
  it("clean tree → no seed files, empty pack", async () => {
    if (!hasGit) return;
    const engine = await Engine.open(dir);
    await engine.index();
    const res = await engine.packScoped({ tokenBudget: 4000 });
    expect(res.scope).toBe("changed");
    expect(res.seedFiles).toEqual([]);
    expect(res.fileCount).toBe(0);
    await engine.close();
  });

  it("changed file is a seed; its caller is pulled in via impact", async () => {
    if (!hasGit) return;
    const engine = await Engine.open(dir);
    await engine.index();
    // Modify helper.ts (bodies changed → git sees it as changed).
    await fsp.writeFile(
      path.join(dir, "helper.ts"),
      HELPER.replace("n * 2", "n * 3"),
    );
    const res = await engine.packScoped({ tokenBudget: 8000, depth: 2 });

    expect(res.scope).toBe("changed");
    expect(res.seedFiles).toContain("helper.ts");
    // consumer.ts calls computeBudget → reverse impact should reach it.
    expect(res.expandedFiles).toContain("consumer.ts");
    // unrelated.ts touches nothing → must not appear in the packed set.
    const packedPaths = res.files.map((f) => f.path);
    expect(packedPaths).toContain("helper.ts");
    expect(packedPaths).not.toContain("unrelated.ts");
    await engine.close();
  });

  it("depth 0 packs the changed file alone (no impact expansion)", async () => {
    if (!hasGit) return;
    const engine = await Engine.open(dir);
    await engine.index();
    await fsp.writeFile(
      path.join(dir, "helper.ts"),
      HELPER.replace("n * 2", "n * 4"),
    );
    const res = await engine.packScoped({ tokenBudget: 8000, depth: 0 });
    expect(res.seedFiles).toContain("helper.ts");
    expect(res.expandedFiles).toEqual([]);
    await engine.close();
  });

  it("--since <ref> compares against a git ref", async () => {
    if (!hasGit) return;
    const engine = await Engine.open(dir);
    await engine.index();
    // New commit that changes consumer.ts.
    await fsp.writeFile(path.join(dir, "consumer.ts"), CONSUMER + "\n// touched\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "touch consumer"]);
    // since HEAD~1 → consumer.ts changed in the last commit.
    const res = await engine.packScoped({ tokenBudget: 8000, since: "HEAD~1" });
    expect(res.scope).toBe("since");
    expect(res.scopeArg).toBe("HEAD~1");
    expect(res.seedFiles).toContain("consumer.ts");
    await engine.close();
  });

  it("non-git directory throws a clear error", async () => {
    const plain = await fsp.mkdtemp(path.join(os.tmpdir(), "cv-nogit-"));
    await fsp.writeFile(path.join(plain, "x.ts"), UNRELATED);
    const engine = await Engine.open(plain);
    await expect(engine.packScoped({ tokenBudget: 4000 })).rejects.toThrow(
      /git/i,
    );
    await engine.close();
    await fsp.rm(plain, { recursive: true, force: true });
  });
});
