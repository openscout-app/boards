// Scout boards: the Kanban on the left, the Board room on the right, one seam between them. A
// narrow window shows one pane at a time, with a switch. When the runtime isn't there, or is too
// old, or follows no board, the page says so and gives the one command that fixes it.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Source } from "./source";
import { useLive } from "./source";
import { Kanban } from "./Kanban";
import { Room } from "./Room";
import { Notice } from "./Notice";
import { Kanban as KanbanGlyph, ScoutMark, Thread } from "./icons";
import { prefs } from "./util";
import type { RoomRef } from "./types";

export const SETUP = "npx github:openscout-app/boards setup";

type Pane = "kanban" | "room";
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

/** The left pane's share of the width, kept in this browser, dragged on the seam. */
function useSplit() {
  const [share, setShare] = useState(() => {
    const v = Number(prefs.get("split"));
    return v >= 0.25 && v <= 0.8 ? v : 0.62;
  });
  const box = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const seam = e.currentTarget as HTMLElement;
    seam.setPointerCapture(e.pointerId);
    let last = share;
    const move = (ev: PointerEvent) => { last = Math.min(0.8, Math.max(0.25, (ev.clientX - rect.left) / rect.width)); setShare(last); };
    const up = () => { seam.removeEventListener("pointermove", move); seam.removeEventListener("pointerup", up); prefs.set("split", String(last)); };
    seam.addEventListener("pointermove", move);
    seam.addEventListener("pointerup", up);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -0.02 : e.key === "ArrowRight" ? 0.02 : 0;
    if (!step) return;
    e.preventDefault();
    const v = Math.min(0.8, Math.max(0.25, share + step));
    setShare(v);
    prefs.set("split", String(v));
  };
  return { share, box, drag, key };
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
  const [pane, setPane] = useState<Pane>(only || (prefs.get("pane") as Pane) || "kanban");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const narrow = useNarrow(860);
  const split = useSplit();

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
    if (boardId) u.searchParams.set("board", boardId); else u.searchParams.delete("board");
    if (roomId) u.searchParams.set("room", roomId); else u.searchParams.delete("room");
    window.history.replaceState(null, "", u);
    if (roomId) prefs.set("room", roomId);
  }, [boardId, roomId, embedded]);

  const pickPane = (p: Pane) => { setPane(p); prefs.set("pane", p); };

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
  } else {
    const kanban = <Kanban src={src} state={state} read={board} boardId={boardId} onPickBoard={setBoardId} toast={toast} compact={Boolean(only)} />;
    const roomPane = <Room state={state} read={room} roomId={roomId} onPickRoom={setRoomWant} />;
    if (only) body = <div className="pane solo">{only === "kanban" ? kanban : roomPane}</div>;
    else if (narrow) body = <div className="pane solo">{pane === "kanban" ? kanban : roomPane}</div>;
    else body = (
      <div className="split" ref={split.box} style={{ gridTemplateColumns: `${split.share}fr 1px ${1 - split.share}fr` }}>
        <div className="pane">{kanban}</div>
        <div className="seam" role="separator" aria-orientation="vertical" aria-label="Resize the panes" tabIndex={0}
          aria-valuenow={Math.round(split.share * 100)} aria-valuemin={25} aria-valuemax={80}
          onPointerDown={split.drag} onKeyDown={split.key} />
        <div className="pane">{roomPane}</div>
      </div>
    );
  }

  const showSwitch = !only && narrow && state?.runtime.up;
  return (
    <div className={`app${embedded ? " embedded" : ""}`}>
      <header className="top">
        <span className="brand"><ScoutMark /><span>Scout boards</span></span>
        {showSwitch ? (
          <div className="tabs" role="tablist" aria-label="Pane">
            <button type="button" role="tab" aria-selected={pane === "kanban"} onClick={() => pickPane("kanban")}><KanbanGlyph />Kanban</button>
            <button type="button" role="tab" aria-selected={pane === "room"} onClick={() => pickPane("room")}><Thread />Board room</button>
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
