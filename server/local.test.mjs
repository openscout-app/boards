import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { start } from "./local.mjs";
import { serve } from "./serve.mjs";
import { local } from "./api.mjs";

const listen = (server, port = 0) => new Promise((ok, no) => server.once("error", no).listen(port, "127.0.0.1", () => ok(server.address().port)));
const close = (server) => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); });

/** A free port with the next one free too, found by asking the system for one. */
async function freePair() {
  for (;;) {
    const a = http.createServer();
    const port = await listen(a);
    await close(a);
    const b = http.createServer();
    try { await listen(b, port + 1); await close(b); return port; } catch {}
  }
}

test("Boards takes the next port when something else holds the first", async () => {
  const port = await freePair();
  const other = http.createServer((_, res) => res.end("not boards"));
  await listen(other, port);
  let r = null;
  try {
    r = await start({ first: port, serve });
    assert.equal(r.reused, false);
    // the next port, or a later one if a parallel test took it in between
    assert.ok(r.port > port);
    // a second start finds the first Boards and reuses it
    const again = await start({ first: port, serve });
    assert.equal(again.reused, true);
    assert.equal(again.port, r.port);
  } finally {
    if (r?.server) await close(r.server);
    await close(other);
  }
});

test("a port asked for and held by something else is an error", async () => {
  const port = await freePair();
  const other = http.createServer((_, res) => res.end("not boards"));
  await listen(other, port);
  try {
    await assert.rejects(start({ first: port, strict: true, serve }), /port .* is taken/);
  } finally { await close(other); }
});

test("only a page from this host's own origin gets the api", () => {
  const req = (host, origin) => ({ headers: { host, ...(origin ? { origin } : {}) } });
  assert.equal(local(req("localhost:4802")), true);
  assert.equal(local(req("127.0.0.1:4802", "http://127.0.0.1:4802")), true);
  assert.equal(local(req("localhost:4802", "http://localhost:4802")), true);
  assert.equal(local(req("localhost:4802", "https://example.com")), false);
  assert.equal(local(req("localhost:4802", "http://localhost:4803")), false);
  assert.equal(local(req("boards.example.com")), false);
  assert.equal(local(req("localhost:4802", "null")), false);
});

test("the server refuses another origin, and answers its own", async () => {
  const server = await serve(0);
  const { port } = server.address();
  try {
    const get = (headers) => new Promise((ok, no) => http.get({ host: "127.0.0.1", port, path: "/api/hello", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => ok({ status: res.statusCode, body }));
    }).on("error", no));
    const mine = await get({ origin: `http://127.0.0.1:${port}` });
    assert.equal(mine.status, 200);
    assert.equal(JSON.parse(mine.body).app, "scout-boards");
    assert.equal((await get({ origin: "https://example.com" })).status, 403);
    assert.equal((await get({ host: "boards.example.com" })).status, 403);
  } finally { await close(server); }
});
