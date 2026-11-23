// What the server's /api answers. The server shapes the runtime's answers, so every field here is
// present, with null where the runtime left it out.

export type RuntimeInfo = { up: boolean; url: string; version: string | null };
export type BoardRef = { id: string; name: string; version: number | null; isDefault: boolean };
export type RoomRef = {
  conversationId: string; connectionId: string; channel: string; board: string | null; adapterId: string;
  state: string | null; connectionState: string | null; posts: number | null; lastAt: number | null;
};

export type State = {
  runtime: RuntimeInfo;
  boards: { supported: boolean; list: BoardRef[]; error?: string } | null;
  rooms: { supported: boolean; connections: number; list: RoomRef[]; error?: string } | null;
};

export type Column = { id: string; name: string; state: string | null; purpose: string | null };
export type Card = {
  workId: string; column: string | null; revision: number; reviewPending: boolean; next: string[] | null;
  title: string; summary: string | null; state: string | null; acceptanceState: string | null; priority: string | null;
  ownerId: string | null; ownerName: string | null; nextMoveOwnerId: string | null; nextMoveOwnerName: string | null;
  conversationId: string | null; parentId: string | null; parentTitle: string | null;
  createdAt: number | null; updatedAt: number | null; lastMeaningfulAt: number | null; lastMeaningfulSummary: string | null;
  source: { adapterId: string | null; instanceId: string | null; workItemId: string | null; url: string | null } | null;
  activeFlight: { id: string; state: string | null; harness: string | null; sessionId: string | null; startedAt: number | null } | null;
  /** The room this card came from, when Scout follows it (the server finds it); null otherwise. */
  roomId?: string | null;
};
export type Board = {
  boards: BoardRef[];
  board: { id: string; name: string; version: number | null; hash: string | null; description: string | null } | null;
  columns: Column[];
  transitions: Array<{ from: string; to: string; name: string | null }>;
  cards: Card[];
};

export type Who = { kind: "operator" | "agent" | "person"; label: string; detail: string; harness: string | null };
export type JobState = "ready" | "waiting" | "running" | "blocked" | "done" | "failed" | "cancelled";
export type Step = { id: string; kind: string; at: number | null; by: Who | null; to: Who | null; note: string | null };
export type Post = {
  id: string; at: number | null; by: Who | null; text: string;
  task: { state: JobState; to: Who | null; result: string | null } | null;
  replies: Array<{ id: string; at: number | null; by: Who | null; text: string }>;
  steps: Step[];
};
export type Job = {
  taskId: string; title: string; step: string; plan: string | null; state: JobState; needs: string[];
  createdAt: number | null; dispatchedAt: number | null; finishedAt: number | null; to: Who | null; result: string | null; flightId: string | null;
};
export type Run = { key: string; label: string; startedAt: number | null; finishedAt: number | null; counts: Record<string, number>; jobs: Job[] };
export type Room = {
  room: RoomRef; view: "conversation" | "tasks"; lastGoodReadAt: number | null;
  posts: Post[]; runs: Run[]; counts: Record<string, number>;
};

export type Verdict = "allow" | "deny" | "hold" | "consult";
export type MoveDecision = {
  verdict: Verdict; from: string; to: string; toState: string;
  reasons: Array<{ ruleId: string; outcome: "pass" | "fail"; effect: string; message: string; shadow?: boolean }>;
  review: "pending" | "not_needed";
};
export type MoveResponse = { decision: MoveDecision; applied: boolean; move?: { id: string } };
export type MoveRecord = {
  id: string; itemId: string; from: string; to: string; moverId: string; verdict: Verdict; note?: string;
  revision?: number; review: string; at?: number; createdAt?: number;
};

/** One read's outcome, as the event stream and the polls both give it. */
export type Read<T> = { key: string; ok: true; data: T } | { key: string; ok: false; error: string; message: string; status: number };
export type Answer<T> = { status: number; body: T & { error?: string; message?: string } };
