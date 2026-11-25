import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Source } from "./source";
import { useLive } from "./source";
import { Kanban } from "./Kanban";
import { LocalActivityBoard } from "./LocalActivityBoard";
import { Room, RoomList } from "./Room";
import { Notice } from "./Notice";
import { Kanban as KanbanGlyph, ScoutMark, Thread } from "./icons";
import { prefs } from "./util";
import type { RoomRef } from "./types";

const SETUP = "npx openscout-app/boards setup";

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

export function initialArea(roomAsked: boolean): Area {
  const asked = new URL(window.location.href).searchParams.get("area");
  if (asked === "conversations" || asked === "board") return asked;
  if (roomAsked) return "conversations";
  return prefs.get("area") === "conversations" ? "conversations" : "board";
}

export function App({
  src,
  initialBoard = "",
  initialRoom = "",
  only,
  actions,
  embedded,
  area: controlledArea,
  onAreaChange,
  onOpenSession,
  onOpenExchange,
}: {
  src: Source;
  initialBoard?: string;
  initialRoom?: string;
  only?: Pane;
  actions?: ReactNode;
  embedded?: boolean;
  area?: Area;
  onAreaChange?: (area: Area) => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenExchange?: (conversationId: string, workId: string) => void;
}) {
  const [boardId, setBoardId] = useState(initialBoard);
  const [roomWant, setRoomWant] = useState(initialRoom || (embedded ? "" : prefs.get("room") || ""));
  const [internalArea, setInternalArea] = useState<Area>(() =>
    only ? (only === "room" ? "conversations" : "board") : embedded ? (initialRoom ? "conversations" : "board") : initialArea(Boolean(initialRoom)),
  );
  const area = controlledArea ?? internalArea;

  const [toasts, setToasts] = useState<Toast[]>([]);
  const narrow = useNarrow(860);

  const live0 = useLive(src, boardId, roomWant);
  const rooms = live0.state?.rooms?.list || [];
  const roomId = useMemo(
    () => (rooms.some((r) => r.conversationId === roomWant) ? roomWant : newest(rooms)?.conversationId || ""),
    [rooms, roomWant],
  );
  useEffect(() => {
    if (roomId && roomId !== roomWant) setRoomWant(roomId);
  }, [roomId, roomWant]);

  const { state, unreachable, board, room } = live0;
  const resolvedBoardId = board?.ok && board.key === boardId ? board.data.board?.id : undefined;
  useEffect(() => {
    if (boardId && resolvedBoardId && resolvedBoardId !== boardId) setBoardId(resolvedBoardId);
  }, [boardId, resolvedBoardId]);

  const toast = useCallback((text: string, tone: "ok" | "warn" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  useEffect(() => {
    if (embedded) return;
    if (window.location.pathname.startsWith("/sessions/") || window.location.pathname.startsWith("/c/")) return;
    const u = new URL(window.location.href);
    u.searchParams.set("area", area);
    if (boardId) u.searchParams.set("board", boardId);
    else u.searchParams.delete("board");
    if (roomId) u.searchParams.set("room", roomId);
    else u.searchParams.delete("room");
    window.history.replaceState(null, "", u);
    if (roomId) prefs.set("room", roomId);
  }, [area, boardId, roomId, embedded]);

  const pickArea = (a: Area) => {
    if (onAreaChange) onAreaChange(a);
    else setInternalArea(a);
    if (!embedded) prefs.set("area", a);
  };

  const openRoom = (conversationId: string) => {
    setRoomWant(conversationId);
    pickArea("conversations");
  };

  let body: ReactNode;
  if (unreachable && !state) {
    body = (
      <Notice title="Scout Boards server isn't answering.">
        <p>Start it again from a terminal on this host:</p>
        <Notice.Command text="npx openscout-app/boards" />
      </Notice>
    );
  } else if (!state) {
    body = <Notice title="Reading board state…" quiet />;
  } else if (!state.runtime.up) {
    body = embedded ? (
      <Notice title="Scout's runtime isn't running on this host." colophon>
        <p>Boards reads work from {state.runtime.url.replace(/^https?:\/\//, "")}. Run this command in a terminal to set up or start Scout.</p>
        <Notice.Command text={SETUP} />
      </Notice>
    ) : (
      <div className="pane solo">
        <LocalActivityBoard onOpenSession={onOpenSession} />
      </div>
    );
  } else if (area === "board") {
    body = (
      <div className="pane solo">
        <Kanban
          src={src}
          state={state}
          read={board}
          boardId={boardId}
          onPickBoard={setBoardId}
          toast={toast}
          compact={Boolean(only)}
          rooms={rooms}
          onOpenRoom={only ? undefined : openRoom}
          onOpenSession={onOpenSession}
          onOpenExchange={onOpenExchange}
        />
      </div>
    );
  } else {
    const listed = !only && !narrow && rooms.length > 0;
    const roomPane = <Room state={state} read={room} roomId={roomId} onPickRoom={setRoomWant} switcher={!listed} />;
    body = listed ? (
      <div className="convs">
        <RoomList rooms={rooms} current={roomId} onPick={setRoomWant} />
        <div className="pane">{roomPane}</div>
      </div>
    ) : (
      <div className="pane solo">{roomPane}</div>
    );
  }

  if (!embedded) {
    return (
      <div className="boards-standalone-surface">
        <main
          className="main"
          data-scout-content=""
          data-scout-point={area === "board" ? boardId || "board" : roomId || "conversations"}
          data-scout-label={area === "board" ? "Work board" : "Board conversations"}
        >
          {body}
        </main>
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone}`}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app embedded">
      <header className="top">
        <span className="brand">
          <ScoutMark />
          <span>Scout Boards</span>
        </span>
        {!only && state?.runtime.up ? (
          <div className="tabs areas" role="tablist" aria-label="Area">
            <button type="button" role="tab" aria-selected={area === "conversations"} onClick={() => pickArea("conversations")}>
              <Thread />
              Conversations
            </button>
            <button type="button" role="tab" aria-selected={area === "board"} onClick={() => pickArea("board")}>
              <KanbanGlyph />
              Board
            </button>
          </div>
        ) : null}
        <span className="sp" />
        {state ? (
          <span role="status" className={`status${!unreachable && state.runtime.up ? " up" : ""}`} title={state.runtime.url}>
            <span className="dot" />
            {unreachable ? "Disconnected" : state.runtime.up ? `Runtime${state.runtime.version ? ` ${state.runtime.version}` : ""}` : "No runtime"}
          </span>
        ) : null}
        {actions}
      </header>
      <main className="main">{body}</main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
