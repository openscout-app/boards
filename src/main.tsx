import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ScoutAppFrame,
  StandaloneRecordRouter,
  navigateBrowser,
  useScoutThinHost,
  type ScoutThinStatusBase,
} from "scout-app/shell";
import "scout-app/shell.css";
import { App, initialArea, type Area } from "./App";
import { httpSource } from "./source";
import "./tokens.css";
import "./app.css";

interface BoardsHostStatus extends ScoutThinStatusBase {
  localSessions: number;
}

function StandaloneBoardsApp() {
  const q = new URLSearchParams(window.location.search);
  const [area, setArea] = useState<Area>(() => initialArea(Boolean(q.get("room"))));
  const { status, installing, runSetup } = useScoutThinHost<BoardsHostStatus>({
    statusPath: "/api/host-status",
  });

  const badge = !status
    ? { label: "Checking Scout", tone: "loading" as const }
    : status.runtimeUp
      ? { label: "Runtime connected", tone: "ready" as const, detail: status.runtimeUrl }
      : { label: `Local activity · ${status.localSessions}`, tone: "local" as const, detail: "Scout runtime not running" };

  const callout =
    status && !status.runtimeUp
      ? {
          title: "Scout runtime is not running yet.",
          description:
            "Local agent sessions populate the activity board below. Start Scout's runtime for persistent Kanban moves, reviews, and Vercel Board rooms.",
          command: "npx openscout-app/boards setup",
          actionLabel: installing ? "Starting…" : "Start runtime",
          onAction: installing ? undefined : () => void runSetup(),
        }
      : null;

  const areaSwitch = status?.runtimeUp ? (
    <div className="boards-masthead-tabs" role="tablist" aria-label="Boards area">
      <button
        type="button"
        role="tab"
        aria-selected={area === "board"}
        className="boards-masthead-tab"
        onClick={() => {
          setArea("board");
          if (window.location.pathname !== "/") navigateBrowser("/?area=board");
        }}
      >
        Board
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={area === "conversations"}
        className="boards-masthead-tab"
        onClick={() => {
          setArea("conversations");
          if (window.location.pathname !== "/") navigateBrowser("/?area=conversations");
        }}
      >
        Conversations
      </button>
    </div>
  ) : null;

  return (
    <ScoutAppFrame
      product="Boards"
      variant="board"
      rail="wide"
      status={badge}
      setupCallout={callout}
      headerActions={areaSwitch}
    >
      <StandaloneRecordRouter product="Boards" rail="wide" navigate={navigateBrowser}>
        <App
          src={httpSource}
          initialBoard={q.get("board") || ""}
          initialRoom={q.get("room") || ""}
          area={area}
          onAreaChange={setArea}
          onOpenSession={(sessionId) => navigateBrowser(`/sessions/${encodeURIComponent(sessionId)}`)}
          onOpenExchange={(conversationId, workId) =>
            navigateBrowser(`/c/${encodeURIComponent(conversationId)}?workId=${encodeURIComponent(workId)}`)
          }
        />
      </StandaloneRecordRouter>
    </ScoutAppFrame>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StandaloneBoardsApp />
  </StrictMode>,
);
