import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { changed, events } from "./live.mjs";
import { fakeRuntime } from "../test/fake-runtime.mjs";

function signal() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a delayed first snapshot cannot overwrite a refresh or write after disconnect", { timeout: 5000 }, async (t) => {
  const runtime = await fakeRuntime();
  const previous = process.env.SCOUT_RUNTIME_URL;
  process.env.SCOUT_RUNTIME_URL = runtime.url;
  const firstRead = signal(), release = signal(), delivered = signal();
  const fetchRuntime = globalThis.fetch;
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const response = await fetchRuntime(url, options);
    if (!String(url).includes("/v1/boards/scout.default?")) return response;
    const board = await response.json();
    board.cards[0].revision = ++count;
    if (count === 1) { firstRead.resolve(); await release.promise; }
    return Response.json(board);
  });
  const req = new EventEmitter();
  const revisions = [];
  const res = { writeHead() {}, write(frame) {
    if (frame.startsWith("event: board\n")) {
      const data = JSON.parse(frame.split("\ndata: ")[1]);
      revisions.push(data.data.cards[0].revision);
      delivered.resolve();
    }
  } };
  try {
    const first = events(req, res);
    await firstRead.promise;
    changed();
    await delivered.promise;
    release.resolve();
    await first;
    assert.deepEqual(revisions, [2]);

    const closed = new EventEmitter();
    const frames = [];
    const inFlight = events(closed, { writeHead() {}, write: (frame) => frames.push(frame) });
    closed.emit("close");
    await inFlight;
    assert.deepEqual(frames, ["retry: 2000\n\n"]);
  } finally {
    req.emit("close");
    release.resolve();
    await runtime.close();
    if (previous === undefined) delete process.env.SCOUT_RUNTIME_URL;
    else process.env.SCOUT_RUNTIME_URL = previous;
  }
});
