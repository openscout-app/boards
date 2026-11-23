// Where Scout's command and Bun are, for `setup`. Boards keeps no files of its own: the board,
// the rooms and every move live in Scout's runtime.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

/** The scout command (Scout's CLI, @openscout/scout). A Scout you installed yourself comes first, on
 * PATH or where Bun puts global packages; else the one Scout boards depends on. */
export function findScout() {
  if (process.env.SCOUT_BIN) return process.env.SCOUT_BIN;
  return onPath("scout") || bundledScout();
}
function bundledScout() {
  try { return path.join(path.dirname(createRequire(import.meta.url).resolve("@openscout/scout/package.json")), "bin", "scout"); } catch { return null; }
}
/** Where Bun is, for Scout's runtime, which runs on it */
export function findBun() {
  return (process.env.BUN_INSTALL && exe(path.join(process.env.BUN_INSTALL, "bin", "bun"))) || onPath("bun");
}
const exe = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { return null; } };
function onPath(name) {
  const dirs = [...(process.env.PATH || "").split(":"), path.join(os.homedir(), ".bun", "bin"), path.join(os.homedir(), ".local", "bin")];
  for (const d of dirs) {
    if (!d) continue;
    const p = exe(path.join(d, name));
    if (p) return p;
  }
  return null;
}
