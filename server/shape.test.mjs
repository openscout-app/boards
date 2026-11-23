import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBoard, shapeBoard, shapeBoards, targetsOf, describeBoard, boardForModel } from "./board.mjs";
import { boardSource, firstLine, profileLabel, foldRoom, pickRoom, roomsFrom, taskStateNow } from "./rooms.mjs";
import { fixtures } from "../test/fake-runtime.mjs";

const NOW = Date.UTC(2026, 0, 15, 12);

test("the board list keeps what the page needs", () => {
  const list = shapeBoards({ boards: [{ id: "a", name: "A", version: 2, isDefault: false, extra: 1 }, { id: "b", isDefault: true }, { name: "no id" }] });
  assert.deepEqual(list, [{ id: "a", name: "A", version: 2, isDefault: false }, { id: "b", name: "b", version: null, isDefault: true }]);
  assert.equal(pickBoard(list, "a").id, "a");
  assert.equal(pickBoard(list, "missing").id, "b");
  assert.equal(pickBoard(list).id, "b");
  assert.equal(pickBoard([], "a"), null);
});

test("a board's cards are complete, and a column the board lacks is none", () => {
  const raw = fixtures(NOW).board;
  raw.cards.push({ workId: "work-x", column: "gone", title: "Lost", next: [{ station: "done", name: "Done" }, "ready", { id: "nowhere" }] });
  raw.cards.push({ workId: "work-y", column: "review", title: "No next list" });
  raw.transitions.push({ from: "backlog", to: "gone" });
  const b = shapeBoard(raw);
  assert.equal(b.columns.length, 7);
  assert.ok(b.transitions.every((t) => b.columns.some((c) => c.id === t.to)), "transitions to unknown columns are dropped");
  assert.ok(b.transitions.some((t) => t.from === "*"), "a move from any station is kept");
  const lost = b.cards.find((c) => c.workId === "work-x");
  assert.equal(lost.column, null);
  assert.deepEqual(lost.next, ["done", "ready", "nowhere"]);
  assert.equal(lost.summary, null);
  assert.equal(lost.activeFlight, null);
  assert.equal(lost.source, null);
  const queued = b.cards.find((c) => c.workId === "work-104");
  assert.equal(queued.activeFlight.state, "queued");
  assert.equal(queued.activeFlight.harness, null);
  // where a card can go: its own list when it has one, the board's transitions otherwise
  assert.deepEqual(targetsOf(b, lost).map((c) => c.id), ["done", "ready"]);
  assert.deepEqual(targetsOf(b, b.cards.find((c) => c.workId === "work-y")).map((c) => c.id), ["doing", "done", "dropped"]);
});

test("the runtime's own card shape passes through", () => {
  const real = {
    workId: "work-mwtk195r-px6ep3", column: "doing", revision: 0, reviewPending: false, next: ["ready", "waiting", "review", "done", "dropped"],
    title: "A title", summary: null, state: "working", acceptanceState: "none", priority: null, ownerId: "operator", ownerName: "Operator",
    nextMoveOwnerId: "operator", nextMoveOwnerName: "Operator", conversationId: "chn-example", parentId: null, parentTitle: null,
    createdAt: 1795455814614, updatedAt: 1795455814614, lastMeaningfulAt: 1795455814817, lastMeaningfulSummary: "Operator queued for local execution.",
    source: null, activeFlight: { id: "flt-example", state: "queued", harness: null, sessionId: null, startedAt: 1795455814817 },
  };
  const b = shapeBoard({ ...fixtures(NOW).board, cards: [real] });
  assert.deepEqual(b.cards[0], real);
});

test("the board as text names its columns and counts", () => {
  const text = describeBoard(boardForModel(shapeBoard(fixtures(NOW).board)));
  assert.match(text, /Default/);
  assert.match(text, /In review/);
  assert.match(text, /Answer 404 from \/v1\/boards/);
});

test("rooms come from the mirrored channels, without the probe", () => {
  const { connections } = fixtures(NOW);
  const rooms = roomsFrom(connections);
  assert.deepEqual(rooms.map((r) => r.channel), ["scout/work", "scout/decisions"]);
  assert.equal(rooms[0].board, "General");
  assert.equal(rooms[0].adapterId, "vercel-board");
  assert.deepEqual(boardSource("https://vercel.com/x/~/messageboard/boards/Ops%20Room?teamId=t1"), { name: "Ops Room", team: "t1" });
  assert.equal(pickRoom(rooms).channel, "scout/work", "newest first");
  assert.equal(pickRoom(rooms, "decisions").channel, "scout/decisions");
  assert.equal(pickRoom(rooms, "conv-decisions").channel, "scout/decisions");
  assert.equal(pickRoom(rooms, "General scout/work").channel, "scout/work");
});

test("a room folds into posts with their threads, and tasks into runs", () => {
  const d = fixtures(NOW);
  const fold = foldRoom({
    messages: d.messages.filter((m) => m.channel === "scout/work"),
    handoffs: d.handoffs,
    operatorPrincipal: d.connections[0].principal,
    harnesses: { "builder.boards": "claude" },
    now: NOW,
  });
  assert.deepEqual(fold.posts.map((p) => p.id), ["m1", "m2", "m3", "m4"]);
  const plan = fold.posts[0];
  assert.equal(plan.by.label, "You");
  assert.equal(plan.replies.length, 1);
  assert.equal(plan.replies[0].by.label, "builder");
  const server = fold.posts[1];
  assert.equal(server.task.state, "done");
  assert.deepEqual(server.steps.map((s) => s.kind), ["claimed", "completed"]);
  assert.equal(server.steps[0].to.harness, "claude");
  assert.equal(fold.runs.length, 1);
  const [run] = fold.runs;
  assert.equal(run.label, "Boards app");
  assert.deepEqual(run.jobs.map((j) => [j.step, j.state]), [["Server", "done"], ["Page", "running"], ["Checks", "waiting"]]);
  assert.deepEqual(fold.counts, { done: 1, running: 1, waiting: 1 });
});

test("a claim past its lease reads as ready", () => {
  const past = { state: "claimed", claim: { actor: "a", until: new Date(NOW - 1000).toISOString() } };
  const future = { state: "claimed", claim: { actor: "a", until: new Date(NOW + 1000).toISOString() } };
  assert.equal(taskStateNow(past, NOW), "ready");
  assert.equal(taskStateNow(future, NOW), "claimed");
});

test("a first line drops Markdown and cuts at a word", () => {
  assert.equal(firstLine("## Heading **bold**\nmore"), "Heading bold");
  assert.equal(firstLine("```\ncode\n```\n- [link](http://x) text"), "link text");
  assert.equal(firstLine("alpha beta gamma delta", 15), "alpha beta…");
  assert.equal(firstLine(""), null);
});

test("a session profile shows as a short session id", () => {
  assert.equal(profileLabel("session:67aca134-f2e3-439a-a2cb-f75fb0000000"), "session 67aca134");
  assert.equal(profileLabel("session-mwtjivju-on5s5o"), "session mwtjivju");
  assert.equal(profileLabel("designer"), "designer");
});
