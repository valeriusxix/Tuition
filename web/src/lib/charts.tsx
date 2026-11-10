// Shared chart parts. The series meanings are fixed on every page:
//   memory ON  = paper, the brightest line on the page
//   memory OFF = slate (the second OFF pass: slate, dashed)
//   coin flip / perfect calibration = rule-2, dotted
// The pen is never a series: it marks corrections only.
import { useEffect, useState, type ReactNode } from "react";

export const SERIES = { on: "#ece7da", off: "#8c9bb3", neutral: "#5b5e58" } as const;
export const INK = { axis: "#a9a69b", grid: "#2b2d29", surface: "#1b1c1a" } as const;
export const AXIS_TICK = { fill: INK.axis, fontSize: 11, fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace" };
export const LABEL = { fill: INK.axis, fontSize: 11, fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif" };

/** True when the media query matches; false on first render. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; dotted?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-paper-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-6 border-t-2"
            style={{ borderColor: i.color, borderTopStyle: i.dotted ? "dotted" : i.dashed ? "dashed" : "solid" }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-sm border border-rule-2 bg-ink-2 px-3 py-2 text-sm">
      <p className="text-paper-2">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="mt-1 flex items-center justify-between gap-6 text-paper">
          <span className="flex items-center gap-2">
            {r.color && <span aria-hidden className="inline-block h-0 w-4 border-t-2" style={{ borderColor: r.color }} />}
            {r.label}
          </span>
          <span className="font-mono">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
