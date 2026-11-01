// Anonymised forecast prompts (pure, §6.3, §7.9, §7.10). The model sees an asset code, closes rebased so
// day 0 = 100.00, the features and the regime: no tickers, dates, weekdays, absolute prices or volumes.
// Recalled memories reach the prompt as bodies only; their headers carry tickers and dates (D18).
import type { Candle, Question } from "@tuition/shared";
import { regimeOf } from "../features/regime";
import { indexOfDate } from "../questions/generate";

export const CLOSE_DAYS = 60;
export const RANGE_DAYS = 10;
export const NO_LESSONS = "No lessons are available.";

export const FORECAST_SYSTEM = [
  "You are a calibrated forecaster of short-term price moves.",
  "You see anonymised, rebased data only: no asset names, no dates, no absolute prices. Do not use outside knowledge about any real asset, market or date.",
  "Answer one yes/no question with your probability that the answer is YES.",
  "Base rates: DIRECTION questions resolve YES roughly half the time. BREAKOUT thresholds are set so that YES happened roughly half the time historically.",
  "If a calibration snapshot is provided, use it to correct known over- or under-forecasting.",
  "If lessons are provided, apply a lesson only if its conditions match this question, and list the blob IDs of the lessons you actually used in cited_lessons.",
  'Output strict JSON: {"probability": number between 0 and 1, "rationale": "at most 60 words", "cited_lessons": ["blobId", ...]}.',
].join("\n");

export interface PromptLesson {
  blobId: string;
  body: string;
}

export interface ForecastPromptInput {
  question: Question;
  candles: readonly Candle[];
  horizon: number;
  /** undefined → the memory-OFF prompt ("No lessons are available."). */
  lessons?: readonly PromptLesson[];
  calibration?: string;
}

const f2 = (x: number): string => x.toFixed(2);
const pct = (x: number): string => `${x.toFixed(2)}%`;

/** A memory body is prompt-safe when it names no configured ticker and carries no calendar date. */
export function isPromptSafe(text: string, tickers: readonly string[]): boolean {
  if (/\b(19|20)\d\d-\d\d(-\d\d)?\b/.test(text)) return false;
  return !tickers.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

export function questionText(q: Question, horizon: number): string {
  if (q.type === "DIRECTION") return `DIRECTION: Will the close on day +${horizon} be higher than the close on day 0?`;
  const t = q.threshold ?? 0;
  return (
    `BREAKOUT: At any point in the next ${horizon} days, will price trade at least ${(t * 100).toFixed(1)}% away from ` +
    `the day 0 close, in either direction (a high at or above ${f2(100 * (1 + t))} or a low at or below ${f2(100 * (1 - t))})?`
  );
}

/** §7.9 recall query: a sentence built from the question's type and regime. */
export function recallQuery(q: Question): string {
  const f = q.features;
  return (
    `${q.type} question; trend ${f.trend}; volatility ${f.volRegime} and ${f.volTrend}; ` +
    `drawdown ${Math.round(f.drawdown30)}%; last day range ${f.lastRange.toFixed(1)}%`
  );
}

export function renderForecastPrompt(input: ForecastPromptInput): { system: string; user: string } {
  const { question: q, candles: c, horizon } = input;
  const d = indexOfDate(c, q.decisionDate);
  if (d < CLOSE_DAYS - 1) throw new Error(`need ${CLOSE_DAYS} candles up to ${q.decisionDate}`);
  const base = c[d]!.close;
  const rb = (x: number): string => f2((100 * x) / base);

  const closes: string[] = [];
  for (let k = CLOSE_DAYS - 1; k >= 0; k--) closes.push(`day ${k === 0 ? "0" : `-${k}`} ${rb(c[d - k]!.close)}`);
  const ranges: string[] = [];
  for (let k = RANGE_DAYS - 1; k >= 0; k--) {
    const x = c[d - k]!;
    ranges.push(`day ${k === 0 ? "0" : `-${k}`}: high ${rb(x.high)}, low ${rb(x.low)}`);
  }

  const f = q.features;
  const lines = [
    `Asset: ${q.assetCode}`,
    "",
    `Daily closes, rebased so day 0 = 100.00 (oldest first):`,
    closes.join(", "),
    "",
    `Daily highs and lows, last ${RANGE_DAYS} days, rebased the same way:`,
    ranges.join("; "),
    "",
    "Features on day 0:",
    `ret7 ${pct(f.ret7)}, ret30 ${pct(f.ret30)}, vol7 ${pct(f.vol7)}, vol30 ${pct(f.vol30)}, volRatio ${f2(f.volRatio)}, ` +
      `smaDist20 ${pct(f.smaDist20)}, smaSlope20 ${pct(f.smaSlope20)}, drawdown30 ${pct(f.drawdown30)}, lastRange ${pct(f.lastRange)}`,
    `Regime: trend ${f.trend}, volatility ${f.volRegime}, volatility ${f.volTrend} (${regimeOf(f)})`,
    "",
    `Question: ${questionText(q, horizon)}`,
    "",
  ];

  if (input.lessons === undefined) {
    lines.push(NO_LESSONS);
  } else {
    lines.push(
      input.lessons.length === 0
        ? "Lessons from my memory: none matched this question."
        : [
            "Lessons from my memory (apply a lesson only if its conditions match this question; list the blob IDs you actually used in cited_lessons):",
            ...input.lessons.map((l, i) => `${i + 1}. [${l.blobId}] ${l.body}`),
          ].join("\n"),
    );
    if (input.calibration) lines.push("", "My latest calibration snapshot:", input.calibration);
  }
  lines.push("", "Reply with the JSON object only.");
  return { system: FORECAST_SYSTEM, user: lines.join("\n") };
}
