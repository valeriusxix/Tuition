// Question outcomes (pure). DIRECTION: close[d+h] > close[d]. BREAKOUT: any high ≥ close[d]·(1+θ) or
// any low ≤ close[d]·(1−θ) over days d+1..d+h (§6.3).
import type { Candle, Question } from "@tuition/shared";
import { indexOfDate, isContiguous } from "./generate";

/** 0 or 1, or undefined while the resolution window is not fully available. */
export function resolveOutcome(
  q: Pick<Question, "type" | "decisionDate" | "threshold">,
  c: readonly Candle[],
  horizon: number,
): 0 | 1 | undefined {
  const d = indexOfDate(c, q.decisionDate);
  if (d < 0 || !isContiguous(c, d, d + horizon)) return undefined;
  const close = c[d]!.close;
  if (q.type === "DIRECTION") return c[d + horizon]!.close > close ? 1 : 0;
  if (q.threshold === undefined) throw new Error(`BREAKOUT question on ${q.decisionDate} has no threshold`);
  for (let k = d + 1; k <= d + horizon; k++) {
    if (c[k]!.high >= close * (1 + q.threshold) || c[k]!.low <= close * (1 - q.threshold)) return 1;
  }
  return 0;
}

/** Copies of the questions with every resolvable outcome filled in. */
export function resolveAll(
  questions: readonly Question[],
  candles: ReadonlyMap<string, readonly Candle[]>,
  horizon: number,
): Question[] {
  return questions.map((q) => {
    const c = candles.get(q.symbol);
    const outcome = c ? resolveOutcome(q, c, horizon) : undefined;
    return outcome === undefined ? q : { ...q, outcome };
  });
}
