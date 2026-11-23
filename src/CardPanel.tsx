// A work item up close, and the moves made from it. Each write goes to the runtime, which checks
// it and records it; a move is first shown as the runtime decides it, recording nothing.
import { useEffect, useState, type ReactNode } from "react";
import type { Board, Card, Column, MoveDecision, MoveRecord, MoveResponse, Verdict } from "./types";
import type { Source } from "./source";
import { targetsOf } from "./board";
import { ago, label, when } from "./util";
import { Arrow, External } from "./icons";

const VERDICT: Record<Verdict, string> = {
  allow: "The runtime allows this move.",
  hold: "The runtime would hold this move.",
  consult: "The runtime would ask a person about this move.",
  deny: "The runtime refuses this move.",
};

function Fact({ k, children }: { k: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return <><dt>{k}</dt><dd>{children}</dd></>;
}

function Review({ src, board, card, toast }: { src: Source; board: Board; card: Card; toast: (t: string, tone?: "ok" | "warn") => void }) {
  const [move, setMove] = useState<MoveRecord | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void src.get<{ moves: MoveRecord[] }>(`/api/moves?workId=${encodeURIComponent(card.workId)}`).then((a) => {
      if (!live) return;
      const pending = (a.body.moves || []).filter((m) => m.review === "pending").sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
      setMove(pending[0] || null);
    });
    return () => { live = false; };
  }, [src, card.workId, card.revision]);
  const name = (id: string) => board.columns.find((c) => c.id === id)?.name || id;
  if (move === undefined) return <p className="dim">Reading the move to review.</p>;
  if (!move) return <p className="dim">The runtime lists no move waiting for review.</p>;
  const send = async (verdict: "confirm" | "reopen" | "consult") => {
    setBusy(true);
    const a = await src.post<{ status?: string }>("/api/review", { workId: card.workId, moveId: move.id, verdict, revision: card.revision, note });
    setBusy(false);
    if (a.status === 200) toast(verdict === "confirm" ? "Review sent: confirmed." : verdict === "reopen" ? "Review sent: reopened." : "Review sent: asked a person.", "ok");
    else toast(a.body.message || "The runtime didn't take the review.", "warn");
  };
  return (
    <div className="review">
      <p className="dim">{name(move.from)} <Arrow /> {name(move.to)}{move.moverId ? `, moved by ${move.moverId}` : ""}{move.createdAt ? `, ${ago(move.createdAt)} ago` : ""}</p>
      {move.note ? <p className="quote">{move.note}</p> : null}
      <input className="field" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void send("confirm")}>Confirm</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void send("reopen")}>Reopen</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void send("consult")}>Ask a person</button>
      </div>
    </div>
  );
}

export function CardPanel({ src, board, card, onMove, toast }: {
  src: Source; board: Board; card: Card; onMove: (to: Column) => void; toast: (t: string, tone?: "ok" | "warn") => void;
}) {
  const column = board.columns.find((c) => c.id === card.column);
  const targets = targetsOf(board, card);
  const [claiming, setClaiming] = useState(false);
  const run = card.activeFlight;
  const claim = async () => {
    setClaiming(true);
    const a = await src.post<{ ownerId?: string }>("/api/claim", { workId: card.workId });
    setClaiming(false);
    if (a.status === 200) toast("Claimed. You own this work item now.", "ok");
    else toast(a.body.message || "The runtime didn't take the claim.", "warn");
  };
  return (
    <div className="panel-body">
      <h3 className="panel-title">{card.title}</h3>
      {card.summary ? <p className="panel-summary">{card.summary}</p> : null}
      <dl className="facts">
        <Fact k="Column">{column?.name || "None"}</Fact>
        <Fact k="State">{label(card.state)}</Fact>
        <Fact k="Acceptance">{label(card.acceptanceState)}</Fact>
        <Fact k="Priority">{label(card.priority)}</Fact>
        <Fact k="Owner">{card.ownerName || card.ownerId}</Fact>
        <Fact k="Next move">{card.nextMoveOwnerName || card.nextMoveOwnerId}</Fact>
        <Fact k="Part of">{card.parentTitle || card.parentId}</Fact>
        <Fact k="Run">{run ? `${[run.harness, label(run.state)].filter(Boolean).join(" · ")}${run.startedAt ? `, started ${ago(run.startedAt)} ago` : ""}` : null}</Fact>
        <Fact k="From">{card.source?.adapterId ? (card.source.url
          ? <a href={card.source.url} target="_blank" rel="noreferrer">{card.source.adapterId}{card.source.workItemId ? ` ${card.source.workItemId}` : ""} <External /></a>
          : `${card.source.adapterId}${card.source.workItemId ? ` ${card.source.workItemId}` : ""}`) : null}</Fact>
        <Fact k="Last change">{card.lastMeaningfulSummary ? `${card.lastMeaningfulSummary}${card.lastMeaningfulAt ? ` (${ago(card.lastMeaningfulAt)} ago)` : ""}` : null}</Fact>
        <Fact k="Updated">{when(card.updatedAt)}</Fact>
        <Fact k="Created">{when(card.createdAt)}</Fact>
        <Fact k="Work id"><code>{card.workId}</code></Fact>
      </dl>
      <section className="panel-section">
        <h4>Move to</h4>
        {targets.length
          ? <div className="row wrap">{targets.map((t) => <button key={t.id} type="button" className="btn" onClick={() => onMove(t)}>{t.name}</button>)}</div>
          : <p className="dim">The board has no move from {column?.name || "here"}.</p>}
      </section>
      {card.reviewPending ? (
        <section className="panel-section">
          <h4>Review</h4>
          <Review src={src} board={board} card={card} toast={toast} />
        </section>
      ) : null}
      <section className="panel-section">
        <h4>Claim</h4>
        <p className="dim">Claiming makes you the owner, under a lease the runtime keeps.</p>
        <button type="button" className="btn" disabled={claiming} onClick={() => void claim()}>Claim</button>
      </section>
    </div>
  );
}

