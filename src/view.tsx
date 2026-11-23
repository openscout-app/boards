// The view an agent's thread shows (an MCP App). Inline, it is one pane, the one the tool was
// called for, compact. Expand asks the host for the full window, where both panes show side by
// side; the other control opens the same page in a browser.
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { mcpSource } from "./source";
import { displayMode, openLink, requestDisplayMode, startBridge, subscribe, toolResult } from "./mcp";
import { Expand, PopOut } from "./icons";
import "@openscout/workspace-ui/frame.css";
import "./tokens.css";
import "./app.css";

startBridge("0.2.0");

type Result = { kind?: "work-board" | "board-room"; boardId?: string; conversationId?: string; boardsUrl?: string | null; note?: string };

function View() {
  const result = useSyncExternalStore(subscribe, toolResult);
  const mode = useSyncExternalStore(subscribe, displayMode);
  const r = (result?.structuredContent || {}) as Result;
  if (!result) return <div className="app embedded"><div className="notice quiet"><h2>Waiting for the tool's result</h2></div></div>;
  const full = mode === "fullscreen";
  const actions = (
    <span className="view-actions">
      <button type="button" className="icon-btn" aria-label={full ? "Back to the thread" : "Expand"} title={full ? "Back to the thread" : "Expand"}
        onClick={() => void requestDisplayMode(full ? "inline" : "fullscreen").catch(() => {})}>
        <Expand out={full} />
      </button>
      {r.boardsUrl ? (
        <button type="button" className="icon-btn" aria-label="Open in the browser" title="Open in the browser" onClick={() => openLink(r.boardsUrl!)}>
          <PopOut />
        </button>
      ) : null}
    </span>
  );
  return (
    <App key={`${r.kind}:${r.boardId}:${r.conversationId}`} src={mcpSource} embedded actions={actions}
      initialBoard={r.boardId || ""} initialRoom={r.conversationId || ""}
      only={full ? undefined : r.kind === "board-room" ? "room" : "kanban"} />
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><View /></StrictMode>);
