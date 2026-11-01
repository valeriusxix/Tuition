// §7.6 memory text (pure): one machine-readable header line, then the human-readable body that the
// relayer embeds. Example:
// [TUITION v1|kind=lesson|run=r-20261101-0930-a1b2|q=BREAKOUT-SOL-2026-04-13|type=BREAKOUT|regime=down/high/expanding|sim=2026-04-20|adj=raise|mag=0.15]
// LESSON (BREAKOUT, downtrend, high volatility, volatility expanding): When volatility is expanding ...
import type { MemoryLedgerEntry } from "@tuition/shared";

export const MAX_MEMORY_CHARS = 1000;
const PREFIX = "[TUITION v1|";
const KINDS: readonly MemoryKind[] = ["lesson", "calibration", "forecast", "smoke"];
const FIELD_ORDER = ["run", "q", "sym", "type", "regime", "sim", "resolves", "p", "adj", "mag", "n"];

export type MemoryKind = MemoryLedgerEntry["kind"];

export interface MemoryHeader {
  kind: MemoryKind;
  fields: Record<string, string>;
}

const rank = (k: string): number => {
  const i = FIELD_ORDER.indexOf(k);
  return i < 0 ? FIELD_ORDER.length : i;
};

export function encodeMemory(kind: MemoryKind, fields: Record<string, string | number | undefined>, body: string): string {
  const parts = [`kind=${kind}`];
  for (const key of Object.keys(fields).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    const value = fields[key];
    if (value === undefined) continue;
    const s = String(value);
    if (!/^[a-z]+$/i.test(key) || /[|\]\n\r]/.test(s)) throw new Error(`header field ${key} has a reserved character`);
    parts.push(`${key}=${s}`);
  }
  const text = `${PREFIX}${parts.join("|")}]\n${body.trim()}`;
  if (text.length > MAX_MEMORY_CHARS) throw new Error(`memory text is ${text.length} characters; the limit is ${MAX_MEMORY_CHARS}`);
  return text;
}

/** The header of a Tuition memory, tolerating missing optional fields; null for any other text. */
export function decodeHeader(text: string): MemoryHeader | null {
  const nl = text.indexOf("\n");
  const first = (nl < 0 ? text : text.slice(0, nl)).trim();
  if (!first.startsWith(PREFIX) || !first.endsWith("]")) return null;
  const fields: Record<string, string> = {};
  for (const part of first.slice(PREFIX.length, -1).split("|")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const kind = fields.kind as MemoryKind | undefined;
  if (!kind || !KINDS.includes(kind)) return null;
  delete fields.kind;
  return { kind, fields };
}

/** The body without the header line: the only part of a memory that may reach a forecast prompt (D18). */
export function memoryBody(text: string): string {
  if (!decodeHeader(text)) return text.trim();
  const nl = text.indexOf("\n");
  return nl < 0 ? "" : text.slice(nl + 1).trim();
}
