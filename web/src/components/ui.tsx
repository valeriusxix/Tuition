import { useState, type ReactNode } from "react";
import { AGGREGATOR } from "../lib/links";
import { shortBlob } from "../lib/format";
import type { Loaded } from "../lib/data";

export function Status({ results }: { results: Loaded<unknown>[] }) {
  const failed = results.find((r) => r.state === "error");
  if (failed && failed.state === "error") {
    return (
      <div role="alert" className="rounded border border-red-900 bg-red-950/40 p-4 text-red-200">
        <p className="font-medium">This page's data could not be loaded.</p>
        <p className="mt-1 font-mono text-sm">{failed.message}</p>
      </div>
    );
  }
  return <p className="text-neutral-400">Loading…</p>;
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold text-neutral-50">{title}</h1>
      {children && <div className="mt-2 max-w-2xl text-neutral-300">{children}</div>}
    </header>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-medium text-neutral-100">{title}</h2>
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/60 p-4">
      <p className="text-sm text-neutral-400">{label}</p>
      <p className="mt-1 font-mono text-3xl text-neutral-50">{value}</p>
      {note && <div className="mt-2 text-sm text-neutral-300">{note}</div>}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300">{children}</span>;
}

export function BlobLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2 font-mono text-sm">
      <a className="text-accent underline-offset-2 hover:underline" href={`${AGGREGATOR}/v1/blobs/${encodeURIComponent(id)}`} title={`${id} (encrypted bytes on the Walrus aggregator)`}>
        {shortBlob(id)}
      </a>
      <button type="button" onClick={copy} className="rounded border border-neutral-700 px-1.5 py-0.5 font-sans text-xs text-neutral-300 hover:border-neutral-500">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** Wide tables scroll inside this box, so the page itself never scrolls sideways. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded border border-neutral-800">{children}</div>;
}

export const TH = "px-3 py-2 text-left font-medium text-neutral-400 whitespace-nowrap";
export const TD = "px-3 py-2 text-neutral-200 whitespace-nowrap";
export const TDN = `${TD} font-mono text-right`;
export const THN = `${TH} text-right`;
export const SELECT = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200";
