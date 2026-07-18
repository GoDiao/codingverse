/**
 * codingverse Dashboard server — observation mode (three-mode output #3).
 *
 * A zero-dependency `node:http` server that holds ONE shared Engine instance
 * and serves both the static SPA (web/) and JSON API endpoints backed by that
 * Engine. All handlers share the same SQLite connection, so `cv serve` = one
 * Engine serving every request (design decision v2.5 §二).
 *
 * Security: binds to 127.0.0.1 by default (localhost-only). This is an
 * unauthenticated local debugging tool — do NOT expose it on 0.0.0.0 / a
 * public interface without adding access control.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { Engine } from "@codingverse/core";
import { STATE_DIR } from "@codingverse/shared";

/** Directory holding the static SPA assets (package `web/`). */
const WEB_DIR = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "..",
  "web",
);

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface ServeOptions {
  /** Repository to observe. Defaults to cwd. */
  repoPath?: string;
  /** Listen port. Defaults to 7331. */
  port?: number;
  /** Listen host. Defaults to 127.0.0.1 (localhost-only). */
  host?: string;
}

/** Send a JSON response with the given status. */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

/** Serve a file from web/, guarding against path traversal outside WEB_DIR. */
async function sendStatic(res: http.ServerResponse, relPath: string): Promise<void> {
  const resolved = nodePath.resolve(WEB_DIR, relPath);
  if (resolved !== WEB_DIR && !resolved.startsWith(WEB_DIR + nodePath.sep)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const data = await readFile(resolved);
    const ext = nodePath.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": STATIC_TYPES[ext] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "not found" });
  }
}

/**
 * Reveal or open a filesystem path with the OS's default handler. `reveal`
 * selects the file in the file manager (Explorer/Finder); otherwise the path
 * is opened with its default application. Uses execFile with array args (no
 * shell) so a path can never be interpreted as a command. The caller MUST
 * have already validated that `absPath` stays inside the repo.
 */
function osOpen(absPath: string, reveal: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];
    if (process.platform === "win32") {
      cmd = "explorer.exe";
      // explorer returns exit code 1 even on success, so we don't treat a
      // non-zero code as failure below for win32.
      args = reveal ? [`/select,${absPath}`] : [absPath];
    } else if (process.platform === "darwin") {
      cmd = "open";
      args = reveal ? ["-R", absPath] : [absPath];
    } else {
      // Linux/other: no portable "reveal", so open the parent dir when
      // revealing, else the path itself.
      cmd = "xdg-open";
      args = [reveal ? nodePath.dirname(absPath) : absPath];
    }
    execFile(cmd, args, (err) => {
      if (err && process.platform !== "win32") reject(err);
      else resolve();
    });
  });
}

/**
 * Build the request handler bound to a shared Engine + repo. Exposed
 * separately from startServer() so it can be unit-tested without a live
 * socket (feed it mock req/res).
 */
