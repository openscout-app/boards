// Thin 16px glyphs, drawn for Boards: one stroke, no fill, square to the pixel grid.
import type { ReactNode } from "react";

function G({ children, size = 16, label }: { children: ReactNode; size?: number; label?: string }) {
  return (
    <svg className="g" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined}>
      {children}
    </svg>
  );
}

export const More = () => <G><circle cx="3.5" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="8" r=".6" fill="currentColor" /><circle cx="12.5" cy="8" r=".6" fill="currentColor" /></G>;
export const Close = () => <G><path d="M4 4l8 8M12 4l-8 8" /></G>;
export const Caret = () => <G size={12}><path d="M4.5 6.5 8 10l3.5-3.5" /></G>;
export const Check = () => <G size={12}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></G>;
export const Arrow = () => <G size={12}><path d="M3 8h10M9 4l4 4-4 4" /></G>;
export const Copy = () => <G size={14}><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 3.5v-1h-8v8h1" /></G>;
export const External = () => <G size={14}><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" /></G>;
/** Two panes in a window: the full page holds the Kanban and the Board room side by side. */
export const PopOut = () => <G size={14}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M9.5 3v10" /></G>;
export const Expand = ({ out }: { out: boolean }) => (
  <G size={14}>{out
    ? <path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M6.5 6.5 2.5 2.5M9.5 9.5l4 4" />
    : <path d="M2.5 6.5v-4h4M13.5 9.5v4h-4M2.5 2.5l4 4M13.5 13.5l-4-4" />}</G>
);
export const Kanban = () => <G size={14}><path d="M2.5 2.5v11M8 2.5v11M13.5 2.5v11" /><rect x="3.5" y="4" width="3.5" height="3" rx=".5" /><rect x="9" y="4" width="3.5" height="5" rx=".5" /></G>;
export const Thread = () => <G size={14}><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></G>;
export const Tasks = () => <G size={14}><path d="M2.5 4h1.5M2.5 8h1.5M2.5 12h1.5M6.5 4h7M6.5 8h7M6.5 12h7" /></G>;

/** Scout's mark: the hexagon around its solid core. */
export const ScoutMark = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="5 -4 214 244" aria-hidden>
    <path d="M103.01 13.21 Q112 8 120.99 13.21 L198.01 57.79 Q207 63 207 73.39 L207 162.61 Q207 173 198.01 178.21 L120.99 222.79 Q112 228 103.01 222.79 L25.99 178.21 Q17 173 17 162.61 L17 73.39 Q17 63 25.99 57.79 Z" fill="none" stroke="currentColor" strokeWidth="20" strokeLinejoin="round" />
    <path d="M112 70 154 94v48l-42 24-42-24V94Z" fill="currentColor" />
  </svg>
);
