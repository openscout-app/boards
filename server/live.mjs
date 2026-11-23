// The page, pushed. A page opens /api/events?board=…&room=… and gets the runtime's state, its board
// and its room once, then again each time one changes. Changes come from the runtime's own event
// stream (/v1/events/stream: work items, flights, Board hand-offs), and a modest tick catches what
// no event announces, such as a new post on a board or the runtime going away. A frame goes out
// only when what the page draws changed.
import { onRuntimeEvents } from "./runtime.mjs";
import { readBoard, readRoom, readState } from "./api.mjs";

const EVENT_GAP = 400;  // work items change several times in one move
const TICK = 10e3;

/** Runtime events that can change a card or a room. Presence and deliveries can't. */
export const RELEVANT = /^(collaboration\.|flight\.|vercel_board\.|agent\.endpoint\.)/;

const subs = new Set(); // { res, board, room, sent: Map(kind -> json) }
let generation = 0;
let timer = null, busy = false, again = false, ticker = null, offEvents = null;

/** GET /api/events: an event stream of what one page draws. */
export async function events(req, res, { board = "", room = "" } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
  res.write("retry: 2000\n\n");
  const sub = { res, board, room, sent: new Map(), delivered: 0 };
  subs.add(sub);
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 20e3);
  req.on("close", () => {
    clearInterval(keepalive);
    subs.delete(sub);
    if (!subs.size) stop();
  });
  start();
  await push([sub]);
}

/** What a read gives a page: the data, or why there is none. */
async function settle(p) {
  try { return { ok: true, data: await p }; } catch (e) {
    return { ok: false, error: e.code || "failed", message: e.message, status: e.status || 500 };
  }
}

/** Read once for every board and room someone watches, and send each page what changed for it. */
async function push(only = [...subs]) {
  if (!only.length) return;
  const round = ++generation;
  const state = await readState();
  const boards = new Map(), rooms = new Map();
  if (state.runtime.up && state.boards?.supported) {
    for (const s of only) if (!boards.has(s.board)) boards.set(s.board, settle(readBoard(s.board || undefined)));
  }
  if (state.runtime.up && state.rooms?.supported) {
    for (const s of only) if (s.room && !rooms.has(s.room)) rooms.set(s.room, settle(readRoom(s.room)));
  }
  for (const s of only) {
    const out = [["state", state]];
    if (boards.has(s.board)) out.push(["board", { key: s.board, ...(await boards.get(s.board)) }]);
    if (rooms.has(s.room)) out.push(["room", { key: s.room, ...(await rooms.get(s.room)) }]);
    // A newer refresh can finish while this subscriber's first snapshot is in flight.
    if (!subs.has(s) || s.res.destroyed || s.res.writableEnded || round < s.delivered) continue;
    s.delivered = round;
    for (const [kind, data] of out) {
      const json = JSON.stringify(data);
      if (s.sent.get(kind) === json) continue;
      s.sent.set(kind, json);
      s.res.write(`event: ${kind}\ndata: ${json}\n\n`);
    }
  }
}

/** Something on this host just changed the work (a move, a review, a claim made here): read again
 * now rather than at the next event or tick. */
export function changed() { if (subs.size) soon(0); }

function soon(ms) { if (!timer) timer = setTimeout(flush, ms); }

async function flush() {
  timer = null;
  if (busy) { again = true; return; }
  busy = true;
  try { await push(); } catch {} finally { busy = false; }
  if (again) { again = false; soon(EVENT_GAP); }
}

function start() {
  if (ticker) return;
  offEvents = onRuntimeEvents((kind) => {
    if (kind === "stream.open" || kind === "stream.closed" || RELEVANT.test(kind)) soon(EVENT_GAP);
  });
  ticker = setInterval(() => soon(0), TICK);
}

function stop() {
  offEvents?.(); offEvents = null;
  clearInterval(ticker); ticker = null;
  clearTimeout(timer); timer = null;
}
