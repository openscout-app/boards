// Scout boards, in two areas like Scout's own app: Conversations (the rooms Scout follows, each with
// its thread and its tasks) and Board (the Kanban of Scout's work). A card that came from a room
// opens that room. When the runtime isn't there, or is too old, or follows no board, the page says
// so and gives the one command that fixes it.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Source } from "./source";
import { useLive } from "./source";
import { Kanban } from "./Kanban";
import { Room, RoomList } from "./Room";
import { Notice } from "./Notice";
import { Kanban as KanbanGlyph, ScoutMark, Thread } from "./icons";
import { prefs } from "./util";
import type { RoomRef } from "./types";

export const SETUP = "npx github:openscout-app/boards setup";

type Pane = "kanban" | "room";
export type Area = "conversations" | "board";
type Toast = { id: number; text: string; tone: "ok" | "warn" };

function useNarrow(px: number) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return narrow;
}

const newest = (rooms: RoomRef[]) => [...rooms].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0];

/** The address says first; a room asked for opens Conversations; else this browser's last choice. */
function initialArea(roomAsked: boolean): Area {
  const asked = new URL(window.location.href).searchParams.get("area");
  if (asked === "conversations" || asked === "board") return asked;
  if (roomAsked) return "conversations";
  return prefs.get("area") === "conversations" ? "conversations" : "board";
}

export function App({ src, initialBoard = "", initialRoom = "", only, actions, embedded }: {
  src: Source; initialBoard?: string; initialRoom?: string;
  /** Show this pane alone, as the view does in a thread. */
  only?: Pane;
  /** Controls the host page adds to the top row. */
  actions?: ReactNode;
  embedded?: boolean;
}) {
  const [boardId, setBoardId] = useState(initialBoard);
  const [roomWant, setRoomWant] = useState(initialRoom || (embedded ? "" : prefs.get("room") || ""));
  const [area, setArea] = useState<Area>(() => (only ? (only === "room" ? "conversations" : "board") : embedded ? (initialRoom ? "conversations" : "board") : initialArea(Boolean(initialRoom))));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const narrow = useNarrow(860);

  // the room shown: the one asked for while the runtime lists it, else the newest
  const live0 = useLive(src, boardId, roomWant);
  const rooms = live0.state?.rooms?.list || [];
  const roomId = useMemo(() => (rooms.some((r) => r.conversationId === roomWant) ? roomWant : newest(rooms)?.conversationId || ""), [rooms, roomWant]);
  useEffect(() => { if (roomId && roomId !== roomWant) setRoomWant(roomId); }, [roomId, roomWant]);
  const { state, unreachable, board, room } = live0;

  const toast = useCallback((text: string, tone: "ok" | "warn" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // the page's address says what it shows, so a reload or a copied link opens the same
  useEffect(() => {
    if (embedded) return;
    const u = new URL(window.location.href);
    u.searchParams.set("area", area);
    if (boardId) u.searchParams.set("board", boardId); else u.searchParams.delete("board");
    if (roomId) u.searchParams.set("room", roomId); else u.searchParams.delete("room");
    window.history.replaceState(null, "", u);
    if (roomId) prefs.set("room", roomId);
  }, [area, boardId, roomId, embedded]);

  const pickArea = (a: Area) => { setArea(a); if (!embedded) prefs.set("area", a); };
  // a card that came from a room opens it, in the Conversations area
  const openRoom = (conversationId: string) => { setRoomWant(conversationId); pickArea("conversations"); };

  let body: ReactNode;
  if (unreachable && !state) {
    body = <Notice title="Scout boards' server isn't answering."><p>Start it again from a terminal on this host:</p><Notice.Command text="npx github:openscout-app/boards" /></Notice>;
  } else if (!state) {
    body = <Notice title="Looking for the runtime" quiet />;
  } else if (!state.runtime.up) {
    body = (
      <Notice title="Scout's runtime isn't running on this host.">
        <p>Boards reads Scout's work from the runtime at {state.runtime.url.replace(/^https?:\/\//, "")}. Set Scout up, or start it, with:</p>
        <Notice.Command text={SETUP} />
        <p className="dim">The page picks the runtime up by itself once it answers.</p>
      </Notice>
    );
  } else if (area === "board") {
    body = (
      <div className="pane solo">
        <Kanban src={src} state={state} read={board} boardId={boardId} onPickBoard={setBoardId} toast={toast} compact={Boolean(only)}
          rooms={rooms} onOpenRoom={only ? undefined : openRoom} />
      </div>
    );
  } else {
    // the room list beside the room on a wide page; on a narrow one, or in a thread, the room's own switcher
    const listed = !only && !narrow && rooms.length > 0;
    const roomPane = <Room state={state} read={room} roomId={roomId} onPickRoom={setRoomWant} switcher={!listed} />;
    body = listed ? (
      <div className="convs">
        <RoomList rooms={rooms} current={roomId} onPick={setRoomWant} />
        <div className="pane">{roomPane}</div>
      </div>
    ) : <div className="pane solo">{roomPane}</div>;
  }

  return (
    <div className={`app${embedded ? " embedded" : ""}`}>
      <header className="top">
        <span className="brand"><ScoutMark /><span>Scout boards</span></span>
        {!only && state?.runtime.up ? (
          <div className="tabs areas" role="tablist" aria-label="Area">
            <button type="button" role="tab" aria-selected={area === "conversations"} onClick={() => pickArea("conversations")}><Thread />Conversations</button>
            <button type="button" role="tab" aria-selected={area === "board"} onClick={() => pickArea("board")}><KanbanGlyph />Board</button>
          </div>
        ) : null}
        <span className="sp" />
        {state ? (
          <span className={`status${state.runtime.up ? " up" : ""}`} title={state.runtime.url}>
            <span className="dot" />{state.runtime.up ? `Runtime${state.runtime.version ? ` ${state.runtime.version}` : ""}` : "No runtime"}
          </span>
        ) : null}
        {actions}
      </header>
      <main className="main">{body}</main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
