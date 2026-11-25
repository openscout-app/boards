// The Kanban, as the runtime serves it from /v1/boards/:id, made safe to draw: every field the
// page reads is present (null where the runtime left it out), each card's `next` is a list of
// column ids, and a card whose column the board doesn't name goes in no column rather than a
// made-up one.

const str = (v) => (typeof v === "string" && v ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The boards list from /v1/boards. */
export function shapeBoards(raw) {
  const list = Array.isArray(raw?.boards) ? raw.boards : [];
  return list.filter((b) => str(b?.id)).map((b) => ({
    id: b.id, name: str(b.name) || b.id, version: num(b.version), isDefault: b.isDefault === true,
  }));
}

/** Which board to open: the one asked for if it exists, else the default, else the first. */
export function pickBoard(boards, want) {
  return boards.find((b) => b.id === want) || boards.find((b) => b.isDefault) || boards[0] || null;
}

function shapeCard(c, columnIds) {
  const next = Array.isArray(c.next)
    ? c.next.map((n) => (typeof n === "string" ? n : str(n?.id) || str(n?.station) || str(n?.column))).filter(Boolean)
    : null;
  const src = c.source && typeof c.source === "object" ? c.source : null;
  const flight = c.activeFlight && typeof c.activeFlight === "object" ? c.activeFlight : null;
  return {
    workId: String(c.workId),
    column: columnIds.has(c.column) ? c.column : null,
    revision: num(c.revision) ?? 0,
    reviewPending: c.reviewPending === true,
    next,
    title: str(c.title) || String(c.workId),
    summary: str(c.summary),
    state: str(c.state),
    acceptanceState: str(c.acceptanceState),
    priority: str(c.priority) ?? (num(c.priority) === null ? null : String(c.priority)),
    ownerId: str(c.ownerId),
    ownerName: str(c.ownerName),
    nextMoveOwnerId: str(c.nextMoveOwnerId),
    nextMoveOwnerName: str(c.nextMoveOwnerName),
    conversationId: str(c.conversationId),
    parentId: str(c.parentId),
    parentTitle: str(c.parentTitle),
    createdAt: num(c.createdAt),
    updatedAt: num(c.updatedAt),
    lastMeaningfulAt: num(c.lastMeaningfulAt),
    lastMeaningfulSummary: str(c.lastMeaningfulSummary),
    source: src ? { adapterId: str(src.adapterId), instanceId: str(src.instanceId), workItemId: str(src.workItemId), url: str(src.url) } : null,
    activeFlight: flight && str(flight.id)
      ? { id: flight.id, state: str(flight.state), harness: str(flight.harness), sessionId: str(flight.sessionId), startedAt: num(flight.startedAt) }
      : null,
  };
}

/** One board from /v1/boards/:id. */
export function shapeBoard(raw) {
  const b = raw?.board || {};
  const columns = (Array.isArray(raw?.columns) ? raw.columns : []).filter((c) => str(c?.id)).map((c) => ({
    id: c.id, name: str(c.name) || c.id, state: str(c.state), purpose: str(c.purpose),
  }));
  const ids = new Set(columns.map((c) => c.id));
  const transitions = (Array.isArray(raw?.transitions) ? raw.transitions : [])
    .filter((t) => (t?.from === "*" || ids.has(t?.from)) && ids.has(t?.to))
    .map((t) => ({ from: t.from, to: t.to, name: str(t.name) }));
  const cards = (Array.isArray(raw?.cards) ? raw.cards : []).filter((c) => c && c.workId != null).map((c) => shapeCard(c, ids));
  return {
    board: { id: str(b.id) || "", name: str(b.name) || str(b.id) || "Board", version: num(b.version), hash: str(b.hash), description: str(b.description) },
    columns, transitions, cards,
    ...(Number.isSafeInteger(raw?.page?.totalCount) && { page: raw.page }),
  };
}

/** Where a card can go: what the runtime listed for it, else the board's transitions from its column. */
export function targetsOf(board, card) {
  const ids = card.next ?? board.transitions.filter((t) => (t.from === card.column || t.from === "*") && t.to !== card.column).map((t) => t.to);
  return [...new Set(ids)].map((id) => board.columns.find((c) => c.id === id)).filter(Boolean);
}

export const CARDS_PER_COLUMN = 12;

/** The board for a model: columns with their newest cards, and counts. */
export function boardForModel(board) {
  return {
    board: board.board.name,
    cardCount: board.page?.totalCount ?? board.cards.length,
    ...(board.partial && { partial: true }),
    columns: board.columns.map((col) => {
      const cards = board.cards.filter((c) => c.column === col.id);
      return {
        id: col.id, name: col.name, count: board.page?.columnCounts[col.id] ?? cards.length,
        ...(board.page?.nextByColumn[col.id] && { nextCursor: board.page.nextByColumn[col.id] }),
        cards: cards.slice(0, CARDS_PER_COLUMN).map((c) => ({
          id: c.workId, title: c.title, owner: c.ownerName, reviewPending: c.reviewPending,
          running: c.activeFlight ? c.activeFlight.harness || true : false,
        })),
      };
    }),
  };
}

export function describeBoard(m) {
  const lines = [`${m.board}: ${m.partial ? "at least " : ""}${m.cardCount} ${m.cardCount === 1 ? "card" : "cards"}.`];
  for (const col of m.columns) {
    if (!col.count) continue;
    lines.push("", `${col.name} (${col.count})`);
    for (const c of col.cards) {
      lines.push(`- ${c.title} [${c.id}]${c.owner ? `, ${c.owner}` : ""}${c.reviewPending ? ", review pending" : ""}${c.running ? ", running" : ""}`);
    }
    if (col.count > col.cards.length) lines.push(`- showing ${col.cards.length} of ${col.count}`);
  }
  if (m.partial) lines.push("Column counts cover the loaded cards. Update Scout for complete counts and paging.");
  return lines.join("\n");
}
