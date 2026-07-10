import { describe, it, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IndexDb } from "./db.js";
import { ScipImporter } from "./scip.js";
import { symbolId } from "./ids.js";

// Hoisted above all imports: mock protobufjs so `await import("protobufjs")`
// inside scip.ts's loadProtobufjs() rejects. This MUST be a separate test file
// so the mock doesn't interfere with scip.test.ts, which needs the real
// protobufjs to build .scip fixtures. The factory throws, which makes the
// dynamic import reject; loadProtobufjs's catch-all then re-throws the
// install-hint error containing "protobufjs".
vi.mock("protobufjs", () => {
  throw new Error("Cannot find package 'protobufjs'");
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-scip-missing-"));
afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("ScipImporter — missing protobufjs dependency", () => {
  it("throws a clear install hint when protobufjs cannot be imported", async () => {
    const db = new IndexDb({ dbPath: ":memory:" });
    db.migrate();
    // Insert a node so the nodeCount > 0 guard in ScipImporter.import passes.
    const nodeId = symbolId("calls.ts", "foo");
    db.db
      .prepare(
        `INSERT INTO nodes
          (id, kind, name, qualified_name, file_path, language,
           start_line, end_line, start_byte, end_byte,
           signature, docstring, pagerank, updated_at)
         VALUES (?, 'function', 'foo', 'foo', 'calls.ts', 'typescript',
                 1, 1, 0, 0, NULL, NULL, 0, ?)`,
      )
      .run(nodeId, Date.now());

    // A dummy .scip file — just needs to exist on disk so the existsSync
    // guard passes. loadProtobufjs() runs BEFORE the file is decoded, so the
    // mock throws before the file content matters.
    const scipPath = path.join(tmpDir, "dummy.scip");
    fs.writeFileSync(scipPath, Buffer.alloc(0));

    const importer = new ScipImporter(db);
    await expect(importer.import({ scipPath })).rejects.toThrow(/protobufjs/);
    db.close();
  });
});
