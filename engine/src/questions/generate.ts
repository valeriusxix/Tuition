// §6.3 question generation (pure): every Monday × symbol gets a DIRECTION and a BREAKOUT question.
import type { Candle, Question, QuestionType, Split } from "@tuition/shared";
import { computeFeatures, median, MIN_HISTORY_DAYS } from "../features/regime";
import { addDays, DAY_MS, mondaysBetween, parseDate } from "../util/dates";
import { mulberry32, shuffle } from "../util/rng";

export const ASSET_CODES = ["Asset A", "Asset B", "Asset C", "Asset D", "Asset E", "Asset F"] as const;
export const QUESTION_TYPES: readonly QuestionType[] = ["DIRECTION", "BREAKOUT"];
const THRESHOLD_LOOKBACK = 180;

/** Fixed symbol → "Asset X" map from a seeded shuffle of the configured symbols (stable across runs and live). */
export function assetCodeMap(symbols: readonly string[], seed: number): Map<string, string> {
  if (symbols.length > ASSET_CODES.length) throw new Error(`at most ${ASSET_CODES.length} symbols are supported`);
  return new Map(shuffle(symbols, mulberry32(seed)).map((s, i) => [s, ASSET_CODES[i]!]));
}

export function questionId(type: QuestionType, symbol: string, decisionDate: string): string {
  return `${type}-${symbol}-${decisionDate}`;
}

/** Index of the candle opening at `date`, or -1. */
export function indexOfDate(c: readonly Candle[], date: string): number {
  const t = parseDate(date);
  const first = c[0];
  if (!first) return -1;
  const guess = Math.round((t - first.t) / DAY_MS); // exact when contiguous
  if (c[guess]?.t === t) return guess;
  return c.findIndex((x) => x.t === t);
}

/** True when candles[from..to] are consecutive days. */
export function isContiguous(c: readonly Candle[], from: number, to: number): boolean {
  if (from < 0 || to >= c.length) return false;
  for (let i = from + 1; i <= to; i++) if (c[i]!.t - c[i - 1]!.t !== DAY_MS) return false;
  return true;
}

/** Largest |move| from close[s] reached by any high or low over the next `horizon` days. */
export function maxExcursion(c: readonly Candle[], s: number, horizon: number): number {
  const base = c[s]!.close;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = s + 1; k <= s + horizon; k++) {
    hi = Math.max(hi, c[k]!.high);
    lo = Math.min(lo, c[k]!.low);
  }
  return Math.max(hi / base - 1, 1 - lo / base);
}

/**
 * BREAKOUT threshold (§6.3): median max excursion of the 180 most recent `horizon`-day windows that
 * END on or before day d, so no future data is used. Rounded to 3 decimals.
 */
export function breakoutThreshold(c: readonly Candle[], d: number, horizon: number): number {
  const xs: number[] = [];
  for (let end = d - THRESHOLD_LOOKBACK + 1; end <= d; end++) xs.push(maxExcursion(c, end - horizon, horizon));
  return Math.round(median(xs) * 1000) / 1000;
}

/** Days of history a decision needs: features (187) and the threshold windows (180 + horizon - 1). */
export function historyNeeded(horizon: number): number {
  return Math.max(MIN_HISTORY_DAYS, THRESHOLD_LOOKBACK + horizon - 1);
}

export interface Skipped {
  id: string;
  reason: string;
}

/** Both questions for one symbol on one decision date, or the reason they cannot be asked. */
export function questionsFor(args: {
  symbol: string;
  assetCode: string;
  candles: readonly Candle[];
  decisionDate: string;
  split: Split;
  horizon: number;
  needFuture: boolean; // replay questions must be resolvable from the cache; live questions resolve later
}): { questions: Question[]; skipped: Skipped[] } {
  const { symbol, assetCode, candles: c, decisionDate, split, horizon } = args;
  const ids = QUESTION_TYPES.map((type) => questionId(type, symbol, decisionDate));
  const skip = (reason: string) => ({ questions: [], skipped: ids.map((id) => ({ id, reason })) });

  const d = indexOfDate(c, decisionDate);
  if (d < 0) return skip(`no candle for ${decisionDate}`);
  const from = d - historyNeeded(horizon);
  const to = args.needFuture ? d + horizon : d;
  if (from < 0) return skip(`fewer than ${historyNeeded(horizon)} days of history`);
  if (to >= c.length) return skip(`no candles through ${addDays(decisionDate, horizon)} yet`);
  if (!isContiguous(c, from, to)) return skip("gap in daily candles inside the question window");

  const features = computeFeatures(c, d);
  const base = { symbol, assetCode, decisionDate, resolveDate: addDays(decisionDate, horizon), split, features };
  return {
    questions: [
      { id: ids[0]!, type: "DIRECTION", ...base },
      { id: ids[1]!, type: "BREAKOUT", threshold: breakoutThreshold(c, d, horizon), ...base },
    ],
    skipped: [],
  };
}

export interface ReplayQuestionInput {
  candles: ReadonlyMap<string, readonly Candle[]>;
  symbols: readonly string[]; // configured order; fixes the asset codes
  start: string;
  end: string;
  devSplitEnd: string;
  horizon: number;
  seed: number;
}

/** All replay questions, in (decision date, configured symbol order, type) order. */
export function generateQuestions(input: ReplayQuestionInput): { questions: Question[]; skipped: Skipped[] } {
  const codes = assetCodeMap(input.symbols, input.seed);
  const questions: Question[] = [];
  const skipped: Skipped[] = [];
  for (const decisionDate of mondaysBetween(input.start, input.end)) {
    for (const symbol of input.symbols) {
      const candles = input.candles.get(symbol);
      if (!candles) continue; // symbol dropped (not supported)
      const r = questionsFor({
        symbol,
        assetCode: codes.get(symbol)!,
        candles,
        decisionDate,
        split: decisionDate <= input.devSplitEnd ? "dev" : "test",
        horizon: input.horizon,
        needFuture: true,
      });
      questions.push(...r.questions);
      skipped.push(...r.skipped);
    }
  }
  return { questions, skipped };
}
