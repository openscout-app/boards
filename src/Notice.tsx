// A pane's plain message: what is missing, and the one thing to do about it.
import { useState, type ReactNode } from "react";
import { Copy, Check } from "./icons";

export function Notice({ title, children, quiet, colophon }: { title: string; children?: ReactNode; quiet?: boolean; colophon?: boolean }) {
  return (
    <div className={`notice${quiet ? " quiet" : ""}${colophon ? " colophon" : ""}`} role="status">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Command({ text }: { text: string }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  };
  return (
    <div>
      <div className="command">
        <code>{text}</code>
        <button type="button" className="btn primary" onClick={() => void copy()}>
          {result === "copied" ? <><Check />Copied</> : <><Copy />Copy</>}
        </button>
      </div>
      {result === "failed" && <p>Couldn’t copy. Select and copy the command manually.</p>}
    </div>
  );
}
Notice.Command = Command;
