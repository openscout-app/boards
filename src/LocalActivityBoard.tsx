import { useEffect, useMemo, useState } from "react";
import { ago, harnessMark, label } from "./util";

interface LocalSessionCard {
  id: string;
  sessionId: string;
  column: "active" | "branches" | "completed";
  harness: string;
  project: string | null;
  branch: string | null;
  title: string;
  outcome: string | null;
  files: number;
  prs: Array<{ key: string; label: string; url: string; state: "open" | "merged" }>;
  updatedAt: number;
}

interface LocalColumn {
  id: "active" | "branches" | "completed";
  name: string;
  state: string;
  purpose: string;
}

interface LocalBoardPayload {
  columns: LocalColumn[];
  cards: LocalSessionCard[];
}

export function LocalActivityBoard({
  onOpenSession,
}: {
  onOpenSession?: (sessionId: string) => void;
}) {
  const [board, setBoard] = useState<LocalBoardPayload | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/local-board")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.columns) setBoard(data as LocalBoardPayload);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const filteredCards = useMemo(() => {
    if (!board) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return board.cards;
    return board.cards.filter(
      (c) =>
        c.title.toLowerCase().includes(q)
        || (c.outcome && c.outcome.toLowerCase().includes(q))
        || (c.project && c.project.toLowerCase().includes(q))
        || (c.branch && c.branch.toLowerCase().includes(q))
        || c.harness.toLowerCase().includes(q),
    );
  }, [board, filter]);

  if (!board) {
    return (
      <div className="notice quiet" role="status">
        <h2>Scanning local agent sessions…</h2>
      </div>
    );
  }

  return (
    <div className="kanban">
      <div className="band">
        <span className="band-title">Local session activity</span>
        <span className="band-count">{filteredCards.length}</span>
        <span className="band-note ell">Populated from local Claude, Codex, Antigravity, and Kimi transcripts</span>
        <span className="sp" />
        <input
          type="text"
          className="board-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sessions…"
          aria-label="Filter local session cards"
        />
      </div>

      <div className="kanban-body">
        <div className="columns" aria-label="Local session activity">
          {board.columns.map((col) => {
            const cards = filteredCards.filter((c) => c.column === col.id);
            return (
              <section key={col.id} className="column" aria-label={col.name}>
                <header className="column-head" title={col.purpose}>
                  <span className={`dot s-${col.state === "working" ? "running" : col.state === "review" ? "ready" : "done"}`} />
                  <span className="name">{col.name}</span>
                  <span className="n">{cards.length}</span>
                </header>
                <div className="column-body">
                  {cards.map((card) => {
                    const mark = harnessMark(card.harness);
                    const visibleBranch =
                      card.branch && card.branch !== "main" && card.branch !== "master"
                        ? card.branch
                        : null;
                    const hasTags = Boolean(visibleBranch || card.files > 0 || card.prs.length > 0);
                    return (
                      <div key={card.id} className="card-slot">
                        <div
                          className="card"
                          role={onOpenSession ? "button" : undefined}
                          tabIndex={onOpenSession ? 0 : undefined}
                          onClick={() => onOpenSession?.(card.sessionId)}
                          onKeyDown={(e) => {
                            if ((e.key === "Enter" || e.key === " ") && onOpenSession) {
                              e.preventDefault();
                              onOpenSession(card.sessionId);
                            }
                          }}
                        >
                          <div className="card-title">{card.title}</div>
                          {card.outcome ? <div className="card-sub ell">{card.outcome}</div> : null}
                          <div className="card-meta">
                            <span className="who">
                              {mark ? <span className="harness-mark">{mark}</span> : null}
                              <span className="ell">{card.project || label(card.harness)}</span>
                            </span>
                            <span className="sp" />
                            <span className="age">{ago(card.updatedAt)}</span>
                            {!hasTags && onOpenSession ? (
                              <span className="card-session-cue card-session-inline">Session →</span>
                            ) : null}
                          </div>
                          {hasTags ? (
                            <div className="card-tags">
                              {card.prs.map((pr) => (
                                <a
                                  key={pr.key}
                                  href={pr.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`chip ${pr.state === "merged" ? "s-done" : "amber"}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {pr.label}
                                </a>
                              ))}
                              {visibleBranch ? (
                                <span className="chip line ell">{visibleBranch}</span>
                              ) : null}
                              {card.files > 0 ? <span className="chip">{card.files} {card.files === 1 ? "file" : "files"}</span> : null}
                              {onOpenSession ? <span className="card-session-cue">Session →</span> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
