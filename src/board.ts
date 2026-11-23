import type { Board, Card, Column } from "./types";

/** Where a card can go: the runtime's list for it, else the board's transitions from its column. */
export function targetsOf(board: Board, card: Card): Column[] {
  const ids = card.next ?? board.transitions.filter((t) => (t.from === card.column || t.from === "*") && t.to !== card.column).map((t) => t.to);
  return [...new Set(ids)].map((id) => board.columns.find((c) => c.id === id)).filter((c): c is Column => Boolean(c));
}
