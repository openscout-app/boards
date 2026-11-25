// The Kanban: the board's columns as lanes on hairlines, its work items as cards. A card opens a
// detail panel; it moves from its menu or by dragging it to a column, and every move is shown as
// the runtime decides it (a dry run) before it is made.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { Board, Card, Column, Read, RoomRef, State } from "./types";
import type { Source } from "./source";
import { ago, harnessMark, initials, label, ownerOf, trackerOf } from "./util";
import { More, Close, Thread } from "./icons";
import { CardPanel, MoveDialog } from "./CardPanel";
import { Notice } from "./Notice";
import { cardsWithColumnPage, targetsOf } from "./board";

const RUN_STATES = new Set(["running", "working", "active", "queued", "waking", "starting"]);

function CardView({ card, selected, onOpen, onMenu, menuOpen, draggable, room, onOpenRoom }: {
  card: Card; selected: boolean; onOpen: () => void; onMenu: () => void; menuOpen: boolean; draggable: boolean;
  /** The room this card came from, when Scout follows it. */
  room?: RoomRef | null; onOpenRoom?: (conversationId: string) => void;
}) {
  const at = card.lastMeaningfulAt ?? card.updatedAt ?? card.createdAt;
  const run = card.activeFlight;
  const owner = ownerOf(card);
  const mark = harnessMark(run?.harness);
  // a card an outside tracker places moves there, not here
  const tracker = trackerOf(card);
  return (
    <div
      className={`card${selected ? " selected" : ""}`}
      role="button" tabIndex={0} aria-label={card.title}
      title={tracker ? `Moves on ${tracker}` : undefined}
      draggable={draggable && !tracker}
      onDragStart={(e) => { e.dataTransfer.setData("text/x-scout-work", card.workId); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onOpen}
      // keys on the card itself; a button inside it (the room link, the move menu) handles its own
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
    >
      <div className="card-title">{card.title}</div>
      {card.source?.workItemId && <span className="ref ell" title={card.source.workItemId}>{card.source.workItemId}</span>}
      <div className="card-meta">
        {owner
          ? <span className="who" title={owner.detail}><span className="coin">{initials(owner.label)}</span><span className="ell">{owner.label}</span></span>
          : <span className="who none">No owner</span>}
        {at ? <span className="age" title={new Date(at).toLocaleString()}>{ago(at)}</span> : null}
      </div>
      {(card.state && card.state !== "open") || card.reviewPending || card.source?.adapterId || room ? (
        <div className="card-tags">
          {card.state && card.state !== "open" ? <span className="chip">{label(card.state)}</span> : null}
          {card.reviewPending ? <span className="chip amber">Review pending</span> : null}
          {room && onOpenRoom ? (
            <button type="button" className="chip line room-link" title={`Open ${room.channel} in Conversations`}
              onClick={(e) => { e.stopPropagation(); onOpenRoom(room.conversationId); }}>
              <Thread /><span className="ell">{room.channel}</span>
            </button>
          ) : room ? <span className="chip line"><Thread /><span className="ell">{room.channel}</span></span> : null}
          {card.source?.adapterId && !room ? <span className="chip line" title={card.source.url || undefined}>{card.source.adapterId}</span> : null}
        </div>
      ) : null}
      {run ? (
        <div className="card-run" title={run.sessionId || run.id}>
          <span className={`dot${RUN_STATES.has(String(run.state)) ? " live" : ""}`} />
          {mark && <span className="harness-mark" title={run.harness || undefined} aria-label={run.harness || undefined}>{mark}</span>}
          <span className="ell">{[mark ? null : run.harness, label(run.state)].filter(Boolean).join(" · ") || "Run"}</span>
          {run.startedAt ? <span className="age">{ago(run.startedAt)}</span> : null}
        </div>
      ) : null}
      {tracker ? null : (
        <button type="button" className={`card-more${menuOpen ? " on" : ""}`} aria-label={`Move ${card.title}`} aria-haspopup="menu" aria-expanded={menuOpen}
          onClick={(e) => { e.stopPropagation(); onMenu(); }}>
          <More />
        </button>
      )}
    </div>
  );
}

function BoardPicker({ boards, id, onPick }: { boards: Board["boards"]; id: string; onPick: (id: string) => void }) {
  return <select className="pick" value={id} onChange={(e) => onPick(e.target.value)} aria-label="Board">
    {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
  </select>;
}

function MoveMenu({ targets, onPick, onClose }: { targets: Column[]; onPick: (c: Column) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [onClose]);
  return (
    <div className="menu" role="menu" ref={box} onClick={(e) => e.stopPropagation()}>
      <div className="menu-head">Move to</div>
      {targets.length
        ? targets.map((c) => <button key={c.id} type="button" role="menuitem" className="menu-row" onClick={() => onPick(c)}>{c.name}</button>)
        : <div className="menu-note">The board has no move from this column.</div>}
    </div>
  );
}

type ColumnPosition = { boardId: string; column: string; cursor: string };

/** Keep the other columns live while the operator reads an older page in one column. */
function useColumnPage(src: Source, head: Board | null) {
  const [position, setPosition] = useState<ColumnPosition | null>(null);
  const [result, setResult] = useState<{ position: ColumnPosition; board?: Board; error?: string } | null>(null);
  const active = position?.boardId === head?.board?.id ? position : null;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const q = new URLSearchParams({ id: active.boardId, column: active.column, cursor: active.cursor });
    let timer: number;
    const refresh = async () => {
      const answer = await src.get<Board>(`/api/board?${q}`);
      if (cancelled) return;
      setResult(answer.status === 200 ? { position: active, board: answer.body }
        : { position: active, error: answer.body.message || "Could not load this column." });
      timer = window.setTimeout(refresh, 10000);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [src, active, head]);
  const response = active && result?.position === active ? result : null;
  const board = useMemo(() => {
    if (!head || !active || !response?.board) return head;
    return { ...head, cards: cardsWithColumnPage(head.cards, active.column, response.board.cards) };
  }, [head, active, response]);
  return { board, active, response, setPosition };
}

export function Kanban({ src, state, read, boardId, onPickBoard, toast, compact, rooms = [], onOpenRoom }: {
  src: Source; state: State; read: Read<Board> | null; boardId: string; onPickBoard: (id: string) => void;
  toast: (text: string, tone?: "ok" | "warn") => void; compact?: boolean;
  /** The rooms Scout follows; a card whose conversation is one of them links to it. */
  rooms?: RoomRef[]; onOpenRoom?: (conversationId: string) => void;
}) {
  const roomOf = useMemo(() => new Map(rooms.map((r) => [r.conversationId, r])), [rooms]);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ card: Card; to: Column } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const head = read?.ok && read.key === boardId ? read.data : null;
  const { board, active, response, setPosition } = useColumnPage(src, head);
  const activeBoard = boardId || board?.board?.id;
  const [interactionBoard, setInteractionBoard] = useState(activeBoard);
  // Discard the old board's interactions before React commits the new board.
  if (interactionBoard !== activeBoard) {
    setInteractionBoard(activeBoard);
    setPosition(null);
    setSelected(null);
    setMenu(null);
    setMoving(null);
    setOver(null);
  }
  const card = board?.cards.find((c) => c.workId === selected) || null;
  const byColumn = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of board?.cards || []) if (c.column) m.set(c.column, [...(m.get(c.column) || []), c]);
    return m;
  }, [board]);

  const runtime = state.runtime.url.replace(/^https?:\/\//, "");
  if (!state.boards?.supported) {
    return (
      <Notice title="This Scout is too old for boards.">
        <p>The runtime at {runtime} doesn't serve boards. Update Scout on this host, and the Kanban appears here:</p>
        <Notice.Command text="scout update" />
      </Notice>
    );
  }
  if (!read || read.key !== boardId || (boardId && board?.board && board.board.id !== boardId)) {
    const boards = state.boards.list;
    return <div className="kanban">
      {boards.length > 1 && boards.some((b) => b.id === boardId) ?
        <div className="band"><BoardPicker boards={boards} id={boardId} onPick={onPickBoard} /></div> : null}
      <Notice title="Reading the board" quiet />
    </div>;
  }
  if (!read.ok) {
    if (read.error === "boards_unsupported") return <Notice title="This Scout is too old for boards."><p>Update Scout on this host:</p><Notice.Command text="scout update" /></Notice>;
    return <Notice title="The runtime didn't give the board."><p>{read.message}</p></Notice>;
  }
  if (!board?.board) return <Notice title="The runtime serves no board yet." />;

  const drop = (e: DragEvent, to: Column) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/x-scout-work");
    const c = board.cards.find((x) => x.workId === id);
    const tracker = c ? trackerOf(c) : null;
    if (c && tracker) { toast(`This card moves on ${tracker}.`, "warn"); return; }
    if (c && c.column !== to.id) setMoving({ card: c, to });
  };
  const empty = !active && (board.page?.totalCount ?? board.cards.length) === 0;
  const boards = board.boards;
  const total = board.page?.totalCount ?? board.cards.length;

  return (
    <div className={`kanban${compact ? " compact" : ""}`}>
      <div className="band">
        {boards.length > 1 ? (
          <BoardPicker boards={boards} id={board.board.id} onPick={onPickBoard} />
        ) : <span className="band-title">{board.board.name}</span>}
        <span className="band-count" title={board.partial ? "Loaded cards. Update Scout for complete counts." : `${total} cards`}>{total}{board.partial ? "+" : ""}</span>
        {board.board.description && !compact ? <span className="band-note ell">{board.board.description}</span> : null}
      </div>
      <div className="kanban-body">
        <div className="columns" aria-label={board.board.name}>
          {board.columns.map((col) => {
            const browsing = active?.column === col.id;
            const cards = browsing && !response?.board ? [] : byColumn.get(col.id) || [];
            const next = (browsing ? response?.board : board)?.page?.nextByColumn[col.id];
            return (
              <section key={col.id} className={`column${over === col.id ? " over" : ""}`} aria-label={col.name} data-scout-point={col.id} data-scout-label={col.name}
                onDragOver={(e) => { if (e.dataTransfer.types.includes("text/x-scout-work")) { e.preventDefault(); setOver(col.id); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                onDrop={(e) => drop(e, col)}>
                <header className="column-head" title={col.purpose || undefined}>
                  <span className="name">{col.name}</span>
                  <span className="n">{board.page?.columnCounts[col.id] ?? cards.length}{board.partial ? "+" : ""}</span>
                </header>
                <div className="column-body">
                  {browsing && <button type="button" className="chip line" onClick={() => setPosition(null)}>Newest cards</button>}
                  {browsing && !response?.board && <p role="status">{response?.error || "Loading cards…"}</p>}
                  {browsing && response?.board && !cards.length && <p role="status">No older cards in this column.</p>}
                  {cards.map((c) => (
                    <div key={c.workId} className="card-slot">
                      <CardView card={c} selected={c.workId === selected} draggable={!compact}
                        room={roomOf.get(c.roomId || c.conversationId || "") || null} onOpenRoom={onOpenRoom}
                        onOpen={() => setSelected(c.workId === selected ? null : c.workId)}
                        menuOpen={menu === c.workId} onMenu={() => setMenu(menu === c.workId ? null : c.workId)} />
                      {menu === c.workId ? <MoveMenu targets={targetsOf(board, c)} onClose={() => setMenu(null)} onPick={(to) => { setMenu(null); setMoving({ card: c, to }); }} /> : null}
                    </div>
                  ))}
                  {next && <button type="button" className="chip line" onClick={() => setPosition({ boardId: board.board!.id, column: col.id, cursor: next })}>Older cards</button>}
                </div>
              </section>
            );
          })}
        </div>
        {empty ? <div className="kanban-empty">Nothing on this board yet. Work items the runtime places on it show here.</div> : null}
        {card ? (
          <aside className="panel" aria-label={card.title} data-scout-point={card.workId} data-scout-label={card.title}>
            <div className="band">
              <span className="band-title">Work item</span>
              <span className="sp" />
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setSelected(null)}><Close /></button>
            </div>
            <CardPanel key={card.workId} src={src} board={board} card={card} onMove={(to) => setMoving({ card, to })} toast={toast} />
          </aside>
        ) : null}
      </div>
      {moving ? <MoveDialog src={src} board={board} card={moving.card} to={moving.to} onClose={() => setMoving(null)} toast={toast} /> : null}
    </div>
  );
}
