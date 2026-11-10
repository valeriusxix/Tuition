import { useEffect, useState, type ReactNode } from "react";
import { AGGREGATOR } from "../lib/links";
import { shortBlob } from "../lib/format";
import type { Loaded } from "../lib/data";

/** Loading and error states for a page's data. */
export function Status({ results }: { results: Loaded<unknown>[] }) {
  const failed = results.find((r) => r.state === "error");
  if (failed && failed.state === "error") {
    return (
      <div role="alert" className="max-w-xl border-l-2 border-pen pl-4">
        <p className="display text-2xl">This page's data could not be loaded.</p>
        <p className="mt-2 font-mono text-sm text-paper-2">{failed.message}</p>
        <p className="mt-3 text-paper-2">Every number on this site comes from JSON files written by the engine; this one is missing or malformed.</p>
      </div>
    );
  }
  return (
    <p className="text-paper-2" aria-live="polite">
      Loading…
    </p>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 max-w-3xl">
      <h1 className="display text-4xl sm:text-5xl">{title}</h1>
      {children && <div className="mt-4 text-lg text-paper-2">{children}</div>}
    </header>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rule-t mt-12 pt-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="display text-2xl">{title}</h2>
        {aside && <div className="text-sm text-paper-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A figure with its label: no box, the number carries the weight. */
export function Stat({ label, value, note, size = "md" }: { label: string; value: ReactNode; note?: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-paper-2">{label}</p>
      <p className={`mt-1 font-mono text-paper ${size === "lg" ? "text-4xl sm:text-5xl" : size === "sm" ? "text-2xl" : "text-3xl"}`}>{value}</p>
      {note && <div className="mt-2 text-sm text-paper-2">{note}</div>}
    </div>
  );
}

/**
 * The correction mark: the memory-OFF value struck through, the memory-ON value beside it with a pen
 * stroke, the way a teacher corrects a paper. Reads left to right: what it was, what memory made it.
 */
export function Mark({ off, on, className = "" }: { off: string; on: string; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[0.45em] font-mono ${className}`}>
      <s className="mark-old">{off}</s>
      <span className="mark-new text-paper">{on}</span>
    </span>
  );
}

export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "pen" }) {
  return (
    <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs ${tone === "pen" ? "border-pen/60 text-pen" : "border-rule-2 text-paper-2"}`}>{children}</span>
  );
}

/** A labelled value with a dotted leader, like a ledger line. */
export function KV({ label, children, mono = true }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="leaders py-1.5 text-sm">
      <dt className="shrink-0 text-paper-2">{label}</dt>
      <dd className={`min-w-0 text-right break-all text-paper ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

/** A pass/fail line. The word is a stamp, the sentence is the evidence. */
export function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={`mt-0.5 shrink-0 rounded-sm border px-1.5 font-mono text-xs leading-5 ${ok ? "border-paper/50 text-paper" : "border-pen text-pen"}`} aria-label={ok ? "Pass" : "Fail"}>
        {ok ? "PASS" : "FAIL"}
      </span>
      <span className="text-paper">{children}</span>
    </li>
  );
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return [copied, (text) => void navigator.clipboard.writeText(text).then(() => setCopied(true))];
}

/** A copy button that stays small on screen but has a 44px hit area. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, copy] = useCopied();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={`${label} ${text}`}
      className="relative inline-flex h-7 items-center rounded-sm border border-rule-2 px-2 font-sans text-xs text-paper-2 before:absolute before:-inset-2 before:content-[''] hover:border-paper-2 hover:text-paper"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** A Walrus blob: truncated ID linking to the aggregator, plus copy. */
export function BlobLink({ id, full = false }: { id: string; full?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 font-mono text-sm">
      <a
        className="text-paper underline decoration-rule-2 underline-offset-2 hover:decoration-pen"
        href={`${AGGREGATOR}/v1/blobs/${encodeURIComponent(id)}`}
        title={`${id} (encrypted bytes on the Walrus aggregator)`}
      >
        {full ? id : shortBlob(id)}
      </a>
      <CopyButton text={id} />
    </span>
  );
}

/** A long hex ID: shown in full, wrapping, with copy. */
export function HexId({ id, href }: { id: string; href?: string }) {
  const text = <span className="font-mono text-sm break-all text-paper">{id}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {href ? (
        <a className="underline decoration-rule-2 underline-offset-2 hover:decoration-pen" href={href}>
          {text}
        </a>
      ) : (
        text
      )}
      <CopyButton text={id} />
    </span>
  );
}

/* ── Tables ──────────────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** On phones, this column becomes the card's title line. */
  title?: boolean;
  /** On phones, leave this column out of the card. */
  hideOnCard?: boolean;
}

/**
 * A table on wider screens and stacked ledger cards on phones, so no column is ever off-screen.
 * Rows may be links (`href`), in which case the whole row or card is clickable.
 */
export function StackTable<T>({ columns, rows, rowKey, href, empty = "Nothing to show." }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; href?: (row: T) => string; empty?: string }) {
  if (rows.length === 0) return <p className="text-paper-2">{empty}</p>;
  const title = columns.find((c) => c.title);
  const rest = columns.filter((c) => !c.title && !c.hideOnCard);
  return (
    <>
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="rule-b">
              {columns.map((c) => (
                <th key={c.key} className={`py-2 pr-4 font-normal whitespace-nowrap text-paper-2 last:pr-0 ${c.align === "right" ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className={`rule-b ${href ? "hover:bg-ink-2" : ""}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`py-2.5 pr-4 align-top last:pr-0 ${c.align === "right" ? "font-mono text-right" : "text-left"}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="sm:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="rule-b py-3">
            {title && <p className="mb-1 text-paper">{title.render(r)}</p>}
            <dl>
              {rest.map((c) => (
                <div key={c.key} className="leaders py-0.5 text-sm">
                  <dt className="shrink-0 text-paper-2">{c.label}</dt>
                  <dd className={`min-w-0 text-right text-paper ${c.align === "right" ? "font-mono" : ""}`}>{c.render(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Wide tables scroll inside this box, so the page itself never scrolls sideways. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export const TH = "py-2 pr-4 text-left font-normal text-paper-2 whitespace-nowrap last:pr-0";
export const TD = "py-2.5 pr-4 text-paper whitespace-nowrap last:pr-0";
export const TDN = `${TD} font-mono text-right`;
export const THN = `${TH} text-right`;
export const SELECT = "h-11 rounded-sm border border-rule-2 bg-ink px-3 text-sm text-paper hover:border-paper-2 sm:h-9";
export const INPUT = "h-11 min-w-0 rounded-sm border border-rule-2 bg-ink px-3 text-sm text-paper placeholder:text-paper-2/70 hover:border-paper-2 sm:h-9";
export const LINK = "text-paper underline decoration-rule-2 underline-offset-2 hover:decoration-pen";
