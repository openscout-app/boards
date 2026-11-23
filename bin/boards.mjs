#!/usr/bin/env node
// npx github:openscout-app/boards [--port 4802] [--no-open]    start Scout boards and open it
// npx github:openscout-app/boards setup                       start Scout's runtime, give Claude Code the tools
// npx github:openscout-app/boards mcp                         the tools themselves (agent hosts run this)
//
// Starting: if Scout boards already runs on the port, it opens that one; if something else holds
// the port, it takes the next free one.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const BIN = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(BIN), "..");
// how people run it: straight from the open repository on GitHub
const SPEC = "github:openscout-app/boards";
const HELP = `Usage:
  scout-boards [--port <n>] [--no-open]
      Show Scout's work as a Kanban, beside the Vercel Board rooms Scout follows, at
      http://localhost:4802. Everything comes from Scout's runtime on this host.

  scout-boards setup [--print] [--no-scout]
      Start Scout's runtime if it isn't up (scout setup; Scout comes with Scout boards, and its
      runtime runs on Bun). Then give every Claude Code session the board tools (work_board,
      board_room), and add \`scout boards\` to Scout's CLI. --print shows the commands instead;
      --no-scout leaves Scout's runtime alone.

  scout-boards mcp
      The tools, as an MCP server over stdio. Agent hosts run this; you don't need to.`;
if (args.includes("--help") || args.includes("-h")) { console.log(HELP); process.exit(0); }
const fail = (m) => { console.error(`scout-boards: ${m}`); process.exit(1); };

/** Scout's runtime holds the board. Scout boards brings Scout's CLI; its runtime runs on Bun. Start it
 * if it isn't up. */
async function setupScout() {
  const { findScout, findBun } = await import("../server/paths.mjs");
  const { health } = await import("../server/runtime.mjs");
  const h = await health();
  if (h.up) { console.log(`Scout's runtime is up at ${h.url}.`); return; }
  const bun = findBun(), scout = findScout();
  if (!bun) {
    console.log("Scout's runtime holds the board. It runs on Bun, which isn't on this host.\n" +
      "Install Bun (curl -fsSL https://bun.sh/install | bash), then run this again.\n");
    return;
  }
  if (!scout) { console.log("Scout's CLI didn't come with Scout boards. Reinstall, or see https://openscout.app/install.md.\n"); return; }
  console.log("Starting Scout: scout setup");
  const env = { ...process.env, PATH: `${path.dirname(bun)}:${process.env.PATH || ""}` };
  try { execFileSync(scout, ["setup"], { stdio: "inherit", env }); console.log(""); } catch {
    console.log("scout setup didn't finish. Run scout doctor to see why.\n");
  }
}

/** `scout boards`, through Scout's CLI extensions. The artifact runs Scout boards from GitHub, so it
 * keeps working wherever this copy goes. */
async function setupExtension(print) {
  const { findScout } = await import("../server/paths.mjs");
  const scout = findScout();
  const dir = path.join(ROOT, "extension");
  const shown = `scout extensions install boards ${JSON.stringify(dir)}`;
  if (print) { console.log(shown); return; }
  if (!scout) { console.log(`Scout's CLI isn't here, so \`scout boards\` waits. Later: ${shown}`); return; }
  let has = false;
  try { has = JSON.parse(execFileSync(scout, ["extensions", "--json"], { encoding: "utf8" })).extensions?.some((e) => e.name === "boards"); } catch {}
  if (has) { console.log("Scout's CLI already has `scout boards`."); return; }
  try { execFileSync(scout, ["extensions", "install", "boards", dir], { stdio: "ignore" }); console.log("Added `scout boards` to Scout's CLI."); } catch {
    console.log(`Scout's CLI didn't take \`scout boards\`. To try by hand: ${shown}`);
  }
}

// An agent host that runs this with no command speaks MCP on pipes: the plugin's first manifests
// ran the package bare. A person at a terminal gets the page.
const bareOnPipes = args.length === 0 && !process.stdin.isTTY && !process.stdout.isTTY;

if (args[0] === "mcp" || bareOnPipes) {
  const { serveMcp } = await import("../server/mcp.mjs");
  serveMcp();
} else if (args[0] === "setup" || args[0] === "init") {
  // from npx the package sits in a cache that can go away, so name the package, not the path
  const viaNpx = BIN.includes(`${path.sep}_npx${path.sep}`);
  const run = viaNpx ? ["npx", "-y", SPEC, "mcp"] : [process.execPath, BIN, "mcp"];
  const add = ["mcp", "add", "--scope", "user", "scout-boards", "--", ...run];
  const shown = `claude ${add.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`;
  if (args.includes("--print")) { console.log(shown); await setupExtension(true); process.exit(0); }
  if (!args.includes("--no-scout")) await setupScout();
  await setupExtension(false);
  let has = false;
  try { execFileSync("claude", ["mcp", "get", "scout-boards"], { stdio: "ignore" }); has = true; } catch (e) {
    if (e.code === "ENOENT") fail(`the claude command isn't on PATH. Run this where it is:\n  ${shown}`);
  }
  if (has) {
    console.log("Claude Code already has the board tools. To set them up again: claude mcp remove --scope user scout-boards, then this again.");
    process.exit(0);
  }
  try { execFileSync("claude", add, { stdio: "inherit" }); } catch { fail(`that didn't work. The command was:\n  ${shown}`); }
  console.log("\nDone. New Claude Code sessions have work_board and board_room. Sessions already open get them after /mcp or a restart.");
} else if (args[0] && !args[0].startsWith("-")) {
  fail(`no command ${args[0]}. See --help.`);
} else {
  const { serve } = await import("../server/serve.mjs");
  const { start, FIRST_PORT } = await import("../server/local.mjs");
  const asked = Number(opt("--port") ?? process.env.PORT) || 0;
  const open = !args.includes("--no-open");
  if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) fail("the page isn't built. Run `npm run build` first.");
  try {
    const { url, reused } = await start({ first: asked || FIRST_PORT, strict: Boolean(asked), serve });
    console.log(reused ? `Scout boards is already running at ${url}` : `Scout boards is at ${url}`);
    if (open) execFile("open", [url], () => {});
    if (reused) process.exit(0);
  } catch (e) { fail(e.message); }
}
