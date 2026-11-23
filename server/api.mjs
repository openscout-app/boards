// The HTTP side: a small /api that only calls Scout's runtime. Local only: a request from another
// site, or to a host name that isn't this machine, is refused, so no web page can move a card.
//
// The routes are plain functions (`route`), so the MCP server answers the view's reads and
// writes with exactly the same code, without HTTP in between.
import { RuntimeDown, RuntimeError, health, rt } from "./runtime.mjs";
import { pickBoard, shapeBoard, shapeBoards } from "./board.mjs";
import { defaultView, foldRoom, harnessesFrom, roomsFrom } from "./rooms.mjs";
import { changed, events } from "./live.mjs";

export const APP = "scout-boards";
export const VERSION = "0.2.0";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** A request from this machine, to this machine, from this page or from no page at all. */
export function local(req) {
  if (!LOCAL.test(req.headers.host || "")) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const WORK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

class Refused extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const need = (ok, message) => { if (!ok) throw new Refused(400, "bad_request", message); };

// ---- reads

/** Cards per board read: the runtime's most, newest first (it serves 100 unless asked). */
const BOARD_LIMIT = 500;

/** The boards the runtime serves. Null when the runtime is too old to serve any (404). */
export async function listBoards() {
  try { return shapeBoards(await rt("/v1/boards")); } catch (e) {
    if (e instanceof RuntimeError && e.status === 404) return null;
    throw e;
  }
}

export async function readBoard(want) {
  const boards = await listBoards();
  if (!boards) throw new Refused(404, "boards_unsupported", "This Scout's runtime doesn't serve boards.");
  const chosen = pickBoard(boards, want);
  if (!chosen) return { boards, board: null, columns: [], transitions: [], cards: [] };
  try {
    return { boards, ...shapeBoard(await rt(`/v1/boards/${encodeURIComponent(chosen.id)}?limit=${BOARD_LIMIT}`)) };
  } catch (e) {
    if (e instanceof RuntimeError && e.status === 404) throw new Refused(404, "no_such_board", `The runtime has no board ${chosen.id}.`);
    throw e;
  }
}

/** The Vercel Board connections, or null when the runtime has no Board adapter. */
async function connections() {
  try { return (await rt("/v1/integrations/vercel-board/status"))?.connections || []; } catch (e) {
    if (e instanceof RuntimeError && (e.status === 404 || e.code === "vercel_board_unavailable")) return null;
    throw e;
  }
}

export async function listRooms() {
  const list = await connections();
  return list === null ? null : { connections: list.length, rooms: roomsFrom(list) };
}

let harnessCache = null;
async function harnesses() {
  if (harnessCache && Date.now() - harnessCache.at < 30e3) return harnessCache.value;
  const value = harnessesFrom((await rt("/v1/endpoints").catch(() => null))?.endpoints);
  harnessCache = { at: Date.now(), value };
  return value;
}

export async function readRoom(conversationId) {
  const list = await connections();
  if (list === null) throw new Refused(404, "rooms_unsupported", "This Scout's runtime has no Vercel Board adapter.");
  for (const c of list) {
    const m = (c.mirror || []).find((x) => x.conversationId === conversationId);
    if (!m) continue;
    const q = (extra) => new URLSearchParams({ connection: c.id, ...extra }).toString();
    const [msgs, hand, who] = await Promise.all([
      rt(`/v1/integrations/vercel-board/messages?${q({ channel: m.channel, limit: "500" })}`),
      rt(`/v1/integrations/vercel-board/handoffs?${q({ limit: "500" })}`),
      harnesses(),
    ]);
    const fold = foldRoom({
      messages: msgs?.messages || [],
      handoffs: (hand?.handoffs || []).filter((h) => h.channel === m.channel),
      operatorPrincipal: c.principal || "",
      harnesses: who,
    });
    const [room] = roomsFrom([{ ...c, mirror: [m] }]);
    return { room, view: defaultView(m.channel, fold.posts), lastGoodReadAt: c.lastGoodReadAt ?? null, ...fold };
  }
  throw new Refused(404, "no_such_room", "Scout doesn't follow that room on this host.");
}

/** Everything the page needs to decide what to draw first. Never throws. */
export async function readState() {
  const runtime = await health();
  if (!runtime.up) return { runtime, boards: null, rooms: null };
  const [boards, rooms] = await Promise.all([
    listBoards().then((list) => ({ supported: list !== null, list: list || [] }), (e) => ({ supported: true, list: [], error: e.message })),
    listRooms().then((r) => (r ? { supported: true, connections: r.connections, list: r.rooms } : { supported: false, connections: 0, list: [] }),
      (e) => ({ supported: true, connections: 0, list: [], error: e.message })),
  ]);
  return { runtime, boards, rooms };
}

// ---- writes, each through the runtime, which checks and records it

async function move(b) {
  need(typeof b.workId === "string" && WORK_ID.test(b.workId), "workId is required");
  need(typeof b.to === "string" && ID.test(b.to), "to is required");
  const body = { workId: b.workId, to: b.to, actorId: "operator", dryRun: b.dryRun === true };
  if (typeof b.note === "string" && b.note.trim()) body.note = b.note.trim().slice(0, 4000);
  if (b.waitingOn && typeof b.waitingOn.label === "string" && b.waitingOn.label.trim()) body.waitingOn = { label: b.waitingOn.label.trim().slice(0, 400) };
  return rt("/v1/work/move", { method: "POST", body });
}

async function review(b) {
  need(typeof b.workId === "string" && WORK_ID.test(b.workId), "workId is required");
  need(typeof b.moveId === "string" && ID.test(b.moveId), "moveId is required");
  need(["confirm", "reopen", "consult"].includes(b.verdict), "verdict is confirm, reopen or consult");
  need(Number.isInteger(b.revision), "revision is required");
  const body = { workId: b.workId, moveId: b.moveId, verdict: b.verdict, revision: b.revision, actorId: "operator" };
  if (typeof b.note === "string" && b.note.trim()) body.note = b.note.trim().slice(0, 4000);
  return rt("/v1/work/review", { method: "POST", body });
}

async function claim(b) {
  need(typeof b.workId === "string" && WORK_ID.test(b.workId), "workId is required");
  const action = b.action ?? "claim";
  need(["claim", "release"].includes(action), "action is claim or release");
  const body = { workId: b.workId, action, actorId: "operator" };
  if (Number.isInteger(b.leaseGeneration)) body.leaseGeneration = b.leaseGeneration;
  return rt("/v1/work/claim", { method: "POST", body });
}

// ---- the routes, for HTTP and for the MCP view alike

export const READS = ["/api/hello", "/api/state", "/api/board", "/api/rooms", "/api/room", "/api/moves"];
export const WRITES = ["/api/move", "/api/review", "/api/claim"];

/** One API call. Resolves with { status, body }; never throws. */
export async function route(method, pathname, query = new URLSearchParams(), body = {}) {
  try {
    if (method === "GET") {
      if (pathname === "/api/hello") return ok({ app: APP, version: VERSION });
      if (pathname === "/api/state") return ok(await readState());
      if (pathname === "/api/board") return ok(await readBoard(query.get("id") || undefined));
      if (pathname === "/api/rooms") {
        const r = await listRooms();
        if (!r) throw new Refused(404, "rooms_unsupported", "This Scout's runtime has no Vercel Board adapter.");
        return ok(r);
      }
      if (pathname === "/api/room") {
        const id = query.get("conversationId") || "";
        need(ID.test(id), "conversationId is required");
        return ok(await readRoom(id));
      }
      if (pathname === "/api/moves") {
        const id = query.get("workId") || "";
        need(WORK_ID.test(id), "workId is required");
        return ok(await rt(`/v1/work/moves?workId=${encodeURIComponent(id)}`));
      }
    }
    if (method === "POST") {
      if (pathname === "/api/move") return ok(await move(body));
      if (pathname === "/api/review") return ok(await review(body));
      if (pathname === "/api/claim") return ok(await claim(body));
    }
    if ([...READS, ...WRITES].includes(pathname)) return { status: 405, body: { error: "method_not_allowed" } };
    return { status: 404, body: { error: "not_found" } };
  } catch (e) {
    if (e instanceof Refused) return { status: e.status, body: { error: e.code, message: e.message } };
    if (e instanceof RuntimeDown) return { status: 503, body: { error: "runtime_down", message: e.message } };
    // the runtime's own answer, as it gave it: a move it refused, a claim someone else holds
    if (e instanceof RuntimeError) return { status: e.status, body: { ...(e.body && typeof e.body === "object" ? e.body : {}), error: e.code, message: e.message } };
    return { status: 500, body: { error: "failed", message: String(e?.message || e) } };
  }
}
const ok = (body) => ({ status: 200, body });

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 256e3) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve(null); } });
  });
}

/** Handles /api/*; returns false for anything else. */
export async function handle(req, res) {
  const url = new URL(req.url, "http://local");
  if (!url.pathname.startsWith("/api/")) return false;
  if (!local(req)) { send(res, 403, { error: "local only" }); return true; }
  if (req.method === "GET" && url.pathname === "/api/events") {
    await events(req, res, { board: url.searchParams.get("board") || "", room: url.searchParams.get("room") || "" });
    return true;
  }
  let body = {};
  if (req.method === "POST") {
    // JSON only: a form post from another page can't set this, whatever its origin
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) { send(res, 415, { error: "json only" }); return true; }
    body = await readBody(req);
    if (!body || typeof body !== "object") { send(res, 400, { error: "bad_request", message: "the body isn't JSON" }); return true; }
  }
  const out = await route(req.method, url.pathname, url.searchParams, body);
  send(res, out.status, out.body);
  if (req.method === "POST" && out.status === 200 && body.dryRun !== true) changed();
  return true;
}
