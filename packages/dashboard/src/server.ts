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