export function createHandler(engine: Engine, repoPath: string) {
  const indexPath = nodePath.join(repoPath, STATE_DIR, "index.db");

  return async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      // Static SPA
      if (path === "/") {
        await sendStatic(res, "index.html");
        return;
      }
      if (path.startsWith("/static/")) {
        await sendStatic(res, path.slice("/static/".length));
        return;
      }

      // API endpoints — all require an index. Guard the lazy-index invariant:
      // never let Engine.stats() create an empty index.db on a fresh repo.
      if (path.startsWith("/api/")) {
        if (!existsSync(indexPath)) {
          sendJson(res, 409, {
            error: "no index",
            hint: "Run `cv index` first to build the index.",
          });
          return;
        }

        if (path === "/api/stats") {
          sendJson(res, 200, await engine.stats());
          return;
        }
        if (path === "/api/token-map") {
          const stats = await engine.stats();
          sendJson(res, 200, stats.tokenMap);
          return;
        }
        if (path === "/api/sync") {
          // Board ⑥: full runtime sync state from the last index() run.
          // Null when the repo was never indexed → 200 with null body so the
          // frontend can render an "index first" empty state.
          sendJson(res, 200, await engine.syncState());
          return;
        }
        if (path === "/api/search-debug") {
          // Board ④: per-path (BM25 / co-location) + fused breakdown for a
          // query. Missing/short query → empty result from searchDebug (no
          // throw). topK optional (default 20).
          const query = url.searchParams.get("query") ?? "";
          const topK = Number(url.searchParams.get("topK")) || 20;
          sendJson(res, 200, await engine.searchDebug(query, { topK }));
          return;
        }
        if (path === "/api/graph") {
          // Board ③: top-N nodes by pagerank + edges among them.
          const limit = Number(url.searchParams.get("limit")) || 200;
          sendJson(res, 200, await engine.graphData(limit));
          return;
        }
        if (path === "/api/node") {
          // Board ③ click-detail: full metadata for one node id. Unknown id
          // → 404 so the UI can show a "not found" state.
          const id = url.searchParams.get("id");
          if (!id) {
            sendJson(res, 400, { error: "missing id" });
            return;
          }
          const detail = await engine.nodeDetail(id);
          if (!detail) {
            sendJson(res, 404, { error: "unknown node" });
            return;
          }
          sendJson(res, 200, detail);
          return;
        }
        if (path === "/api/open") {
          // Board ③ click-detail: reveal/open a repo file in the OS. LOCAL
          // TOOL ONLY — guarded to paths inside the repo. `path` is repo-
          // relative (as stored in nodes.file_path); reveal=1 highlights it
          // in the file manager, else opens with the default app.
          const rel = url.searchParams.get("path") ?? "";
          const reveal = url.searchParams.get("reveal") === "1";
          const abs = nodePath.resolve(repoPath, rel);
          // Containment guard: abs must be repoPath itself or under it.
          if (abs !== repoPath && !abs.startsWith(repoPath + nodePath.sep)) {
            sendJson(res, 403, { error: "path outside repo" });
            return;
          }
          if (!existsSync(abs)) {
            sendJson(res, 404, { error: "file not found", path: rel });
            return;
          }
          try {
            await osOpen(abs, reveal);
            sendJson(res, 200, { ok: true, path: rel, reveal });
          } catch (err) {
            sendJson(res, 500, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }
        if (path === "/api/pack-preview") {
          // Board ⑤: run pack() but return only the layer/token summary (no
          // content). budget + strategy drive layer selection; defaults match
          // Engine.pack(). A big budget → mostly "full"; a small one forces
          // skeleton/outline/omit downgrades.
          const budgetParam = Number(url.searchParams.get("budget"));
          const strategy = url.searchParams.get("strategy") ?? undefined;
          const opts: {
            tokenBudget?: number;
            layerStrategy?: "auto" | "full" | "skeleton" | "outline";
          } = {};
          if (budgetParam > 0) opts.tokenBudget = budgetParam;
          if (
            strategy === "auto" ||
            strategy === "full" ||
            strategy === "skeleton" ||
            strategy === "outline"
          ) {
            opts.layerStrategy = strategy;
          }
          sendJson(res, 200, await engine.packPreview(opts));
          return;
        }
        if (path === "/api/pack-content") {
          // Board ⑤: the FULL rendered pack output (not just the preview
          // summary). Same budget/strategy knobs as pack-preview, plus a
          // format param (xml | markdown | json). Returns the content string
          // so the UI can preview / copy / download it. Kept separate from
          // pack-preview so the budget slider stays cheap (no huge payload).
          const budgetParam = Number(url.searchParams.get("budget"));
          const strategy = url.searchParams.get("strategy") ?? undefined;
          const formatParam = url.searchParams.get("format") ?? "xml";
          const format =
            formatParam === "xml" || formatParam === "markdown" || formatParam === "json"
              ? formatParam
              : "xml";
          const opts: {
            tokenBudget?: number;
            layerStrategy?: "auto" | "full" | "skeleton" | "outline";
            format: "xml" | "markdown" | "json";
          } = { format };
          if (budgetParam > 0) opts.tokenBudget = budgetParam;
          if (
            strategy === "auto" ||
            strategy === "full" ||
            strategy === "skeleton" ||
            strategy === "outline"
          ) {
            opts.layerStrategy = strategy;
          }

          // V3-1/V3-2: scoped packing. scope=changed / since=<ref> →
          // diff-scoped (changed + impact); query=<text> → query-scoped
          // (search hits + call-graph neighborhood). Otherwise whole-repo.
          const scope = url.searchParams.get("scope");
          const since = url.searchParams.get("since") ?? undefined;
          const query = url.searchParams.get("query") ?? undefined;
          const depthParam = Number(url.searchParams.get("depth"));
          const depth = depthParam > 0 ? depthParam : 2;
          try {
            if (query) {
              const qr = await engine.packQuery(query, { ...opts, depth });
              sendJson(res, 200, {
                content: qr.content,
                format,
                tokenCount: qr.tokenCount,
                fileCount: qr.fileCount,
                expandableCount: Object.keys(qr.expandMap).length,
                scope: qr.scope,
                scopeArg: qr.scopeArg,
                seedFiles: qr.seedFiles,
                expandedFiles: qr.expandedFiles,
              });
              return;
            }
            if (scope === "changed" || since) {
              const scopedResult = await engine.packScoped({
                ...opts,
                since,
                depth,
              });
              sendJson(res, 200, {
                content: scopedResult.content,
                format,
                tokenCount: scopedResult.tokenCount,
                fileCount: scopedResult.fileCount,
                expandableCount: Object.keys(scopedResult.expandMap).length,
                scope: scopedResult.scope,
                seedFiles: scopedResult.seedFiles,
                expandedFiles: scopedResult.expandedFiles,
              });
              return;
            }
          } catch (err) {
            // Not a git repo / bad ref — surface as 400 so the UI can explain.
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }

          const result = await engine.pack(opts);
          sendJson(res, 200, {
            content: result.content,
            format,
            tokenCount: result.tokenCount,
            fileCount: result.fileCount,
            expandableCount: Object.keys(result.expandMap).length,
          });
          return;
        }
        if (path === "/api/callers" || path === "/api/callees") {
          // Board ③ click-highlight: callers/callees of a node id. Missing id
          // → 400; unknown id → Engine throws, caught below as 500.
          const id = url.searchParams.get("id");
          if (!id) {
            sendJson(res, 400, { error: "missing id" });
            return;
          }
          const depth = Number(url.searchParams.get("depth")) || 1;
          const graph =
            path === "/api/callers"
              ? await engine.callersGraph(id, depth)
              : await engine.calleesGraph(id, depth);
          // Only the neighbor ids + edges are needed to highlight; return the
          // ids and edges (frontend already has node metadata from /api/graph).
          sendJson(res, 200, {
            nodes: graph.nodes.map((n) => n.id),
            edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
          });
          return;
        }
        sendJson(res, 404, { error: "unknown endpoint" });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err: unknown) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * Start the Dashboard HTTP server. Opens one Engine, wires the handler, and
 * listens. Resolves with the server + a close() that shuts down both the
 * socket and the Engine. The process stays alive serving requests.
 */
export async function startServer(
  opts: ServeOptions = {},
): Promise<{ server: http.Server; close: () => Promise<void> }> {
  const repoPath = nodePath.resolve(opts.repoPath ?? ".");
  const port = opts.port ?? 7331;
  const host = opts.host ?? "127.0.0.1";

  const engine = await Engine.open(repoPath);
  const handler = createHandler(engine, repoPath);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });
  console.error(
    `[cv serve] dashboard on http://${host}:${port}  (repo: ${repoPath})`,
  );

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
  };
  return { server, close };
}
