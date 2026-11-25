// A Board room: one Vercel Board channel Scout follows. Conversation is its posts, oldest first,
// each with its replies and its hand-offs; Tasks is its tasks, grouped by the plan that wrote them.
// Text from the board is quoted source material, drawn as plain text.
import { useEffect, useMemo, useRef, useState } from "react";
import { ScoutSideNav } from "@openscout/workspace-ui/react";
import type { JobState, Post, Read, Room as RoomData, RoomRef, Run, State, Who } from "./types";
import { ago, harnessMark, label, prefs, when } from "./util";
import { Caret, Check, Tasks, Thread } from "./icons";
import { Notice } from "./Notice";

const STATE_WORD: Record<JobState, string> = {
  ready: "Ready", waiting: "Waiting", running: "Running", blocked: "Blocked", done: "Done", failed: "Failed", cancelled: "Cancelled",
};

const roomLabel = (r: RoomRef) => (r.board ? `${r.board} › ${r.channel}` : r.channel);

function Switcher({ rooms, current, onPick }: { rooms: RoomRef[]; current: RoomRef; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const groups = useMemo(() => {
    const m = new Map<string, RoomRef[]>();
    for (const r of rooms) m.set(r.board || "", [...(m.get(r.board || "") || []), r]);
    return [...m.entries()];
  }, [rooms]);
  return (
    <div className="switch" ref={box}>
      <button type="button" className="switch-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={rooms.length < 2} onClick={() => setOpen(!open)}>
        {current.board ? <><span className="dim">{current.board}</span><span className="faint" aria-hidden>›</span></> : null}
        <span>{current.channel}</span>
        {rooms.length > 1 ? <Caret /> : null}
      </button>
      {open ? (
        <div className="menu switch-list" role="listbox" aria-label="Board rooms">
          {groups.map(([board, list]) => (
            <div key={board} role="group" aria-label={board || "Rooms"}>
              {board ? <div className="menu-head">{board}</div> : null}
              {list.map((r) => (
                <button key={r.conversationId} type="button" role="option" aria-selected={r.conversationId === current.conversationId} className="menu-row"
                  onClick={() => { onPick(r.conversationId); setOpen(false); }}>
                  <span className="ell">{r.channel}</span>
                  <span className="sp" />
                  {r.posts !== null ? <span className="faint">{r.posts}</span> : null}
                  <span className="check">{r.conversationId === current.conversationId ? <Check /> : null}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Where a room comes from, named for people: the adapter, and the board on it. */
export const sourceName = (adapterId: string | null | undefined) =>
  adapterId === "vercel-board" ? "Vercel Board" : adapterId === "slack" ? "Slack" : adapterId === "scout" ? "Scout" : label(adapterId || "") || "Other";

/**
 * Every room Scout follows, grouped by where it comes from (Vercel Board, and later Slack or Scout's
 * own chats), then by the board it sits on. The open room is marked by its background.
 */
export function RoomList({ rooms, current, onPick }: { rooms: RoomRef[]; current: string; onPick: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { source: string; board: string | null; rooms: RoomRef[] }>();
    for (const r of rooms) {
      const key = `${r.adapterId}\u0000${r.board || ""}`;
      const g = m.get(key) || { source: sourceName(r.adapterId), board: r.board, rooms: [] };
      g.rooms.push(r);
      m.set(key, g);
    }
    return [...m.values()];
  }, [rooms]);
  return (
    <ScoutSideNav className="room-list" aria-label="Rooms">
      {groups.map((g) => (
        <section key={`${g.source}:${g.board}`} className="room-group" aria-label={g.board ? `${g.source}, ${g.board}` : g.source}>
          <div className="room-group-head">
            <span>{g.source}</span>
            {g.board ? <span className="faint ell">{g.board}</span> : null}
          </div>
          {g.rooms.map((r) => (
            <button key={r.conversationId} type="button" className="scout-nav-item room-row" aria-current={r.conversationId === current ? "page" : undefined}
              onClick={() => onPick(r.conversationId)}>
              <span className="ell">{r.channel}</span>
              <span className="sp" />
              {r.lastAt ? <span className="faint" title={when(r.lastAt)}>{ago(r.lastAt)}</span> : null}
            </button>
          ))}
        </section>
      ))}
    </ScoutSideNav>
  );
}

function WhoName({ who }: { who: Who | null }) {
  if (!who) return <span className="who-name dim">Someone</span>;
  const mark = harnessMark(who.harness);
  return (
    <span className="actor" title={who.detail}>
      {mark && <span className="harness-mark" title={who.harness || undefined} aria-label={who.harness || undefined}>{mark}</span>}
      <span className={`who-name k-${who.kind}`}>{who.label}</span>
      {!mark && who.harness && <span className="dim">{who.harness}</span>}
    </span>
  );
}

const StateChip = ({ state }: { state: JobState }) => <span className={`chip s-${state}`}>{STATE_WORD[state]}</span>;

/** Long board text folds to a few lines until opened. */
function Quoted({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 420 || text.split("\n").length > 7;
  return (
    <div className={`quoted${long && !open ? " folded" : ""}`}>
      <p>{text}</p>
      {long ? <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show all"}</button> : null}
    </div>
  );
}

function PostRow({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  const thread = post.replies.length + post.steps.length;
  return (
    <article className="post">
      <div className="post-head">
        <WhoName who={post.by} />
        {post.at ? <span className="faint" title={when(post.at)}>{ago(post.at)}</span> : null}
        <span className="sp" />
        {post.task ? <StateChip state={post.task.state} /> : null}
      </div>
      <Quoted text={post.text} />
      {post.task?.result ? <p className="post-result dim">{post.task.result}</p> : null}
      {thread ? (
        <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {[post.replies.length ? `${post.replies.length} ${post.replies.length === 1 ? "reply" : "replies"}` : null,
            post.steps.length ? `${post.steps.length} ${post.steps.length === 1 ? "hand-off" : "hand-offs"}` : null].filter(Boolean).join(", ")}
        </button>
      ) : null}
      {open ? (
        <ol className="thread">
          {[...post.replies.map((r) => ({ at: r.at, id: r.id, node: <><WhoName who={r.by} /><Quoted text={r.text} /></> })),
            ...post.steps.map((s) => ({ at: s.at, id: s.id, node: (
              <p className="step dim"><WhoName who={s.by} /> {label(s.kind).toLowerCase()}{s.to ? <> for <WhoName who={s.to} /></> : null}{s.note ? `: ${s.note}` : ""}</p>
            ) }))]
            .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
            .map((e) => <li key={e.id}>{e.at ? <span className="faint t" title={when(e.at)}>{ago(e.at)}</span> : <span className="faint t" />}<div>{e.node}</div></li>)}
        </ol>
      ) : null}
    </article>
  );
}

function RunBlock({ run }: { run: Run }) {
  return (
    <section className="run">
      <header className="run-head">
        <span className="run-label ell">{run.label}</span>
        <span className="sp" />
        {Object.entries(run.counts).map(([s, n]) => <span key={s} className="faint">{n} {STATE_WORD[s as JobState]?.toLowerCase() || s}</span>)}
        {run.startedAt ? <span className="faint" title={when(run.startedAt)}>{ago(run.startedAt)}</span> : null}
      </header>
      <ul className="jobs">
        {run.jobs.map((j) => (
          <li key={j.taskId} className="job">
            <span className={`dot s-${j.state}`} title={STATE_WORD[j.state]} />
            <div className="job-main">
              <div className="job-line"><span className="job-title ell">{j.step}</span>{j.to ? <span className="job-to"><WhoName who={j.to} /></span> : null}</div>
              <span className="ref ell" title={j.taskId}>{j.taskId}</span>
              {j.result ? <div className="job-result dim ell">{j.result}</div> : null}
            </div>
            <StateChip state={j.state} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Room({ state, read, roomId, onPickRoom, actions, switcher = true }: {
  state: State; read: Read<RoomData> | null; roomId: string; onPickRoom: (id: string) => void; actions?: React.ReactNode;
  /** The room's own menu of rooms; off when a room list sits beside it. */
  switcher?: boolean;
}) {
  const rooms = state.rooms?.list || [];
  const current = rooms.find((r) => r.conversationId === roomId) || null;
  const [picked, setPicked] = useState<Record<string, "conversation" | "tasks">>(() => {
    try { return JSON.parse(prefs.get("tabs") || "{}"); } catch { return {}; }
  });
  const feed = useRef<HTMLDivElement>(null);
  const data = read?.ok && read.key === roomId ? read.data : null;
  // a room opens on its conversation; Tasks is one click away, and the choice is kept per room
  const tab = (current && picked[current.conversationId]) || "conversation";
  const pick = (v: "conversation" | "tasks") => {
    if (!current) return;
    const next = { ...picked, [current.conversationId]: v };
    setPicked(next);
    prefs.set("tabs", JSON.stringify(next));
  };
  // a conversation opens at its newest post
  useEffect(() => { if (tab === "conversation" && feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [tab, data?.posts.length, roomId]);

  if (!state.rooms?.supported) {
    return (
      <Notice title="This Scout's runtime has no Vercel Board adapter.">
        <p>Update Scout on this host, and Board rooms appear here:</p>
        <Notice.Command text="scout update" />
      </Notice>
    );
  }
  if (!rooms.length) {
    return (
      <Notice title={state.rooms.connections ? "No Board room is mirrored yet." : "Scout doesn't follow a Vercel Board yet."}>
        {state.rooms.connections
          ? <p>Scout is connected to a board, and has no channel mirrored on this host yet. Mirrored channels show here as rooms.</p>
          : <>
              <p>Connect one from a terminal on this host. The credential is a reference to a Vercel token, kept where you keep it:</p>
              <Notice.Command text="scout integration connect vercel-board --team <team> --credential env:VERCEL_TOKEN" />
              <p className="dim">The other credential forms are in <code>scout integration vercel-board --help</code>.</p>
            </>}
      </Notice>
    );
  }
  if (!current) return <Notice title="Reading the rooms" quiet />;

  return (
    <div className="room">
      <div className="band">
        {switcher ? <Switcher rooms={rooms} current={current} onPick={onPickRoom} /> : <span className="band-title ell">{current.channel}</span>}
        <span className="sp" />
        <div className="tabs" role="tablist" aria-label={`Views of ${current.channel}`}>
          <button type="button" role="tab" aria-selected={tab === "conversation"} onClick={() => pick("conversation")}><Thread />Conversation</button>
          <button type="button" role="tab" aria-selected={tab === "tasks"} onClick={() => pick("tasks")}><Tasks />Tasks</button>
        </div>
        {actions}
      </div>
      <div className="room-body" ref={feed}>
        {!read || read.key !== roomId ? <Notice title={`Reading ${roomLabel(current)}`} quiet />
          : !read.ok ? <Notice title="The runtime didn't give this room."><p>{read.message}</p></Notice>
          : tab === "tasks"
            ? (data!.runs.length ? data!.runs.map((r) => <RunBlock key={r.key} run={r} />) : <Notice title="No tasks in this room." quiet />)
            : (data!.posts.length ? <div className="posts">{data!.posts.map((p) => <PostRow key={p.id} post={p} />)}</div> : <Notice title="No posts in this room yet." quiet />)}
      </div>
      {data?.lastGoodReadAt ? <div className="room-foot faint">Read from the board {ago(data.lastGoodReadAt) === "now" ? "just now" : `${ago(data.lastGoodReadAt)} ago`}</div> : null}
    </div>
  );
}
