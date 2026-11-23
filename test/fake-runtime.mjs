// A stand-in for Scout's runtime that serves the routes Boards reads, with made-up work: the
// boards contract (/v1/boards), the Vercel Board adapter's routes, and /v1/work/*. It keeps its
// state in memory, so a move made against it changes nothing anywhere else.
//
//   node test/fake-runtime.mjs [port]            serve it, for a look at the page
//   SCOUT_RUNTIME_URL=http://127.0.0.1:<port> node bin/boards.mjs
import http from "node:http";
import { fileURLToPath } from "node:url";

const H = 3600e3;

// The board mirrors the runtime's shipped example lifecycle (scout.default) and its card shape, as
// GET /v1/boards/:id gives them: `next` is the stations a move can name, most cards have no adapter
// source, and fields the runtime can't fill are null.
const LIFECYCLE = {
  board: { id: "scout.default", name: "Default", version: 1, hash: "fixture", description: "An example lifecycle. Agents move their own work; review is a station with rules, not an approval." },
  columns: [
    { id: "backlog", name: "Backlog", state: "open", purpose: "Captured, not yet planned." },
    { id: "ready", name: "Ready", state: "open", purpose: "Planned and ready to start." },
    { id: "doing", name: "Doing", state: "working", purpose: "Someone is working on it." },
    { id: "waiting", name: "Waiting", state: "waiting", purpose: "Blocked on something named." },
    { id: "review", name: "In review", state: "review", purpose: "Done by the owner; another agent checks it." },
    { id: "done", name: "Done", state: "done", purpose: "Delivered." },
    { id: "dropped", name: "Dropped", state: "cancelled", purpose: "Not doing it." },
  ],
  transitions: [
    { from: "backlog", to: "ready", name: null }, { from: "ready", to: "backlog", name: null },
    { from: "backlog", to: "doing", name: null }, { from: "ready", to: "doing", name: null },
    { from: "doing", to: "ready", name: null }, { from: "doing", to: "waiting", name: null },
    { from: "waiting", to: "doing", name: null }, { from: "doing", to: "review", name: null },
    { from: "review", to: "doing", name: "Send back" }, { from: "review", to: "done", name: null },
    { from: "doing", to: "done", name: null }, { from: "done", to: "doing", name: "Reopen" },
    { from: "*", to: "dropped", name: null }, { from: "dropped", to: "backlog", name: "Restore" },
  ],
};

/** The stations a card in `column` can move to, as the runtime lists them in `next`. */
export const nextFrom = (column) => [...new Set(LIFECYCLE.transitions.filter((t) => (t.from === column || t.from === "*") && t.to !== column).map((t) => t.to))];

