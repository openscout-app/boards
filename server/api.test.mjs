// The /api routes against a fake runtime that serves the contract, and against one too old for it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeRuntime } from "../test/fake-runtime.mjs";
import { route } from "./api.mjs";

let fake;
const use = (f) => { process.env.SCOUT_RUNTIME_URL = f.url; };
const get = (p, q = {}) => route("GET", p, new URLSearchParams(q));
const post = (p, body) => route("POST", p, new URLSearchParams(), body);

before(async () => { fake = await fakeRuntime(); use(fake); });
after(async () => { await fake.close(); delete process.env.SCOUT_RUNTIME_URL; });

test("state says the runtime is up, with its boards and rooms", async () => {
  const r = await get("/api/state");
  assert.equal(r.status, 200);
  assert.equal(r.body.runtime.up, true);
  assert.equal(r.body.runtime.version, "0.0.0-fake");
  assert.deepEqual(r.body.boards, { supported: true, list: [{ id: "scout.default", name: "Default", version: 1, isDefault: true }] });
  assert.equal(r.body.rooms.supported, true);
  assert.equal(r.body.rooms.list.length, 2);
});

test("the board comes shaped, with the board list", async () => {
  const r = await get("/api/board");
  assert.equal(r.status, 200);
  assert.equal(r.body.board.id, "scout.default");
  assert.equal(r.body.boards.length, 1);
  assert.equal(r.body.columns.length, 7);
  assert.ok(r.body.transitions.some((t) => t.from === "*" && t.to === "dropped"), "a move from any station is kept");
  assert.equal(fake.calls.find((c) => c.path === "/v1/boards/scout.default").query.limit, "500");
  assert.equal(r.body.cards.length, 7);
  assert.equal(r.body.cards.find((c) => c.workId === "work-106").reviewPending, true);
});

test("a room comes folded, and an unknown one is a 404", async () => {
  const r = await get("/api/room", { conversationId: "conv-work" });
  assert.equal(r.status, 200);
  assert.equal(r.body.room.channel, "scout/work");
  assert.equal(r.body.view, "tasks");
  assert.equal(r.body.posts.length, 4);
  assert.equal(r.body.runs[0].jobs.length, 3);
  assert.equal(fake.calls.find((c) => c.path === "/v1/integrations/vercel-board/messages").query.channel, "scout/work");
  assert.equal((await get("/api/room", { conversationId: "conv-nope" })).status, 404);
});

test("a preview sends dryRun, as the operator, and changes nothing", async () => {
  const r = await post("/api/move", { workId: "work-101", to: "ready", dryRun: true, note: "  planned  " });
  assert.equal(r.status, 200);
  assert.equal(r.body.decision.verdict, "allow");
  assert.equal(r.body.applied, false);
  const sent = fake.calls.filter((c) => c.path === "/v1/work/move").at(-1).body;
  assert.deepEqual(sent, { workId: "work-101", to: "ready", actorId: "operator", dryRun: true, note: "planned" });
  assert.equal(fake.data.board.cards.find((c) => c.workId === "work-101").column, "backlog");
});

test("the runtime's verdicts come back as it gives them", async () => {
  const blind = await post("/api/move", { workId: "work-104", to: "waiting", dryRun: true });
  assert.equal(blind.body.decision.verdict, "deny");
  assert.equal(blind.body.decision.reasons.find((x) => x.outcome === "fail").message, "Say what it is waiting on.");
  const named = await post("/api/move", { workId: "work-104", to: "waiting", dryRun: true, waitingOn: { label: "a reply" } });
  assert.equal(named.body.decision.verdict, "allow");
  // Doing holds for anyone but the owner
  assert.equal((await post("/api/move", { workId: "work-101", to: "doing", dryRun: true })).body.decision.verdict, "hold");
  // any station can drop, with a reason
  assert.equal((await post("/api/move", { workId: "work-107", to: "dropped", dryRun: true, note: "not needed" })).body.decision.verdict, "allow");
});

