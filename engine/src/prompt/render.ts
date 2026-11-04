// Anonymised forecast and reflection prompts (pure, §6.3, §7.5, §7.9, §7.10). The model sees an asset code, closes rebased so
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

/** The anonymised market context shared by the forecast and reflection prompts (no lessons, no question). */
function contextLines(q: Question, c: readonly Candle[]): { lines: string[]; d: number; rb: (x: number) => string } {
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
  ];
  return { lines, d, rb };
}

export function renderForecastPrompt(input: ForecastPromptInput): { system: string; user: string } {
  const { question: q, candles: c, horizon } = input;
  const { lines } = contextLines(q, c);
  lines.push("", `Question: ${questionText(q, horizon)}`, "");

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

// ── §7.5 reflection (post-mortem) prompt ─────────────────────────────────────

export const LESSON_MAX_CHARS = 280;
export const APPLIES_WHEN_MAX_CHARS = 120;
export const MAX_MAGNITUDE = 0.3;

export const REFLECT_SYSTEM = [
  "You are reviewing one of your own past forecasts after its outcome became known, to write one short lesson for your future self.",
  "You see anonymised, rebased data only: no asset names, no dates, no absolute prices. Never mention a real asset, ticker, calendar date, weekday or absolute price.",
  "Generalise beyond this single case: write a rule about this kind of regime (trend, volatility level, volatility trend and the feature values), not a story about this one question.",
  "If the miss looks like bad luck rather than bad reasoning (the setup carried no reliable signal, or a sudden move came from nowhere), say so in the lesson and use \"adjustment\": \"none\" with magnitude 0.",
  `adjustment is the direction to move P(YES) next time in matching conditions ("raise", "lower" or "none"); magnitude is by how much, between 0 and ${MAX_MAGNITUDE}.`,
  `Output strict JSON: {"lesson": "at most ${LESSON_MAX_CHARS} characters, a general rule written in the first person", ` +
    `"applies_when": "at most ${APPLIES_WHEN_MAX_CHARS} characters: the conditions, in terms of the feature names (trend, volRegime, volTrend, volRatio, ret7, ret30, vol7, vol30, smaDist20, smaSlope20, drawdown30, lastRange)", ` +
    `"adjustment": "raise" | "lower" | "none", "magnitude": number}.`,
].join("\n");

export interface ReflectionPromptInput {
  question: Question;
  candles: readonly Candle[];
  horizon: number;
  p: number;
  rationale: string;
  outcome: 0 | 1;
}

/**
 * The post-mortem prompt. It may show the realised path (days +1..+horizon, rebased like the history),
 * because its output is only stored for later questions, never shown to this question's forecast (§7.4).
 */
export function renderReflectionPrompt(input: ReflectionPromptInput): { system: string; user: string } {
  const { question: q, candles: c, horizon, p, outcome } = input;
  const { lines, d, rb } = contextLines(q, c);
  if (d + horizon >= c.length) throw new Error(`need candles through day +${horizon} after ${q.decisionDate}`);

  const path: string[] = [];
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = 1; k <= horizon; k++) {
    const x = c[d + k]!;
    hi = Math.max(hi, x.high);
    lo = Math.min(lo, x.low);
    path.push(`day +${k}: close ${rb(x.close)}, high ${rb(x.high)}, low ${rb(x.low)}`);
  }
  const base = c[d]!.close;
  const up = (100 * hi) / base - 100;
  const down = (100 * lo) / base - 100;

  lines.push(
    "",
    `Question: ${questionText(q, horizon)}`,
    "",
    `My forecast: P(YES) = ${p.toFixed(2)}. My rationale: ${input.rationale}`,
    `Outcome: ${outcome === 1 ? "YES" : "NO"}. My Brier score on this question: ${((p - outcome) ** 2).toFixed(3)} (a coin flip scores 0.250).`,
    "",
    "What happened next, rebased the same way (day 0 = 100.00):",
    path.join("; "),
    `Largest move up: ${up >= 0 ? "+" : ""}${up.toFixed(2)}%. Largest move down: ${down.toFixed(2)}%. ` +
      `Close on day +${horizon}: ${rb(c[d + horizon]!.close)}.`,
    "",
    "Write the lesson. Reply with the JSON object only.",
  );
  return { system: REFLECT_SYSTEM, user: lines.join("\n") };
}
