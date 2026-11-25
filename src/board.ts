import type { Board, Card, Column } from "./types";

/** Replace one column's visible cards. A move on the live board takes precedence over an older page. */
export function cardsWithColumnPage(current: Card[], column: string, page: Card[]): Card[] {
  const others = current.filter(card => card.column !== column);
  const moved = new Set(others.map(card => card.workId));
  return [...others, ...page.filter(card => card.column === column && !moved.has(card.workId))];
}

/** Where a card can go: the runtime's list for it, else the board's transitions from its column. */
export function targetsOf(board: Board, card: Card): Column[] {
  const ids = card.next ?? board.transitions.filter((t) => (t.from === card.column || t.from === "*") && t.to !== card.column).map((t) => t.to);
  return [...new Set(ids)].map((id) => board.columns.find((c) => c.id === id)).filter((c): c is Column => Boolean(c));
}
