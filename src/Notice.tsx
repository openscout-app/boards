// A pane's plain message: what is missing, and the one thing to do about it.
import { useState, type ReactNode } from "react";
import { Copy, Check } from "./icons";

export function Notice({ title, children, quiet }: { title: string; children?: ReactNode; quiet?: boolean }) {
  return (
    <div className={`notice${quiet ? " quiet" : ""}`} role="status">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };
  return (
    <div className="command">
      <code>{text}</code>
      <button type="button" className="icon-btn" onClick={copy} aria-label={copied ? "Copied" : "Copy the command"} title={copied ? "Copied" : "Copy"}>
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  );
}
Notice.Command = Command;
