// Finding the Scout boards server that runs on this host, and starting one when none does.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIRST_PORT = 4802;
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "boards.mjs");

/** Is Scout boards answering on this port? It says so at /api/hello. */
export async function ours(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/hello`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.json()).app === "scout-boards";
  } catch { return false; }
}

/** Listen on the first free port from `first`, or find Scout boards already on one of them and
 * reuse it. Something else on a port moves Boards to the next one, unless the port was asked for. */
export async function start({ first = FIRST_PORT, strict = false, serve, tries = 10 }) {
  for (let port = first; port < first + tries; port++) {
    try {
      const server = await serve(port);
      return { url: `http://localhost:${port}`, port, reused: false, server };
    } catch (e) {
      if (e.code !== "EADDRINUSE") throw e;
      if (await ours(port)) return { url: `http://localhost:${port}`, port, reused: true, server: null };
      if (strict) throw new Error(`port ${port} is taken. Try another --port.`);
    }
  }
  throw new Error(`ports ${first} to ${first + tries - 1} are all taken. Use --port <n>.`);
}

/** The port Scout boards answers on, or 0. */
export async function running(first = FIRST_PORT) {
  for (let p = first; p < first + 10; p++) if (await ours(p)) return p;
  return 0;
}

/** The base URL of a running Scout boards, starting one in the background if it must. */
export async function ensure() {
  let port = await running();
  if (port) return `http://localhost:${port}`;
  const child = spawn(process.execPath, [BIN, "--no-open"], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 40 && !port; i++) { await new Promise((r) => setTimeout(r, 250)); port = await running(); }
  if (!port) throw new Error("Scout boards didn't start. Run `npx github:openscout-app/boards` to see why.");
  return `http://localhost:${port}`;
}
