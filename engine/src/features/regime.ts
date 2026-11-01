// §6.2 features for decision day index d, using only candles[0..d] (pure). Candles must be daily,
// ascending and contiguous; callers check contiguity first (questions/generate.ts).
import type { Candle, Features, Trend, VolRegime, VolTrend } from "@tuition/shared";

/** vol7's 180-day median needs vol7 on day d-180, i.e. returns back to day d-187. */
export const MIN_HISTORY_DAYS = 187;
/** Volatilities (in %) below this are floating-point noise, treated as zero for ratios. */
const VOL_EPS = 1e-9;

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function sampleStdev(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error("median of an empty list");
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Sample stdev of the `days` daily log returns ending at index i, in %. */
export function volatility(c: readonly Candle[], i: number, days: number): number {
  const r: number[] = [];
  for (let k = i - days + 1; k <= i; k++) r.push(Math.log(c[k]!.close / c[k - 1]!.close));
  return sampleStdev(r) * 100;
}

export function sma(c: readonly Candle[], i: number, n: number): number {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += c[k]!.close;
  return s / n;
}

export function computeFeatures(c: readonly Candle[], d: number): Features {
  if (d < MIN_HISTORY_DAYS) throw new Error(`need ${MIN_HISTORY_DAYS} days of history before index ${d}`);
  if (d >= c.length) throw new Error(`index ${d} is past the last candle`);
  const close = c[d]!.close;

  const ret7 = (close / c[d - 7]!.close - 1) * 100;
  const ret30 = (close / c[d - 30]!.close - 1) * 100;
  const vol7 = volatility(c, d, 7);
  const vol30 = volatility(c, d, 30);
  const volRatio = vol30 > VOL_EPS ? vol7 / vol30 : 1;
  const sma20 = sma(c, d, 20);
  const smaDist20 = (close / sma20 - 1) * 100;
  const smaSlope20 = (sma20 / sma(c, d - 5, 20) - 1) * 100;
  let high30 = -Infinity;
  for (let k = d - 29; k <= d; k++) high30 = Math.max(high30, c[k]!.high);
  const drawdown30 = Math.max(0, (1 - close / high30) * 100);
  const lastRange = ((c[d]!.high - c[d]!.low) / close) * 100;

  const trend: Trend = smaDist20 > 2 && smaSlope20 > 0 ? "up" : smaDist20 < -2 && smaSlope20 < 0 ? "down" : "flat";
  const history: number[] = [];
  for (let k = d - 180; k <= d - 1; k++) history.push(volatility(c, k, 7));
  const typicalVol7 = median(history);
  const volRegime: VolRegime =
    typicalVol7 <= VOL_EPS ? "normal" : vol7 < 0.75 * typicalVol7 ? "low" : vol7 > 1.33 * typicalVol7 ? "high" : "normal";
  const volTrend: VolTrend = volRatio > 1.2 ? "expanding" : volRatio < 0.8 ? "contracting" : "stable";

  return {
    ret7: round2(ret7),
    ret30: round2(ret30),
    vol7: round2(vol7),
    vol30: round2(vol30),
    volRatio: round2(volRatio),
    smaDist20: round2(smaDist20),
    smaSlope20: round2(smaSlope20),
    drawdown30: round2(drawdown30),
    lastRange: round2(lastRange),
    trend,
    volRegime,
    volTrend,
  };
}

export function regimeOf(f: Pick<Features, "trend" | "volRegime" | "volTrend">): string {
  return `${f.trend}/${f.volRegime}/${f.volTrend}`;
}