/** A move, as the runtime decides it, before it is made. */
export function MoveDialog({ src, board, card, to, onClose, toast }: {
  src: Source; board: Board; card: Card; to: Column; onClose: () => void; toast: (t: string, tone?: "ok" | "warn") => void;
}) {
  const [note, setNote] = useState("");
  const [waiting, setWaiting] = useState("");
  const [decision, setDecision] = useState<MoveDecision | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [sending, setSending] = useState(false);
  const needsWaiting = to.state === "waiting";
  const from = board.columns.find((c) => c.id === card.column);
  const body = { workId: card.workId, to: to.id, note, ...(waiting.trim() ? { waitingOn: { label: waiting } } : {}) };
  const key = JSON.stringify(body);

  useEffect(() => {
    let live = true;
    setChecking(true);
    const t = setTimeout(async () => {
      const a = await src.preview(body);
      if (!live) return;
      setChecking(false);
      if (a.status === 200 && a.body.decision) { setDecision(a.body.decision); setProblem(null); }
      else { setDecision(null); setProblem(a.body.message || "The runtime didn't check the move."); }
    }, decision ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const move = async () => {
    setSending(true);
    const a = await src.post<MoveResponse>("/api/move", body);
    setSending(false);
    if (a.status === 200 && a.body.applied) { toast(`Moved to ${to.name}.`, "ok"); onClose(); return; }
    if (a.status === 200 && a.body.decision) { setDecision(a.body.decision); toast(VERDICT[a.body.decision.verdict], "warn"); return; }
    toast(a.body.message || "The runtime didn't make the move.", "warn");
  };
  const failing = decision?.reasons.filter((r) => r.outcome === "fail" && !r.shadow) || [];
  const passing = decision?.reasons.filter((r) => r.outcome === "pass" || r.shadow) || [];

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dialog" role="dialog" aria-label={`Move to ${to.name}`} onSubmit={(e) => { e.preventDefault(); void move(); }}>
        <div className="band"><span className="band-title">Move to {to.name}</span></div>
        <div className="dialog-body">
          <p className="dialog-card">{card.title}</p>
          <p className="dim">{from?.name || "No column"} <Arrow /> {to.name}</p>
          <div className={`verdict${decision ? ` v-${decision.verdict}` : ""}${checking ? " checking" : ""}`} aria-live="polite">
            {checking && !decision ? "Checking the move with the runtime." : problem ? problem : decision ? VERDICT[decision.verdict] : null}
            {decision?.review === "pending" ? <span className="dim"> A reviewer checks it after it lands.</span> : null}
          </div>
          {failing.length ? <ul className="reasons">{failing.map((r) => <li key={r.ruleId} className="fail">{r.message}</li>)}</ul> : null}
          {passing.length ? <ul className="reasons">{passing.map((r) => <li key={r.ruleId}>{r.message}</li>)}</ul> : null}
          {needsWaiting ? <label className="lab">Waiting on<input className="field" value={waiting} onChange={(e) => setWaiting(e.target.value)} placeholder="Who or what it waits for" /></label> : null}
          <label className="lab">Note<input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder={to.state === "cancelled" ? "Why it is dropped" : "Optional"} /></label>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={sending || checking || !decision || decision.verdict === "deny"}>Move</button>
        </div>
      </form>
    </div>
  );
}
