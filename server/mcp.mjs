// Scout boards as an MCP server over stdio, for any agent host that runs one. Hosts that draw MCP
// Apps (Claude, Codex, T3 Code, Capy) show the view in the thread: the same page as the browser's,
// in a compact mode, with Expand and a link to the full page. Other hosts get the text.
//
// Tools:
//   work_board  the Kanban, as a view and as text
//   board_room  one Board room's posts and tasks, as a view and as text
//   api_read    the view's reads (the view calls it, not the model)
//   api_write   the view's moves, reviews and claims (the view calls it; hosts ask the person first)
//
// The view's calls run the same routes as the browser's /api, in this process. The model's tools
// also make sure the Scout boards server runs, for the link to the full page.
//
// Plain JSON-RPC over stdio, one message per line; no dependencies.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { READS, WRITES, VERSION, route } from "./api.mjs";
import { boardForModel, describeBoard } from "./board.mjs";
import { describeRoom, pickRoom, roomName } from "./rooms.mjs";
import { ensure } from "./local.mjs";
import { DIST } from "./serve.mjs";

const VIEW_URI = "ui://scout-boards/work-board.html";
const VIEW_FILE = path.join(DIST, "view", "view.html");
const SETUP = "npx github:openscout-app/boards setup";

const TOOLS = [
  {
    name: "work_board",
    title: "Work board",
    description: "Show Scout's work board (Kanban) on this host: the board's columns, with the work items as cards. The person can open a card, move it (the runtime checks each move first), review a move or claim work from the view. Returns the columns and cards as text too. The person sees the view in the thread, so answer in a sentence or two instead of listing it back, and end the reply with the result's `boardsUrl` on its own line when there is one: it opens the Kanban and the Board rooms side by side in a browser.",
    inputSchema: { type: "object", properties: { board: { type: "string", description: "Optional. A board id; without one, the default board." } } },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: VIEW_URI } },
  },
  {
    name: "board_room",
    title: "Board room",
    description: "Show a Vercel Board room that Scout follows on this host: its posts as a conversation, and its tasks as runs. Use it when the person asks for the board's messages, a board room or channel, or what agents posted on the board. Without `room`, shows the room with the newest post. Returns the newest posts and the tasks as text too. The person sees the view in the thread, so answer in a sentence or two instead of listing it back, and end the reply with the result's `boardsUrl` on its own line when there is one.",
    inputSchema: { type: "object", properties: { room: { type: "string", description: "Optional. A channel (scout/work), a board name (General), or both (General scout/work)." } } },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: VIEW_URI } },
  },
  {
    name: "api_read",
    description: "The board view's reads from Scout's runtime. Called by the view, not the model.",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, preview: { type: "object", description: "A move to check without making it." } } },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: VIEW_URI, visibility: ["app"] } },
  },
  {
    name: "api_write",
    description: "The board view's moves, reviews and claims, sent to Scout's runtime. Called by the view, not the model.",
    inputSchema: { type: "object", required: ["method", "path"], properties: { method: { type: "string", enum: ["POST"] }, path: { type: "string" }, body: { type: "object" } } },
    _meta: { ui: { resourceUri: VIEW_URI, visibility: ["app"] } },
  },
];

/** The full page's address, starting the server if it must. Null when it won't start. */
async function boardsUrl(params) {
  try {
    const base = await ensure();
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return `${base}/${q ? `?${q}` : ""}`;
  } catch { return null; }
}

const besideLine = (url) => (url ? ` End the reply with this link on its own line, so they can keep the Kanban and the Board rooms open beside the thread: ${url}` : "");

/** What the model hears when the runtime can't answer: plain, with the one thing to do. */
function unavailable(r) {
  if (r.body?.error === "runtime_down") return `Scout's runtime isn't running on this host. To set it up: ${SETUP}`;
  if (r.body?.error === "boards_unsupported") return "This Scout's runtime is too old to serve boards. Update Scout on this host with `scout update`, then ask again.";
  if (r.body?.error === "rooms_unsupported") return "This Scout's runtime has no Vercel Board adapter. Update Scout on this host with `scout update`.";
  return r.body?.message || `Scout's runtime answered ${r.status}.`;
}

