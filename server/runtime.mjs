// Scout's runtime, underneath Boards. Boards talks to nothing else: the Kanban comes from
// /v1/boards, Board rooms from the Vercel Board adapter's routes, and moves, reviews and claims go
// to /v1/work/*, where the runtime checks them and records them. Boards writes no record itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where the runtime answers, found the way Scout's own tools find it: an address in the
 * environment first, then the host's Scout config, then the default port. */
export function runtimeUrl(env = process.env) {
  const given = env.SCOUT_RUNTIME_URL || env.OPENSCOUT_BROKER_URL;
  if (given) return given.replace(/\/+$/, "");
  try {
    const home = env.OPENSCOUT_HOME || path.join(os.homedir(), ".openscout");
    const c = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
    const port = Number(c?.ports?.broker);
    if (Number.isInteger(port) && port > 0) {
      const host = !c.host || c.host === "0.0.0.0" || c.host === "::" ? "127.0.0.1" : c.host;
      return `http://${host}:${port}`;
    }
  } catch {}
  return "http://127.0.0.1:43110";
}

/** The runtime didn't answer at all: not running on this host, or not at this address. */
export class RuntimeDown extends Error {
  constructor(url) { super(`Scout's runtime isn't answering at ${url}.`); this.code = "runtime_down"; }
}

/** The runtime answered with an error status. `body` is what it said, when it said it as JSON. */
export class RuntimeError extends Error {
  constructor(status, body, p) {
    super((body && (body.message || body.error)) || `${p} answered ${status}`);
    this.status = status;
    this.body = body;
    this.code = body?.error || `http_${status}`;
  }
}

/** One call to the runtime. Resolves with its JSON; throws RuntimeDown or RuntimeError. */
export async function rt(p, { method = "GET", body, ms = 6e3 } = {}) {
  const base = runtimeUrl();
  let res;
  try {
    res = await fetch(base + p, {
      method,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  } catch { throw new RuntimeDown(base); }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new RuntimeError(res.status, json, p);
  return json;
}

/** Is a runtime answering, and which build. Never throws. */
export async function health() {
  try {
    const h = await rt("/health", { ms: 2500 });
    return { up: true, url: runtimeUrl(), version: h?.build?.version || null };
  } catch (e) {
    // a runtime old enough to have no /health still answers, which is what matters here
    if (e instanceof RuntimeError) return { up: true, url: runtimeUrl(), version: null };
    return { up: false, url: runtimeUrl(), version: null };
  }
}

// ---- the runtime's event stream, relayed: one connection, however many pages listen

const listeners = new Set();
let streaming = null; // the AbortController of the open stream
let connected = false;

/** Call fn(kind, event) for each runtime event. Opens the stream with the first listener and closes
 * it with the last. */
export function onRuntimeEvents(fn) {
  listeners.add(fn);
  if (!streaming) follow(0);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && streaming) { streaming.abort(); streaming = null; connected = false; }
  };
}
export const streamConnected = () => connected;

async function follow(failures) {
  const ctl = new AbortController();
  streaming = ctl;
  let opened = false;
  try {
    const res = await fetch(`${runtimeUrl()}/v1/events/stream`, { headers: { accept: "text/event-stream" }, signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error(String(res.status));
    opened = connected = true;
    for (const fn of listeners) fn("stream.open", null);
    const text = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += text.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = parseFrame(buf.slice(0, i));
        buf = buf.slice(i + 2);
        if (frame) for (const fn of listeners) fn(frame.event, frame.data);
      }
    }
  } catch {}
  connected = false;
  if (streaming !== ctl) return; // closed on purpose
  for (const fn of listeners) fn("stream.closed", null);
  // the runtime ended the stream or isn't answering: try again, less often the longer it stays away
  const n = opened ? 1 : failures + 1;
  setTimeout(() => { if (streaming === ctl) follow(n); }, Math.min(30e3, 1e3 * 2 ** Math.min(n, 5)));
}

/** One server-sent event: its name and its data, parsed as JSON when it is JSON. */
export function parseFrame(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length && event === "message") return null;
  const raw = data.join("\n");
  try { return { event, data: raw ? JSON.parse(raw) : null }; } catch { return { event, data: raw }; }
}
