import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { Root } from "protobufjs";
import { IndexDb } from "./db.js";
import { ScipImporter } from "./scip.js";
import { symbolId } from "./ids.js";

const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-scip-test-"));
const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // best-effort
    }
  }
  try {
    fs.rmdirSync(tmpDir);
  } catch {
    // best-effort
  }
});

let protoRoot: Root | null = null;
async function getProto(): Promise<Root> {
  if (protoRoot) return protoRoot;
  const protobuf = await import("protobufjs");
  protoRoot = await protobuf.load(
    require.resolve("@codingverse/shared/scip.proto"),
  );
  return protoRoot;
}

interface OccInput {
  symbol: string;
  symbolRoles?: number;
  line?: number;
}
interface RelInput {
  symbol: string;
  isReference?: boolean;
  isImplementation?: boolean;
  isTypeDefinition?: boolean;
  isDefinition?: boolean;
}
interface SymInput {
  symbol: string;
  relationships?: RelInput[];
}
interface DocInput {
  relativePath: string;
  occurrences?: OccInput[];
  symbols?: SymInput[];
}

async function buildScipFile(documents: DocInput[]): Promise<string> {
  const root = await getProto();
  const Index = root.lookupType("scip.Index");
  const msg = Index.create({
    documents: documents.map((d) => ({
      relativePath: d.relativePath,
      occurrences: (d.occurrences ?? []).map((o) => ({
        symbol: o.symbol,
        symbolRoles: o.symbolRoles ?? 0,
        singleLineRange: {
          line: o.line ?? 0,
          startCharacter: 0,
          endCharacter: 1,
        },
      })),
      symbols: (d.symbols ?? []).map((s) => ({
        symbol: s.symbol,
        relationships: (s.relationships ?? []).map((r) => ({
          symbol: r.symbol,
          isReference: r.isReference ?? false,
          isImplementation: r.isImplementation ?? false,
          isTypeDefinition: r.isTypeDefinition ?? false,
          isDefinition: r.isDefinition ?? false,
        })),
      })),
    })),
  });
  const bytes = Index.encode(msg).finish();
  const tmpPath = path.join(
    tmpDir,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.scip`,
  );
  fs.writeFileSync(tmpPath, Buffer.from(bytes));
  tmpFiles.push(tmpPath);
  return tmpPath;
}

interface NodeInput {
  filePath: string;
  qualifiedName: string;
  name?: string;
  kind?: string;
  language?: string;
  startLine?: number;
}

function insertNode(db: IndexDb, n: NodeInput): string {
  const id = symbolId(n.filePath, n.qualifiedName);
  db.db
    .prepare(
      `INSERT INTO nodes
        (id, kind, name, qualified_name, file_path, language,
         start_line, end_line, start_byte, end_byte,
         signature, docstring, pagerank, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`,
    )
    .run(
      id,
      n.kind ?? "function",
      n.name ?? n.qualifiedName.split("::").pop() ?? n.qualifiedName,
      n.qualifiedName,
      n.filePath,
      n.language ?? "typescript",
      n.startLine ?? 1,
      n.startLine ?? 1,
      0,
      0,
      Date.now(),
    );
  return id;
}

function insertHeuristicEdge(
  db: IndexDb,
  source: string,
  target: string,
  line = 1,
): void {
  db.db
    .prepare(
      `INSERT INTO edges (source, target, kind, line, col, provenance)
       VALUES (?, ?, 'calls', ?, NULL, 'heuristic')`,
    )
    .run(source, target, line);
}

interface EdgeRow {
  source: string;
  target: string;
  kind: string;
  line: number | null;
  col: number | null;
  provenance: string;
}

const allEdges = (db: IndexDb): EdgeRow[] =>
  db.db
    .prepare(
      "SELECT source, target, kind, line, col, provenance FROM edges ORDER BY id",
    )
    .all() as EdgeRow[];

const edgeCount = (db: IndexDb): number =>
  (db.db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number }).n;

const mkDb = (): IndexDb => {
  const db = new IndexDb({ dbPath: ":memory:" });
  db.migrate();
  return db;
};

const SCIP = (name: string): string =>
  `scip-typescript npm test 1.0.0 ${name}`;

beforeAll(async () => {
  await getProto();
});

describe("ScipImporter — basic edge import (name match, single file)", () => {
  it("creates a provenance=scip calls edge from foo to bar with the source def line", async () => {
    const db = mkDb();
    const fooId = insertNode(db, { filePath: "calls.ts", qualifiedName: "foo", startLine: 3 });
    const barId = insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [{ symbol: SCIP("foo()."), symbolRoles: 1, line: 3 }],
        symbols: [
          {
            symbol: SCIP("foo()."),
            relationships: [{ symbol: SCIP("bar()."), isReference: true }],
          },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });

    expect(stats.documents).toBe(1);
    expect(stats.occurrences).toBe(1);
    expect(stats.relationships).toBe(1);
    expect(stats.edgesInserted).toBe(1);
    expect(stats.edgesReplaced).toBe(0);

    expect(edgeCount(db)).toBe(1);
    const rows = allEdges(db);
    expect(rows[0]!.source).toBe(fooId);
    expect(rows[0]!.target).toBe(barId);
    expect(rows[0]!.kind).toBe("calls");
    expect(rows[0]!.provenance).toBe("scip");
    // SCIP def line is 0-based (3) → edge line is 1-based (4).
    expect(rows[0]!.line).toBe(4);
    db.close();
  });
});

describe("ScipImporter — qualified-name match (class::method)", () => {
  it("matches a SCIP method symbol to a node via qualified_name when names differ", async () => {
    const db = mkDb();
    const serviceId = insertNode(db, {
      filePath: "svc.ts",
      qualifiedName: "Service::greet",
      name: "greet",
      startLine: 5,
    });
    const helperId = insertNode(db, {
      filePath: "util.ts",
      qualifiedName: "format",
      name: "format",
    });

    const scipPath = await buildScipFile([
      {
        relativePath: "svc.ts",
        occurrences: [{ symbol: SCIP("Service# greet()."), symbolRoles: 1, line: 5 }],
        symbols: [
          {
            symbol: SCIP("Service# greet()."),
            relationships: [{ symbol: SCIP("format()."), isReference: true }],
          },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.edgesInserted).toBe(1);

    const rows = allEdges(db);
    expect(rows[0]!.source).toBe(serviceId);
    expect(rows[0]!.target).toBe(helperId);
    expect(rows[0]!.provenance).toBe("scip");
    db.close();
  });
});

describe("ScipImporter — heuristic edge replacement", () => {
  it("deletes heuristic edges sourced from the covered file and keeps other-file heuristic edges", async () => {
    const db = mkDb();
    const fooId = insertNode(db, { filePath: "calls.ts", qualifiedName: "foo" });
    const barId = insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });
    const quxId = insertNode(db, { filePath: "other.ts", qualifiedName: "qux" });

    insertHeuristicEdge(db, fooId, barId);
    insertHeuristicEdge(db, quxId, barId);
    expect(edgeCount(db)).toBe(2);

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [{ symbol: SCIP("foo()."), symbolRoles: 1, line: 1 }],
        symbols: [
          {
            symbol: SCIP("foo()."),
            relationships: [{ symbol: SCIP("bar()."), isReference: true }],
          },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });

    expect(stats.edgesReplaced).toBe(1);
    expect(stats.edgesInserted).toBe(1);

    const rows = allEdges(db);
    expect(rows).toHaveLength(2);
    const scipRow = rows.find((r) => r.provenance === "scip");
    const heurRow = rows.find((r) => r.provenance === "heuristic");
    expect(scipRow).toBeDefined();
    expect(scipRow!.source).toBe(fooId);
    expect(scipRow!.target).toBe(barId);
    expect(heurRow).toBeDefined();
    expect(heurRow!.source).toBe(quxId);
    expect(heurRow!.target).toBe(barId);
    db.close();
  });
});

describe("ScipImporter — dedup", () => {
  it("writes one edge for two identical relationships (same source/target/line)", async () => {
    const db = mkDb();
    const fooId = insertNode(db, { filePath: "calls.ts", qualifiedName: "foo" });
    const barId = insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [{ symbol: SCIP("foo()."), symbolRoles: 1, line: 1 }],
        symbols: [
          {
            symbol: SCIP("foo()."),
            relationships: [
              { symbol: SCIP("bar()."), isReference: true },
              { symbol: SCIP("bar()."), isReference: true },
            ],
          },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.relationships).toBe(2);
    expect(stats.edgesInserted).toBe(1);
    expect(edgeCount(db)).toBe(1);
    expect(allEdges(db)[0]!.source).toBe(fooId);
    expect(allEdges(db)[0]!.target).toBe(barId);
    db.close();
  });
});

describe("ScipImporter — unmatched target skipped", () => {
  it("creates no edge when the referenced symbol has no matching node", async () => {
    const db = mkDb();
    insertNode(db, { filePath: "calls.ts", qualifiedName: "foo" });

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [{ symbol: SCIP("foo()."), symbolRoles: 1, line: 1 }],
        symbols: [
          {
            symbol: SCIP("foo()."),
            relationships: [
              { symbol: SCIP("doesNotExist()."), isReference: true },
            ],
          },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.relationships).toBe(1);
    expect(stats.edgesInserted).toBe(0);
    expect(edgeCount(db)).toBe(0);
    db.close();
  });
});

describe("ScipImporter — source not in index skipped", () => {
  it("skips a SymbolInformation whose source symbol matches no node", async () => {
    const db = mkDb();
    insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        symbols: [
          {
            symbol: SCIP("ghost()."),
            relationships: [{ symbol: SCIP("bar()."), isReference: true }],
          },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.relationships).toBe(1);
    expect(stats.edgesInserted).toBe(0);
    expect(edgeCount(db)).toBe(0);
    db.close();
  });
});

describe("ScipImporter — non-reference relationship skipped", () => {
  it("ignores a relationship that is neither reference nor implementation", async () => {
    const db = mkDb();
    insertNode(db, { filePath: "calls.ts", qualifiedName: "foo" });
    insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [{ symbol: SCIP("foo()."), symbolRoles: 1, line: 1 }],
        symbols: [
          {
            symbol: SCIP("foo()."),
            relationships: [
              { symbol: SCIP("bar()."), isTypeDefinition: true },
            ],
          },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.relationships).toBe(1);
    expect(stats.edgesInserted).toBe(0);
    expect(edgeCount(db)).toBe(0);
    db.close();
  });
});

describe("ScipImporter — occurrence path (scip-typescript style)", () => {
  it("builds an edge from a reference occurrence's enclosing def to the referenced symbol", async () => {
    const db = mkDb();
    // SCIP lines are 0-based; our nodes.start_line is 1-based.
    // foo defined at SCIP line 1 → our start_line 2.
    const fooId = insertNode(db, {
      filePath: "calls.ts",
      qualifiedName: "foo",
      startLine: 2,
    });
    const barId = insertNode(db, { filePath: "util.ts", qualifiedName: "bar" });

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [
          { symbol: SCIP("foo()."), symbolRoles: 1, line: 1 },
          { symbol: SCIP("bar()."), symbolRoles: 0, line: 1 },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.occurrences).toBe(2);
    expect(stats.edgesInserted).toBe(1);

    const rows = allEdges(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe(fooId);
    expect(rows[0]!.target).toBe(barId);
    expect(rows[0]!.kind).toBe("calls");
    expect(rows[0]!.provenance).toBe("scip");
    // edge line = reference occurrence line (0-based 1) + 1 = 2.
    expect(rows[0]!.line).toBe(2);
    db.close();
  });

  it("recovers the enclosing def via range containment (multi-line)", async () => {
    const db = mkDb();
    const outerId = insertNode(db, {
      filePath: "nest.ts",
      qualifiedName: "outer",
      startLine: 1,
    });
    const innerId = insertNode(db, {
      filePath: "nest.ts",
      qualifiedName: "inner",
      startLine: 3,
    });
    const helperId = insertNode(db, {
      filePath: "util.ts",
      qualifiedName: "helper",
    });

    const scipPath = await buildScipFile([
      {
        relativePath: "nest.ts",
        occurrences: [
          // outer def spans 0-based lines 0..4 (our start_line 1).
          { symbol: SCIP("outer()."), symbolRoles: 1, line: 0 },
          // inner def at 0-based line 2 (our start_line 3), nested inside outer.
          { symbol: SCIP("inner()."), symbolRoles: 1, line: 2 },
          // reference to helper at 0-based line 2 → innermost enclosing = inner.
          { symbol: SCIP("helper()."), symbolRoles: 0, line: 2 },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.edgesInserted).toBe(1);
    const rows = allEdges(db);
    expect(rows[0]!.source).toBe(innerId);
    expect(rows[0]!.target).toBe(helperId);
    db.close();
  });

  it("skips a reference occurrence with no enclosing definition (top-level ref)", async () => {
    const db = mkDb();
    insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [
          // reference at 0-based line 0; no definition occurrence encloses it.
          { symbol: SCIP("bar()."), symbolRoles: 0, line: 0 },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.occurrences).toBe(1);
    expect(stats.edgesInserted).toBe(0);
    expect(edgeCount(db)).toBe(0);
    db.close();
  });

  it("parses the deprecated repeated-int32 range array (scip-typescript format)", async () => {
    const db = mkDb();
    const fooId = insertNode(db, {
      filePath: "calls.ts",
      qualifiedName: "foo",
      startLine: 5,
    });
    const barId = insertNode(db, { filePath: "util.ts", qualifiedName: "bar" });

    // Build a .scip that uses the deprecated `range` int32 array instead of the
    // typed oneofs, matching real scip-typescript output.
    const root = await getProto();
    const Index = root.lookupType("scip.Index");
    const msg = Index.create({
      documents: [
        {
          relativePath: "calls.ts",
          occurrences: [
            {
              symbol: SCIP("foo()."),
              symbolRoles: 1,
              range: [4, 0, 10],
            },
            {
              symbol: SCIP("bar()."),
              symbolRoles: 0,
              range: [4, 12, 16],
            },
          ],
        },
      ],
    });
    const bytes = Index.encode(msg).finish();
    const tmpPath = path.join(
      tmpDir,
      `test-range-${Date.now()}-${Math.random().toString(36).slice(2)}.scip`,
    );
    fs.writeFileSync(tmpPath, Buffer.from(bytes));
    tmpFiles.push(tmpPath);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath: tmpPath, repoRoot: "/tmp" });
    expect(stats.edgesInserted).toBe(1);
    const rows = allEdges(db);
    expect(rows[0]!.source).toBe(fooId);
    expect(rows[0]!.target).toBe(barId);
    // def at 0-based line 4 → source start_line 5; ref at 0-based line 4 → edge line 5.
    expect(rows[0]!.line).toBe(5);
    db.close();
  });
});

describe("ScipImporter — keeps heuristic edges when SCIP yields none for a file", () => {
  it("does not delete heuristic edges for a covered file that produced 0 scip edges", async () => {
    const db = mkDb();
    const fooId = insertNode(db, { filePath: "calls.ts", qualifiedName: "foo" });
    const barId = insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });
    insertHeuristicEdge(db, fooId, barId);

    // .scip references only an external symbol → 0 resolvable targets → 0 edges.
    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [
          { symbol: SCIP("foo()."), symbolRoles: 1, line: 1 },
          { symbol: SCIP("externalLib()."), symbolRoles: 0, line: 1 },
        ],
      },
    ]);

    const importer = new ScipImporter(db);
    const stats = await importer.import({ scipPath, repoRoot: "/tmp" });
    expect(stats.edgesInserted).toBe(0);
    expect(stats.edgesReplaced).toBe(0);
    // Heuristic edge survives because SCIP contributed no edges for this file.
    expect(edgeCount(db)).toBe(1);
    expect(allEdges(db)[0]!.provenance).toBe("heuristic");
    db.close();
  });
});

describe("ScipImporter — empty index guard", () => {
  it("throws when the nodes table is empty (cv index not run)", async () => {
    const db = mkDb();
    const scipPath = await buildScipFile([
      { relativePath: "calls.ts", symbols: [] },
    ]);
    const importer = new ScipImporter(db);
    await expect(
      importer.import({ scipPath, repoRoot: "/tmp" }),
    ).rejects.toThrow(/cv index/);
    db.close();
  });
});

describe("ScipImporter — missing .scip file", () => {
  it("throws when the scip path does not exist", async () => {
    const db = mkDb();
    insertNode(db, { filePath: "calls.ts", qualifiedName: "foo" });
    const importer = new ScipImporter(db);
    const bogus = path.join(tmpDir, "does-not-exist.scip");
    await expect(
      importer.import({ scipPath: bogus, repoRoot: "/tmp" }),
    ).rejects.toThrow(/SCIP file not found/);
    db.close();
  });
});

describe("ScipImporter — transaction safety", () => {
  it("rolls back when an edge INSERT fails mid-import, leaving prior state intact", async () => {
    const db = mkDb();
    const fooId = insertNode(db, { filePath: "calls.ts", qualifiedName: "foo" });
    const barId = insertNode(db, { filePath: "calls.ts", qualifiedName: "bar" });

    // A pre-existing scip edge that should survive a failed second import.
    insertHeuristicEdge(db, fooId, barId);

    const scipPath = await buildScipFile([
      {
        relativePath: "calls.ts",
        occurrences: [{ symbol: SCIP("foo()."), symbolRoles: 1, line: 1 }],
        symbols: [
          {
            symbol: SCIP("foo()."),
            relationships: [{ symbol: SCIP("bar()."), isReference: true }],
          },
        ],
      },
    ]);

    // Force the scip INSERT (provenance='scip') to abort via a trigger.
    db.db.exec(
      "CREATE TRIGGER fail_scip BEFORE INSERT ON edges WHEN new.provenance = 'scip' BEGIN SELECT RAISE(ABORT, 'synthetic scip failure'); END",
    );

    const importer = new ScipImporter(db);
    await expect(importer.import({ scipPath, repoRoot: "/tmp" })).rejects.toThrow();

    // ROLLBACK must discard the in-progress delete + any pending scip insert,
    // restoring the pre-import heuristic edge as the only edge.
    expect(edgeCount(db)).toBe(1);
    const rows = allEdges(db);
    expect(rows[0]!.provenance).toBe("heuristic");
    db.close();
  });
});