async function callTool(name, args = {}) {
  if (name === "work_board") {
    const r = await route("GET", "/api/board", new URLSearchParams(args.board ? { id: String(args.board) } : {}));
    const url = await boardsUrl({ board: r.body?.board?.id || args.board });
    if (r.status !== 200) {
      const text = unavailable(r);
      return { content: [{ type: "text", text }], structuredContent: { kind: "work-board", boardsUrl: url, note: text } };
    }
    if (!r.body.board) {
      const text = "The runtime serves no board yet.";
      return { content: [{ type: "text", text }], structuredContent: { kind: "work-board", boardsUrl: url, note: text } };
    }
    const board = boardForModel(r.body);
    const note = `The person sees this board in the thread. Don't list its columns or cards back; answer what they asked in a sentence or two.${besideLine(url)}`;
    return {
      content: [{ type: "text", text: `${describeBoard(board)}\n\n${note}` }],
      structuredContent: { kind: "work-board", boardId: r.body.board.id, boardsUrl: url, note, board },
    };
  }
  if (name === "board_room") {
    const list = await route("GET", "/api/rooms");
    const url0 = () => boardsUrl({});
    if (list.status !== 200) {
      const text = unavailable(list);
      return { content: [{ type: "text", text }], structuredContent: { kind: "board-room", boardsUrl: await url0(), note: text, rooms: [] } };
    }
    const rooms = list.body.rooms;
    if (!rooms.length) {
      const text = "Scout doesn't follow a Vercel Board room on this host yet. Connect one with `scout integration connect vercel-board --team <team> --credential <ref>` (see `scout integration vercel-board --help`).";
      return { content: [{ type: "text", text }], structuredContent: { kind: "board-room", boardsUrl: await url0(), note: text, rooms } };
    }
    const chosen = pickRoom(rooms, args.room);
    if (!chosen) {
      const text = `No Board room matches "${String(args.room)}". The rooms: ${rooms.map(roomName).join(", ")}.`;
      return { content: [{ type: "text", text }], isError: true };
    }
    const r = await route("GET", "/api/room", new URLSearchParams({ conversationId: chosen.conversationId }));
    if (r.status !== 200) return { content: [{ type: "text", text: unavailable(r) }], isError: true };
    const url = await boardsUrl({ room: chosen.conversationId });
    const note = `The person sees this room in the thread, with a switcher for the other rooms. Don't list its posts back; answer what they asked in a sentence or two.${besideLine(url)}`;
    const others = rooms.filter((x) => x.conversationId !== chosen.conversationId);
    return {
      content: [{ type: "text", text: `${describeRoom(chosen, r.body, others)}\n\n${note}` }],
      structuredContent: { kind: "board-room", conversationId: chosen.conversationId, boardsUrl: url, note, rooms },
    };
  }
  if (name === "api_read") {
    const u = new URL(String(args.path || ""), "http://local");
    if (args.preview !== undefined) {
      // what a move would do, recording nothing: the dry run is set here, whatever the view sent
      if (u.pathname !== "/api/move" || typeof args.preview !== "object" || args.preview === null) throw new Error(`The board doesn't preview ${String(args.path)}.`);
      return asResult(await route("POST", "/api/move", u.searchParams, { ...args.preview, dryRun: true }));
    }
    if (!READS.includes(u.pathname)) throw new Error(`The board doesn't read ${String(args.path)}.`);
    return asResult(await route("GET", u.pathname, u.searchParams));
  }
  if (name === "api_write") {
    const u = new URL(String(args.path || ""), "http://local");
    if (args.method !== "POST" || !WRITES.includes(u.pathname)) throw new Error(`The board doesn't send ${String(args.method)} ${String(args.path)}.`);
    return asResult(await route("POST", u.pathname, u.searchParams, args.body && typeof args.body === "object" ? args.body : {}));
  }
  throw new Error(`There is no tool ${name}.`);
}

/** A route's answer as a tool result: the view reads `status` and `body` from it. */
const asResult = (r) => ({ content: [{ type: "text", text: JSON.stringify(r.body) }], structuredContent: { status: r.status, body: r.body } });

const out = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

export function serveMcp() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return; // a notification
    try {
      switch (m.method) {
        case "initialize":
          return out({ id: m.id, result: {
            protocolVersion: m.params?.protocolVersion || "2025-06-18",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "scout-boards", version: VERSION },
            instructions: "Scout boards shows the person Scout's boards on this host, in the thread. `work_board` is the Kanban: call it when they ask to see the board, the Kanban or the work board, what work is in flight, or what is waiting on review. `board_room` is a Vercel Board room's posts and tasks: call it when they ask for the board's messages, a board room or channel, or what agents posted.",
          } });
        case "ping":
          return out({ id: m.id, result: {} });
        case "tools/list":
          return out({ id: m.id, result: { tools: TOOLS } });
        case "resources/list":
          return out({ id: m.id, result: { resources: [{ uri: VIEW_URI, name: "Scout boards", mimeType: "text/html;profile=mcp-app" }] } });
        case "resources/read": {
          if (m.params?.uri !== VIEW_URI) return out({ id: m.id, error: { code: -32002, message: `no resource ${m.params?.uri}` } });
          let text;
          try { text = fs.readFileSync(VIEW_FILE, "utf8"); } catch { return out({ id: m.id, error: { code: -32603, message: "The view isn't built. Run `npm run build` in Scout boards." } }); }
          return out({ id: m.id, result: { contents: [{ uri: VIEW_URI, mimeType: "text/html;profile=mcp-app", text }] } });
        }
        case "tools/call":
          try {
            return out({ id: m.id, result: await callTool(m.params?.name, m.params?.arguments) });
          } catch (e) {
            return out({ id: m.id, result: { content: [{ type: "text", text: String(e?.message || e) }], isError: true } });
          }
        default:
          return out({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
      }
    } catch (e) {
      out({ id: m.id, error: { code: -32603, message: String(e?.message || e) } });
    }
  });
}
