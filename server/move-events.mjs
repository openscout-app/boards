// Placement revisions come from the runtime. A refused move has no revision.
import { rt } from "./runtime.mjs";

const name = "board.card.moved";
const string = { type: "string" };
const workIdSchema = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$" };
export const moveEvent = {
  name, description: "A card moved to another station, including a move reopened by review.",
  delivery: ["poll"],
  inputSchema: { type: "object", required: ["workId"], properties: { workId: workIdSchema }, additionalProperties: false },
  payloadSchema: { type: "object", required: ["workId", "moveId", "revision", "from", "reopened"],
    properties: { workId: string, moveId: string, revision: { type: "integer" }, from: string, to: string, reopened: { type: "boolean" } } },
};

function fail(code, message, data) { throw Object.assign(new Error(message), { rpcError: { code, message, data } }); }

export async function pollMoves({ name: requested, arguments: args, cursor, maxAgeMs, maxEvents = 100 }) {
  if (typeof requested !== "string") fail(-32602, "An event name is required");
  if (requested !== name) fail(-32023, "Unknown event", { kind: "event" });
  if (typeof args?.workId !== "string" || !new RegExp(workIdSchema.pattern).test(args.workId) || Object.keys(args).length !== 1 ||
      (cursor != null && typeof cursor !== "string") || !Number.isSafeInteger(maxEvents) || maxEvents < 1 ||
      (maxAgeMs !== undefined && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0))) fail(-32602, "Invalid card move poll");
  const { workId } = args;
  const { moves } = await rt(`/v1/work/moves?workId=${encodeURIComponent(workId)}&limit=500`);
  const changes = [];
  for (const move of moves) {
    if (move.itemId !== workId || !Number.isSafeInteger(move.revision)) continue;
    const data = { workId, moveId: move.id, revision: move.revision, from: move.from, to: move.to, reopened: false };
    changes.push({ eventId: move.id, name, timestamp: new Date(move.createdAt).toISOString(), data });
    // Older ledgers record the review and its time, but omit the resulting station.
    if (move.review === "reopened" && Number.isFinite(move.reviewedAt)) {
      changes.push({ eventId: move.id + ":reopened", name, timestamp: new Date(move.reviewedAt).toISOString(),
        data: { workId, moveId: move.id, revision: move.revision + 1, from: move.to, reopened: true } });
    }
  }
  changes.sort((a, b) => a.data.revision - b.data.revision);
  const position = (rev) => JSON.stringify([workId, rev]);
  const head = changes.at(-1)?.data.revision ?? 0;
  const result = { events: [], cursor: position(head), truncated: false, hasMore: false, nextPollMs: 8000 };
  if (cursor == null) return result;
  let after;
  try { const point = JSON.parse(cursor); if (Array.isArray(point) && point[0] === workId) after = point[1]; } catch {}
  if (!Number.isSafeInteger(after) || after < 0 || after > head) return { ...result, truncated: true };
  const floor = maxAgeMs === undefined ? -Infinity : Date.now() - maxAgeMs;
  let previous = after;
  // A missing revision or age cutoff advances the watermark and signals a gap.
  for (const event of changes) {
    const rev = event.data.revision;
    if (rev <= after) continue;
    if (result.events.length === Math.min(maxEvents, 500)) { result.hasMore = true; break; }
    if (rev !== previous + 1) result.truncated = true;
    previous = rev;
    if (Date.parse(event.timestamp) < floor) result.truncated = true;
    else result.events.push(event);
  }
  result.cursor = position(previous);
  return result;
}
