/** How long ago, short: "now", "4m", "3h", "2d". */
export function ago(t: number | null | undefined, now = Date.now()): string {
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** A viewer's convenience, kept in this browser. Storage can be missing or refuse; then it isn't kept. */
export const prefs = {
  get(key: string): string | null { try { return localStorage.getItem(`scout-boards:${key}`); } catch { return null; } },
  set(key: string, value: string | null) {
    try { if (value === null) localStorage.removeItem(`scout-boards:${key}`); else localStorage.setItem(`scout-boards:${key}`, value); } catch {}
  },
};

/** Words people read for a state the runtime names in code. */
export function label(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Who owns a card, named for people. The runtime gives a name when it knows the actor; a card that
 * came in from a Vercel Board can carry the Board's own principal, which is an ID, not a name.
 */
export function ownerOf(card: { ownerId: string | null; ownerName: string | null }): { label: string; detail: string } | null {
  const id = card.ownerId || "";
  const BOARD = /^vercel:(user|team):/;
  const raw = card.ownerName || "";
  // a Vercel principal, in either field, is an ID: name it for what it is
  if (BOARD.test(raw) || BOARD.test(id)) return { label: "Board user", detail: raw || id };
  const name = raw && raw !== id ? raw : null;
  if (name) return { label: name, detail: id || name };
  if (!id) return null;
  if (id === "operator") return { label: "You", detail: id };
  return { label: id, detail: id };
}

/**
 * The outside tracker that places this card, named for people, or null for Scout's own work. Its
 * tracker moves it and claims it; Scout follows, and keeps only the review. The server refuses
 * the rest too, so this only spares people a control that would be refused.
 */
export function trackerOf(card: { source: { adapterId: string | null } | null }): string | null {
  const id = card.source?.adapterId;
  return id === "vercel-board" ? "Vercel Board" : id === "linear" ? "Linear" : null;
}

export const initials = (name: string | null | undefined) =>
  (name || "?").replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** Compact labels for Scout's known harnesses; other harness names stay readable. */
export function harnessMark(harness: string | null | undefined): string | undefined {
  switch (harness?.trim().toLowerCase()) {
    case "claude":
    case "claude-code": return "Cl";
    case "codex": return "CX";
    case "kimi":
    case "kimi-code": return "Ki";
    case "ag":
    case "antigravity": return "AG";
    default: return undefined;
  }
}
