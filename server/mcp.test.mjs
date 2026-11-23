// The MCP server over stdio: the handshake, the tools, the view, and the view's reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { fakeRuntime } from "../test/fake-runtime.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "boards.mjs");

function client(env) {
  const child = spawn(process.execPath, [BIN, "mcp"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  let id = 0;
  const call = (method, params) => new Promise((ok) => {
    const n = ++id;
    waiting.set(n, ok);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  return { call, close: () => child.kill() };
}

test("the MCP server lists its tools and serves the view", async () => {
  const fake = await fakeRuntime();
  const c = client({ SCOUT_RUNTIME_URL: fake.url });
  try {
    const init = await c.call("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.result.serverInfo.name, "scout-boards");
    const { result } = await c.call("tools/list");
    const names = result.tools.map((t) => t.name);
    assert.deepEqual(names, ["work_board", "board_room", "api_read", "api_write"]);
    const uri = result.tools[0]._meta.ui.resourceUri;
    assert.ok(result.tools.filter((t) => t.name.startsWith("api_")).every((t) => t._meta.ui.visibility.includes("app")));
    if (fs.existsSync(path.join(ROOT, "dist", "view", "view.html"))) {
      const view = await c.call("resources/read", { uri });
      assert.equal(view.result.contents[0].mimeType, "text/html;profile=mcp-app");
      assert.doesNotMatch(view.result.contents[0].text, /<script[^>]+src=/, "the view is one file");
    }
    const state = await c.call("tools/call", { name: "api_read", arguments: { path: "/api/state" } });
    assert.equal(state.result.structuredContent.status, 200);
    assert.equal(state.result.structuredContent.body.runtime.up, true);
    // a preview through the view is always a dry run, whatever it asks
    const preview = await c.call("tools/call", { name: "api_read", arguments: { path: "/api/move", preview: { workId: "work-101", to: "ready", dryRun: false } } });
    assert.equal(preview.result.structuredContent.body.applied, false);
    assert.equal(fake.calls.filter((x) => x.path === "/v1/work/move").at(-1).body.dryRun, true);
    const refused = await c.call("tools/call", { name: "api_read", arguments: { path: "/api/claim" } });
    assert.equal(refused.result.isError, true);
  } finally { c.close(); await fake.close(); }
});
