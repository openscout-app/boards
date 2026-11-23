import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrame, runtimeUrl } from "./runtime.mjs";

const home = (config) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boards-home-"));
  if (config) fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
  return dir;
};

test("the runtime address in the environment wins", () => {
  assert.equal(runtimeUrl({ SCOUT_RUNTIME_URL: "http://127.0.0.1:5000/", OPENSCOUT_BROKER_URL: "http://127.0.0.1:6000" }), "http://127.0.0.1:5000");
  assert.equal(runtimeUrl({ OPENSCOUT_BROKER_URL: "http://127.0.0.1:6000" }), "http://127.0.0.1:6000");
});

test("then the runtime port in Scout's config", () => {
  assert.equal(runtimeUrl({ OPENSCOUT_HOME: home({ ports: { broker: 43555 } }) }), "http://127.0.0.1:43555");
  assert.equal(runtimeUrl({ OPENSCOUT_HOME: home({ host: "0.0.0.0", ports: { broker: 43556 } }) }), "http://127.0.0.1:43556");
});

test("then the default port", () => {
  assert.equal(runtimeUrl({ OPENSCOUT_HOME: home(null) }), "http://127.0.0.1:43110");
  assert.equal(runtimeUrl({ OPENSCOUT_HOME: home({ ports: { broker: "no" } }) }), "http://127.0.0.1:43110");
});

test("a server-sent event parses to its name and data", () => {
  assert.deepEqual(parseFrame("event: flight.updated\ndata: {\"id\":\"f1\"}"), { event: "flight.updated", data: { id: "f1" } });
  assert.deepEqual(parseFrame("data: plain"), { event: "message", data: "plain" });
  assert.equal(parseFrame(": keepalive"), null);
});