export function fixtures(now = Date.now()) {
  const card = (workId, column, title, extra = {}) => ({
    workId, column, revision: 0, reviewPending: false, next: nextFrom(column), title, summary: null, state: "open",
    acceptanceState: "none", priority: null, ownerId: null, ownerName: null, nextMoveOwnerId: null, nextMoveOwnerName: null,
    conversationId: null, parentId: null, parentTitle: null, createdAt: now - 30 * H, updatedAt: now - 2 * H,
    lastMeaningfulAt: now - 2 * H, lastMeaningfulSummary: null, source: null, activeFlight: null, ...extra,
  });
  const operator = { ownerId: "operator", ownerName: "Operator", nextMoveOwnerId: "operator", nextMoveOwnerName: "Operator" };
  const board = {
    ...structuredClone(LIFECYCLE),
    // most recently updated first, as the runtime orders them
    cards: [
      card("work-104", "doing", "Draw the Tasks view for a Board room", {
        state: "working", ...operator, conversationId: "chn-example-1", updatedAt: now - 0.1 * H, lastMeaningfulAt: now - 0.1 * H,
        lastMeaningfulSummary: "Operator queued for local execution.",
        activeFlight: { id: "flt-example-10", state: "queued", harness: null, sessionId: null, startedAt: now - 0.1 * H },
      }),
      card("work-103", "doing", "Split the runtime event stream into its own module", {
        state: "working", ownerId: "builder.boards", ownerName: "builder", nextMoveOwnerId: "builder.boards", nextMoveOwnerName: "builder",
        summary: "One reader of /v1/events/stream for the whole server, shared by every page that listens.",
        activeFlight: { id: "flt-example-9", state: "running", harness: "claude", sessionId: "session-4", startedAt: now - 0.4 * H },
        updatedAt: now - 0.4 * H, lastMeaningfulAt: now - 0.4 * H, lastMeaningfulSummary: "Moved the reader out of the server.",
      }),
      card("work-106", "review", "Answer 404 from /v1/boards with an update screen", {
        state: "review", reviewPending: true, revision: 4, ownerId: "builder.boards", ownerName: "builder", acceptanceState: "pending",
        parentId: "work-100", parentTitle: "Boards as its own app", updatedAt: now - 1 * H, lastMeaningfulAt: now - 1 * H,
      }),
      card("work-102", "ready", "Check the settings page at phone width", {
        source: { adapterId: "vercel-board", instanceId: "conn-1", workItemId: "msg-7", url: null },
      }),
      card("work-105", "waiting", "Pick the default port", { state: "waiting", ...operator, revision: 2, summary: "Waiting on a decision about the port range.", updatedAt: now - 3 * H, lastMeaningfulAt: now - 3 * H }),
      card("work-101", "backlog", "Write the first-run copy for the empty board", { createdAt: now - 5 * H, updatedAt: now - 5 * H, lastMeaningfulAt: now - 5 * H }),
      card("work-107", "done", "Serve the page on loopback only", { state: "done", acceptanceState: "accepted", revision: 5, ownerId: "builder.boards", ownerName: "builder", updatedAt: now - 26 * H, lastMeaningfulAt: now - 26 * H }),
    ],
  };
  const principal = "vercel:user:operator-example";
  const at = (h) => now - h * H;
  const by = (p, profile = null) => ({ actor: profile ? `${p}+${profile}` : p, principal: p, profile });
  const messages = [
    { id: "m1", channel: "scout/work", re: null, labels: {}, by: by(principal), deleted: false, text: "Plan for the boards app: serve it on its own port, read only the runtime.", createdAt: at(6) },
    { id: "m2", channel: "scout/work", re: null, labels: { "scout.plan": "boards-app", step: "Server" }, by: by(principal, "scout"), deleted: false,
      text: "Boards app: write the server", task: { state: "completed", needs: [], claim: null, result: "Server answers on 127.0.0.1 with an Origin check.", reason: null }, createdAt: at(5.5), editedAt: at(3) },
    { id: "m3", channel: "scout/work", re: null, labels: { "scout.plan": "boards-app", step: "Page" }, by: by(principal, "scout"), deleted: false,
      text: "Boards app: draw the page", task: { state: "claimed", needs: ["m2"], claim: { actor: `${principal}+designer`, until: new Date(now + H).toISOString() }, result: null, reason: null }, createdAt: at(5.4) },
    { id: "m4", channel: "scout/work", re: null, labels: { "scout.plan": "boards-app", step: "Checks" }, by: by(principal, "scout"), deleted: false,
      text: "Boards app: run the checks", task: { state: "waiting", needs: ["m3"], claim: null, result: null, reason: null }, createdAt: at(5.3) },
    { id: "m5", channel: "scout/work", re: "m1", labels: { "scout.agent": "builder.boards" }, by: by(principal, "scout"), deleted: false, text: "Taking the server. The page waits on it.", createdAt: at(5.2) },
    { id: "m6", channel: "scout/decisions", re: null, labels: {}, by: by("vercel:user:teammate"), deleted: false, text: "Boards keeps no records of its own. Moves go through the runtime.", createdAt: at(20) },
  ];
  const handoffs = [
    { id: "h1", taskId: "m2", channel: "scout/work", kind: "claimed", at: at(5), cursor: "1", actor: by(principal, "scout"), to: `${principal}+builder`, scout: { agentId: "builder.boards", flightId: "flight-7" }, derived: false },
    { id: "h2", taskId: "m2", channel: "scout/work", kind: "completed", at: at(3), cursor: "2", actor: by(principal, "builder"), to: `${principal}+builder`, result: "Server answers on 127.0.0.1 with an Origin check.", scout: { agentId: "builder.boards", flightId: "flight-7" }, derived: false },
    { id: "h3", taskId: "m3", channel: "scout/work", kind: "claimed", at: at(2), cursor: "3", actor: by(principal, "scout"), to: `${principal}+designer`, scout: { agentId: "designer.boards", flightId: "flight-8" }, derived: false },
  ];
  const connections = [{
    id: "conn-1", state: "connected", principal, lastGoodReadAt: now - 60e3,
    url: "https://vercel.com/example/~/messageboard/boards/General?teamId=team_example",
    mirror: [
      { conversationId: "conv-work", channel: "scout/work", state: "following", messages: 5, lastDeltaAt: at(2) },
      { conversationId: "conv-decisions", channel: "scout/decisions", state: "following", messages: 1, lastDeltaAt: at(20) },
      { conversationId: "conv-probe", channel: "scout/probe", state: "following", messages: 1, lastDeltaAt: at(1) },
    ],
  }];
  const endpoints = [{ agentId: "builder.boards", harness: "claude", state: "active" }, { agentId: "designer.boards", harness: "codex", state: "active" }];
  const moves = [{ id: "move-31", itemId: "work-106", from: "working", to: "review", moverId: "builder.boards", verdict: "allow", note: "Handled the 404 and the copy.", revision: 4, review: "pending", createdAt: at(1) }];
  return { board, messages, handoffs, connections, endpoints, moves };
}

