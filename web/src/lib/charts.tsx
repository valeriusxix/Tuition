// Shared chart parts. Series colors are validated against the dark surface (dataviz validator: all checks
// pass, worst CVD ΔE 13.8). The neutral is for reference series only.
import type { ReactNode } from "react";

export const SERIES = { on: "#0d9488", off: "#ea580c", neutral: "#8a8a8a" } as const;
export const INK = { axis: "#a3a3a3", grid: "#262626" } as const;
export const AXIS_TICK = { fill: INK.axis, fontSize: 12, fontFamily: "ui-monospace, Menlo, Consolas, monospace" };

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-300">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-5 border-t-2"
            style={{ borderColor: i.color, borderTopStyle: i.dashed ? "dashed" : "solid" }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm shadow-lg">
      <p className="text-neutral-300">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="mt-1 flex items-center justify-between gap-4 text-neutral-200">
          <span className="flex items-center gap-2">
            {r.color && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-mono">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
