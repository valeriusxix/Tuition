// UTC calendar-date helpers. Dates are "YYYY-MM-DD" strings; times are epoch ms.

export const DAY_MS = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return formatDate(ms) === date; // rejects 2026-02-30 and similar
}

/** "YYYY-MM-DD" → epoch ms at 00:00:00Z. Throws on an invalid date. */
export function parseDate(date: string): number {
  if (!isValidDate(date)) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`);
  const m = DATE_RE.exec(date)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Epoch ms → "YYYY-MM-DD" (UTC). */
export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return formatDate(parseDate(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

export function isMonday(date: string): boolean {
  return new Date(parseDate(date)).getUTCDay() === 1;
}

/** Every Monday from `start` to `end` inclusive. */
export function mondaysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let ms = parseDate(start);
  const endMs = parseDate(end);
  while (new Date(ms).getUTCDay() !== 1) ms += DAY_MS;
  for (; ms <= endMs; ms += 7 * DAY_MS) out.push(formatDate(ms));
  return out;
}

/** Epoch ms → ISO-8601 UTC without milliseconds, e.g. "2026-03-01T00:00:00Z" (Tatum query format). */
export function toIsoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The UTC calendar date before `now`, i.e. the day of the last closed daily candle. */
export function yesterdayUtc(now: Date = new Date()): string {
  return formatDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS);
}