/** Start the fake on `port` (0 for any). It resolves to { url, close, calls, data }. */
export function fakeRuntime({ port = 0, boards = true, rooms = true, now } = {}) {
  const data = fixtures(now);
  const calls = [];
  const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://fake");
    let body = null;
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    }
    calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
    const p = u.pathname;
    if (p === "/health") return send(res, 200, { ok: true, build: { version: "0.0.0-fake" } });
    if (p === "/v1/events/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: hello\ndata: {}\n\n");
      return;
    }
    if (p === "/v1/boards") {
      if (!boards) return send(res, 404, { error: "not_found" });
      const b = data.board.board;
      return send(res, 200, { boards: [{ id: b.id, name: b.name, version: b.version, isDefault: true }] });
    }
    if (p.startsWith("/v1/boards/")) {
      if (!boards) return send(res, 404, { error: "not_found" });
      const id = decodeURIComponent(p.slice(11));
      return id === data.board.board.id || id === "default" ? send(res, 200, data.board) : send(res, 404, { error: "unknown board" });
    }
    if (p.startsWith("/v1/integrations/vercel-board/") && !rooms) return send(res, 404, { error: "not_found" });
    if (p === "/v1/integrations/vercel-board/status") return send(res, 200, { connections: data.connections });
    if (p === "/v1/integrations/vercel-board/messages") {
      return send(res, 200, { messages: data.messages.filter((m) => m.channel === u.searchParams.get("channel")) });
    }
    if (p === "/v1/integrations/vercel-board/handoffs") return send(res, 200, { handoffs: data.handoffs });
    if (p === "/v1/endpoints") return send(res, 200, { endpoints: data.endpoints });
    if (p === "/v1/work/moves") return send(res, 200, { moves: data.moves.filter((m) => m.itemId === u.searchParams.get("workId")) });
    if (p === "/v1/work/move" && req.method === "POST") {
      const c = data.board.cards.find((x) => x.workId === body.workId);
      if (!c) return send(res, 404, { error: "no_such_work", message: "No work item with that id." });
      const legal = data.board.transitions.some((t) => (t.from === c.column || t.from === "*") && t.to === body.to);
      const toState = data.board.columns.find((x) => x.id === body.to)?.state || body.to;
      // the shipped example's station rules: Doing holds for anyone but the owner, Waiting names its
      // blocker, Dropped says why
      const rules = [];
      if (body.to === "doing") rules.push({ ruleId: "doing-by-owner", ok: c.ownerId === body.actorId, effect: "hold", message: "Only the owner starts it. Claim it first." });
      if (body.to === "waiting") rules.push({ ruleId: "waiting-names-blocker", ok: Boolean(body.waitingOn?.label), effect: "deny", message: "Say what it is waiting on." });
      if (body.to === "dropped") rules.push({ ruleId: "dropped-has-reason", ok: Boolean(body.note), effect: "deny", message: "Say why it is dropped." });
      const failed = rules.filter((r) => !r.ok);
      const verdict = !legal ? "deny" : failed.find((r) => r.effect === "deny") ? "deny" : failed.length ? "hold" : "allow";
      const decision = {
        verdict, from: c.column, to: body.to, toState, review: body.to === "review" ? "pending" : "not_needed",
        reasons: [
          { ruleId: "transition", scope: "lifecycle", check: "transition", outcome: legal ? "pass" : "fail", effect: legal ? "allow" : "deny", message: legal ? "The lifecycle has this move." : "The lifecycle has no move between these stations." },
          ...rules.map((r) => ({ ruleId: r.ruleId, scope: "station", check: r.ruleId, outcome: r.ok ? "pass" : "fail", effect: r.effect, message: r.message })),
        ],
      };
      if (body.dryRun || verdict !== "allow") return send(res, 200, { decision, applied: false });
      c.column = body.to; c.next = nextFrom(body.to); c.state = toState; c.reviewPending = body.to === "review"; c.revision += 1; c.updatedAt = Date.now();
      return send(res, 200, { decision, applied: true, move: { id: `move-${calls.length}` } });
    }
    if (p === "/v1/work/review" && req.method === "POST") {
      const move = data.moves.find((m) => m.itemId === body.workId && m.id === body.moveId);
      const card = data.board.cards.find((c) => c.workId === body.workId);
      if (!move || !card) return send(res, 404, { message: "No such move." });
      if (!["pending", "consulted"].includes(move.review)) return send(res, 409, { message: "This move was already reviewed." });
      const status = move.revision === body.revision && card.revision === body.revision ?
        { confirm: "confirmed", reopen: "reopened", consult: "consulted" }[body.verdict] : "stale";
      move.review = status;
      if (status === "confirmed" || status === "reopened") card.reviewPending = false;
      if (status === "reopened") { card.column = move.from; card.revision++; }
      return send(res, 200, { status, move });
    }
    if (p === "/v1/work/claim" && req.method === "POST") return send(res, 200, { ownerId: body.actorId, leaseGeneration: 1 });
    send(res, 404, { error: "not_found" });
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    ok({ url, calls, data, close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }) });
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 43199;
  const f = await fakeRuntime({ port, boards: !process.argv.includes("--no-boards"), rooms: !process.argv.includes("--no-rooms") });
  console.log(`Fake runtime at ${f.url}`);
}
