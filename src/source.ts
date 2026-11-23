// Where the page's data comes from. In a browser, the Scout boards server: reads and writes over
// /api, and pushes over /api/events, with polling while the stream is down. Inside an agent's
// thread (the MCP App view), the same routes through the host's tool calls, polled.
import { useEffect, useState } from "react";
import type { Answer, Board, MoveResponse, Read, Room, State } from "./types";
import { callTool } from "./mcp";

export interface Source {
  get<T>(path: string): Promise<Answer<T>>;
  post<T>(path: string, body: Record<string, unknown>): Promise<Answer<T>>;
  /** What a move would do, recording nothing. */
  preview(body: Record<string, unknown>): Promise<Answer<MoveResponse>>;
  watch(keys: { board: string; room: string }, on: (kind: string, data: unknown) => void): () => void;
}

const POLL = 5e3;

/** Poll the three reads the stream would push, in the stream's shapes. */
function poller(src: Pick<Source, "get">, keys: { board: string; room: string }, on: (kind: string, data: unknown) => void, every: number) {
  let stop = false, timer = 0, first = true;
  const asRead = <T,>(key: string, a: Answer<T>): Read<T> => (a.status === 200
    ? { key, ok: true, data: a.body }
    : { key, ok: false, error: a.body?.error || "failed", message: a.body?.message || "", status: a.status });
  const tick = async () => {
    if (stop) return;
    // a hidden page skips its polls, after the first: it still opens with data
    if (first || document.visibilityState !== "hidden") {
      first = false;
      try {
        const s = await src.get<State>("/api/state");
        if (stop) return;
        on(s.status === 200 ? "state" : "unreachable", s.body);
        if (s.status === 200 && s.body.runtime.up) {
          const reads: Promise<void>[] = [];
          if (s.body.boards?.supported) reads.push(src.get<Board>(`/api/board${keys.board ? `?id=${encodeURIComponent(keys.board)}` : ""}`).then((a) => { if (!stop) on("board", asRead(keys.board, a)); }));
          if (s.body.rooms?.supported && keys.room) reads.push(src.get<Room>(`/api/room?conversationId=${encodeURIComponent(keys.room)}`).then((a) => { if (!stop) on("room", asRead(keys.room, a)); }));
          await Promise.all(reads);
        }
      } catch { if (!stop) on("unreachable", null); }
    }
    if (!stop) timer = window.setTimeout(tick, every);
  };
  void tick();
  return () => { stop = true; clearTimeout(timer); };
}

async function http<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  try {
    const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: { error: "server_down", message: "Scout boards' server isn't answering." } as unknown as Answer<T>["body"] };
  }
}

export const httpSource: Source = {
  get: (path) => http("GET", path),
  post: (path, body) => http("POST", path, body),
  preview: (body) => http("POST", "/api/move", { ...body, dryRun: true }),
  watch(keys, on) {
    const q = new URLSearchParams({ board: keys.board, room: keys.room }).toString();
    const es = new EventSource(`/api/events?${q}`);
    let polling: (() => void) | null = null;
    for (const kind of ["state", "board", "room"]) es.addEventListener(kind, (e) => on(kind, JSON.parse((e as MessageEvent).data)));
    es.onopen = () => { polling?.(); polling = null; };
    // the stream reconnects by itself; while it is down, poll so the page stays current
    es.onerror = () => { if (!polling) polling = poller(httpSource, keys, on, POLL); };
    return () => { es.close(); polling?.(); };
  },
};

/** The view's source: each call is a tool call through the host. */
export const mcpSource: Source = {
  get: (path) => toolAnswer("api_read", { path }),
  post: (path, body) => toolAnswer("api_write", { method: "POST", path, body }),
  preview: (body) => toolAnswer("api_read", { path: "/api/move", preview: body }),
  watch(keys, on) { return poller(mcpSource, keys, on, 8e3); },
};
async function toolAnswer<T>(name: string, args: Record<string, unknown>): Promise<Answer<T>> {
  try {
    return unwrap(await callTool(name, args));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The host refused the request.";
    return { status: 0, body: { error: "host_request_failed", message } as Answer<T>["body"] };
  }
}
function unwrap<T>(r: { structuredContent?: Record<string, unknown>; isError?: boolean; content?: Array<{ text?: string }> }): Answer<T> {
  const s = r.structuredContent as { status?: number; body?: T } | undefined;
  if (s && typeof s.status === "number") return { status: s.status, body: (s.body ?? {}) as Answer<T>["body"] };
  return { status: 500, body: { error: "failed", message: r.content?.[0]?.text || "The host couldn't reach Scout boards." } as Answer<T>["body"] };
}

/** The state, the board and the room, kept current. A switch of board or room keeps the old data
 * on screen until the new read lands. */
export function useLive(src: Source, board: string, room: string) {
  const [state, setState] = useState<State | null>(null);
  const [boardRead, setBoard] = useState<Read<Board> | null>(null);
  const [roomRead, setRoom] = useState<Read<Room> | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => src.watch({ board, room }, (kind, data) => {
    if (kind === "unreachable") return setUnreachable(true);
    if (kind === "state") { setUnreachable(false); setState(data as State); }
    else if (kind === "board") setBoard(data as Read<Board>);
    else if (kind === "room") setRoom(data as Read<Room>);
  }), [src, board, room]);
  return { state, unreachable, board: boardRead, room: roomRead };
}
