import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { httpSource } from "./source";
import "./tokens.css";
import "./app.css";
import "@openscout/workspace-ui/tabs.css";
import "@openscout/workspace-ui/feedback.css";
import "@openscout/workspace-ui/feedback";

const q = new URLSearchParams(window.location.search);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App src={httpSource} initialBoard={q.get("board") || ""} initialRoom={q.get("room") || ""} />
  </StrictMode>,
);
