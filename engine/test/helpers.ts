import type { Candle } from "@tuition/shared";
import { DAY_MS, parseDate } from "../src/util/dates";

/**
 * Daily candles from a close series: open = previous close, high/low = max/min(open, close) widened by
 * `spread` (a fraction). Starts at `start` (YYYY-MM-DD).
 */
export function candlesFromCloses(closes: readonly number[], start = "2025-01-01", spread = 0): Candle[] {
  const t0 = parseDate(start);
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return {
      t: t0 + i * DAY_MS,
      open,
      high: Math.max(open, close) * (1 + spread),
      low: Math.min(open, close) * (1 - spread),
      close,
    };
  });
}

export const geometric = (n: number, start: number, factor: number): number[] =>
  Array.from({ length: n }, (_, i) => start * factor ** i);

/** Closes whose daily log returns alternate +a, −a (starting with +a). */
export function alternating(n: number, start: number, a: number): number[] {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * Math.exp(i % 2 === 1 ? a : -a));
  return out;
}
