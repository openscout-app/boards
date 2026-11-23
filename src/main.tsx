import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { httpSource } from "./source";
import "./tokens.css";
import "./app.css";

const q = new URLSearchParams(window.location.search);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App src={httpSource} initialBoard={q.get("board") || ""} initialRoom={q.get("room") || ""} />
  </StrictMode>,
);
