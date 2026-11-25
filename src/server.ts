import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRuntime,
  createScoutThinHttpHandler,
  runtimeUrl,
  scanLocalFeedSessions,
  sendJson,
} from "scout-app/thin-server";
// @ts-expect-error plain ESM server module
import { handle as handleBoardsApi, local as isBoardsLocal } from "../server/api.mjs";

export const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const THIN_SHARED_PATHS = new Set([
  "/api/host-status",
  "/api/local-board",
  "/api/setup",
  "/api/recent-sessions",
  "/api/session-context",
  "/api/messages",
  "/v1/events/stream",
  "/v1/tail/events",
]);

function isThinSharedRoute(pathname: string): boolean {
  return THIN_SHARED_PATHS.has(pathname) || pathname.startsWith("/api/session-ref/");
}

function cleanCardCopy(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/^◈[^\n›]*›\s*(?:Previous task[^\n›]*›\s*)?/u, "")
    .replace(/^[a-z0-9._-]+\.\s*Task:\s*/i, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctOutcome(title: string, rawOutcome: string | null | undefined): string | null {
  const outcome = cleanCardCopy(rawOutcome);
  if (!outcome || outcome.length < 4) return null;
  const normTitle = title.toLowerCase();
  const normOutcome = outcome.toLowerCase();
  if (normTitle === normOutcome) return null;
  const prefixLen = Math.min(34, normTitle.length, normOutcome.length);
  if (prefixLen >= 16 && normTitle.slice(0, prefixLen) === normOutcome.slice(0, prefixLen)) {
    return null;
  }
  return outcome;
}

function buildLocalActivityBoard() {
  const items = scanLocalFeedSessions({ maxPerHarness: 18, limit: 36 });
  const now = Date.now();
  const activeCutoff = now - 20 * 60_000;

  const cards = items.map((item) => {
    const hasPrOrBranch = (item.prs && item.prs.length > 0) || (item.branch && item.branch !== "main" && item.branch !== "master");
    const column = item.at >= activeCutoff ? "active" : hasPrOrBranch ? "branches" : "completed";
    const title = cleanCardCopy(item.asked || item.title) || item.title;
    const outcome = distinctOutcome(title, item.title !== item.asked ? item.title : null);
    return {
      id: item.id,
      sessionId: item.sessionId,
      column,
      harness: item.source,
      project: item.project,
      branch: item.branch,
      title,
      outcome,
      files: item.filesTouched.length,
      prs: item.prs,
      updatedAt: item.at,
    };
  });

  return {
    columns: [
      { id: "active", name: "Active recently", state: "working", purpose: "Sessions updated in the last 20 minutes" },
      { id: "branches", name: "Pull requests & branches", state: "review", purpose: "Local sessions with pull requests or topic branches" },
      { id: "completed", name: "Completed turns", state: "done", purpose: "Recent finished agent sessions on this host" },
    ],
    cards,
  };
}

const handleThinRoutes = createScoutThinHttpHandler({
  packageName: "@openscout/boards",
  product: "Boards",
  apiHandler: async (req, res, { pathname }) => {
    if (req.method === "GET" && pathname === "/api/host-status") {
      const base = runtimeUrl();
      const runtimeUp = await checkRuntime(base);
      const localSessions = scanLocalFeedSessions({ maxPerHarness: 15, limit: 30 }).length;
      sendJson(res, 200, { runtimeUp, runtimeUrl: base, localSessions });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/local-board") {
      sendJson(res, 200, buildLocalActivityBoard());
      return true;
    }

    return false;
  },
});

export function createBoardsServer() {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (isThinSharedRoute(url.pathname)) {
      if (!isBoardsLocal(req)) {
        sendJson(res, 403, { error: "local only" });
        return;
      }
      if (await handleThinRoutes(req, res)) return;
    }

    if (await handleBoardsApi(req, res)) return;

    const u = url.pathname;
    const rel = path.normalize(u).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    let file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, "index.html");
    }
    if (!fs.existsSync(file)) {
      sendJson(res, 503, { error: "dist/index.html is missing. Run npm run build first." });
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    });
    fs.createReadStream(file).pipe(res);
  });
}

export function serve(port: number, host = "127.0.0.1"): Promise<http.Server> {
  const server = createBoardsServer();
  return new Promise((ok, no) => server.once("error", no).listen(port, host, () => ok(server)));
}
