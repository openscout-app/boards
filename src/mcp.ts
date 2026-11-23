// The view's side of MCP Apps: JSON-RPC over postMessage with the host that frames it. The host
// hands the view the tool's result, and passes the view's own tool calls to Scout boards' MCP
// server through the thread.

export type ToolResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
export type DisplayMode = "inline" | "fullscreen" | "pip";
type HostContext = { theme?: "light" | "dark"; displayMode?: DisplayMode };

let nextId = 1;
const waiting = new Map<number, { ok: (v: unknown) => void; no: (e: Error) => void }>();
const post = (m: Record<string, unknown>) => window.parent.postMessage({ jsonrpc: "2.0", ...m }, "*");

export function request<T>(method: string, params?: unknown): Promise<T> {
  return new Promise<T>((ok, no) => {
    const id = nextId++;
    waiting.set(id, { ok: ok as (v: unknown) => void, no });
    post({ id, method, params });
  });
}
const notify = (method: string, params?: unknown) => post({ method, params });

export const callTool = (name: string, args: Record<string, unknown>) => request<ToolResult>("tools/call", { name, arguments: args });
export const openLink = (url: string) => { void request("ui/open-link", { url }).catch(() => {}); };

// ---- what the host tells the view, as small stores

let result: ToolResult | null = null;
let mode: DisplayMode = "inline";
let theme: "light" | "dark" | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const fn of listeners) fn(); };
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const toolResult = () => result;
export const displayMode = () => mode;

function apply(ctx: HostContext | undefined) {
  if (ctx?.theme === "light" || ctx?.theme === "dark") { theme = ctx.theme; document.documentElement.dataset.theme = theme; }
  if (ctx?.displayMode && ctx.displayMode !== mode) { mode = ctx.displayMode; document.documentElement.dataset.displayMode = mode; }
  changed();
}

/** Ask the host for a display mode; it answers with the one it chose. */
export async function requestDisplayMode(want: DisplayMode) {
  const r = await request<{ mode?: DisplayMode }>("ui/request-display-mode", { mode: want });
  if (r?.mode) apply({ displayMode: r.mode });
}

export function startBridge(version: string) {
  document.documentElement.dataset.displayMode = mode;
  window.addEventListener("message", (event) => {
    const m = event.data as { jsonrpc?: string; id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && !m.method) {
      const p = waiting.get(m.id);
      if (!p) return;
      waiting.delete(m.id);
      if (m.error) p.no(new Error(m.error.message || "The host refused the request."));
      else p.ok(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") { result = m.params as ToolResult; changed(); }
    else if (m.method === "ui/notifications/host-context-changed") apply(m.params as HostContext);
    else if (m.id !== undefined) post({ id: m.id, result: {} });
  });
  // the body's own height: the host sizes the frame in the thread to it
  new ResizeObserver(() => notify("ui/notifications/size-changed", { height: Math.ceil(document.body.getBoundingClientRect().height) })).observe(document.body);
  void request<{ hostContext?: HostContext }>("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "scout-boards", version },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
  }).then((r) => { apply(r?.hostContext); notify("ui/notifications/initialized", {}); }, () => {});
}