test("writes are checked before they reach the runtime", async () => {
  const before = fake.calls.length;
  assert.equal((await post("/api/move", { workId: "", to: "x" })).status, 400);
  assert.equal((await post("/api/review", { workId: "work-106", moveId: "move-31", verdict: "approve", revision: 4 })).status, 400);
  assert.equal((await post("/api/review", { workId: "work-106", moveId: "move-31", verdict: "confirm" })).status, 400);
  assert.equal((await post("/api/claim", { workId: "work-101", action: "steal" })).status, 400);
  assert.equal(fake.calls.length, before, "nothing reached the runtime");
});

test("review and claim go through as the operator", async () => {
  const moves = await get("/api/moves", { workId: "work-106" });
  assert.equal(moves.body.moves[0].review, "pending");
  assert.equal((await post("/api/review", { workId: "work-106", moveId: "move-31", verdict: "confirm", revision: 4 })).status, 200);
  assert.equal(fake.calls.at(-1).body.actorId, "operator");
  assert.equal((await post("/api/claim", { workId: "work-101" })).status, 200);
  assert.deepEqual(fake.calls.at(-1).body, { workId: "work-101", action: "claim", actorId: "operator" });
});

test("only the listed routes answer", async () => {
  assert.equal((await get("/api/nope")).status, 404);
  assert.equal((await route("GET", "/api/move")).status, 405);
});

test("a runtime without /v1/boards reads as too old, with rooms still there", async () => {
  const old = await fakeRuntime({ boards: false });
  use(old);
  try {
    const s = await get("/api/state");
    assert.equal(s.body.boards.supported, false);
    assert.equal(s.body.rooms.supported, true);
    const b = await get("/api/board");
    assert.equal(b.status, 404);
    assert.equal(b.body.error, "boards_unsupported");
  } finally { await old.close(); use(fake); }
});

test("a card links to the room it came from, and only to a room Scout follows", async () => {
  const room = (r, id) => r.body.cards.find((c) => c.workId === id).roomId;
  const r = await get("/api/board");
  assert.equal(room(r, "work-102"), "conv-work", "a Board task finds its channel from its hand-offs");
  assert.equal(room(r, "work-105"), "conv-decisions", "a card from a followed conversation links to it");
  assert.equal(room(r, "work-104"), null, "a conversation Scout doesn't follow as a room links nowhere");
  assert.equal(room(r, "work-101"), null);
  const asked = () => fake.calls.filter((c) => c.path === "/v1/integrations/vercel-board/handoffs" && c.query.task === "m3").length;
  const before = asked();
  await get("/api/board");
  assert.equal(asked(), before, "a task's room is asked once, then kept");
});

test("a card from an outside tracker isn't moved or claimed from Scout", async () => {
  const sent = () => fake.calls.filter((c) => c.path === "/v1/work/move" || c.path === "/v1/work/claim").length;
  const before = sent();
  for (const [path, body] of [["/api/move", { workId: "work-102", to: "doing", dryRun: true }], ["/api/move", { workId: "work-102", to: "doing" }], ["/api/claim", { workId: "work-102" }]]) {
    const r = await post(path, body);
    assert.equal(r.status, 409, path);
    assert.equal(r.body.error, "tracker_owned");
    assert.match(r.body.message, /Vercel Board/);
  }
  assert.equal(sent(), before, "nothing reached the runtime");
  assert.equal((await post("/api/move", { workId: "work-101", to: "ready", dryRun: true })).status, 200, "Scout's own work still moves");
});

test("a runtime without the Board adapter has no rooms", async () => {
  const bare = await fakeRuntime({ rooms: false });
  use(bare);
  try {
    const s = await get("/api/state");
    assert.equal(s.body.rooms.supported, false);
    assert.equal((await get("/api/room", { conversationId: "conv-work" })).body.error, "rooms_unsupported");
    const b = await get("/api/board");
    assert.equal(b.status, 200, "the board still reads without rooms");
    assert.ok(b.body.cards.every((c) => c.roomId === null));
  } finally { await bare.close(); use(fake); }
});

test("no runtime is a plain 503", async () => {
  const gone = await fakeRuntime();
  await gone.close();
  use(gone);
  try {
    const s = await get("/api/state");
    assert.equal(s.status, 200);
    assert.equal(s.body.runtime.up, false);
    const b = await get("/api/board");
    assert.equal(b.status, 503);
    assert.equal(b.body.error, "runtime_down");
  } finally { use(fake); }
});
