import type { Question } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import { encodeMemory, memoryBody } from "../src/memory/format";
import { FORECAST_SYSTEM, isPromptSafe, NO_LESSONS, recallQuery, REFLECT_SYSTEM, renderForecastPrompt, renderReflectionPrompt } from "../src/prompt/render";
import { questionsFor } from "../src/questions/generate";
import { alternating, candlesFromCloses } from "./helpers";

const TICKERS = ["BTC", "ETH", "SOL", "SUI"];
// Raw prices with many significant digits, like real BTC closes, so no rebased number can match one by chance.
const closes = alternating(260, 43_210.57, Math.log(1.013)).map((x, i) => x * (1 + i * 0.0003));
const candles = candlesFromCloses(closes, "2025-08-14", 0.012);

function question(type: "DIRECTION" | "BREAKOUT"): Question {
  const { questions } = questionsFor({
    symbol: "SOL",
    assetCode: "Asset D",
    candles,
    decisionDate: "2026-04-13",
    split: "dev",
    horizon: 7,
    needFuture: false,
  });
  return questions.find((q) => q.type === type)!;
}

const numbersIn = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

function assertAnonymous(text: string): void {
  for (const t of TICKERS) expect(text).not.toMatch(new RegExp(`\\b${t}\\b`, "i"));
  expect(text).not.toMatch(/20\d\d-/);
  const raw = new Set(closes);
  for (const n of numbersIn(text)) expect(raw.has(n)).toBe(false);
}

describe("forecast prompt anonymisation (§6.3)", () => {
  it("contains no ticker, no date and no raw close: memory OFF", () => {
    for (const type of ["DIRECTION", "BREAKOUT"] as const) {
      const p = renderForecastPrompt({ question: question(type), candles, horizon: 7 });
      assertAnonymous(p.system + p.user);
      expect(p.user).toContain(NO_LESSONS);
      expect(p.user).toContain("Asset D");
    }
  });

  it("rebases so day 0 = 100.00 and labels 60 closes from day -59", () => {
    const p = renderForecastPrompt({ question: question("DIRECTION"), candles, horizon: 7 }).user;
    expect(p).toMatch(/day -59 \d+\.\d\d,/);
    expect(p).toMatch(/day 0 100\.00/);
    expect(p).not.toMatch(/day -60 /);
    expect(p).toMatch(/day -9: high \d+\.\d\d, low \d+\.\d\d/);
  });

  it("stays anonymous with recalled memories whose headers carry tickers and dates (D18)", () => {
    const text = encodeMemory(
      "lesson",
      { run: "r-1", q: "BREAKOUT-SOL-2026-04-06", type: "BREAKOUT", regime: "down/high/expanding", sim: "2026-04-13" },
      "LESSON (BREAKOUT, downtrend, high volatility): When volatility expands in a downtrend I underestimate large moves. Raise by about 0.1.",
    );
    const lessons = [{ blobId: "TRCb_82aCIZTmW8v58CWFcPw1zScALO1eyGOrZVhiRY", body: memoryBody(text) }];
    const p = renderForecastPrompt({ question: question("BREAKOUT"), candles, horizon: 7, lessons, calibration: "CALIBRATION SNAPSHOT after 16 resolved forecasts." });
    assertAnonymous(p.system + p.user);
    expect(p.user).toContain("[TRCb_82aCIZTmW8v58CWFcPw1zScALO1eyGOrZVhiRY] LESSON (BREAKOUT");
    expect(p.user).toContain("CALIBRATION SNAPSHOT");
    expect(p.user).not.toContain("TUITION v1");
  });

  it("uses the same system prompt for memory ON and OFF", () => {
    const off = renderForecastPrompt({ question: question("DIRECTION"), candles, horizon: 7 });
    const on = renderForecastPrompt({ question: question("DIRECTION"), candles, horizon: 7, lessons: [] });
    expect(on.system).toBe(off.system);
    expect(off.system).toBe(FORECAST_SYSTEM);
  });

  it("flags memory bodies that would leak a ticker or a date", () => {
    expect(isPromptSafe("When SOL dumps, raise", TICKERS)).toBe(false);
    expect(isPromptSafe("On 2026-04-13 I was wrong", TICKERS)).toBe(false);
    expect(isPromptSafe("A solution: raise when volatility expands", TICKERS)).toBe(true);
  });

  it("builds the recall query from type and regime only", () => {
    const q = recallQuery(question("BREAKOUT"));
    expect(q).toMatch(/^BREAKOUT question; trend (up|down|flat); volatility (low|normal|high) and (expanding|contracting|stable); drawdown \d+%; last day range \d+\.\d%$/);
  });
});

describe("reflection prompt anonymisation (§7.5)", () => {
  const args = (type: "DIRECTION" | "BREAKOUT") => ({
    question: question(type),
    candles,
    horizon: 7,
    p: 0.31,
    rationale: "Volatility is contracting, so a large move looks unlikely.",
    outcome: 1 as const,
  });

  it("contains no ticker, no date and no raw close, including the realised path", () => {
    for (const type of ["DIRECTION", "BREAKOUT"] as const) {
      const p = renderReflectionPrompt(args(type));
      assertAnonymous(p.system + p.user);
      expect(p.system).toBe(REFLECT_SYSTEM);
    }
  });

  it("shows the forecast, the outcome and days +1..+7 rebased to day 0 = 100.00", () => {
    const p = renderReflectionPrompt(args("BREAKOUT")).user;
    expect(p).toContain("My forecast: P(YES) = 0.31. My rationale: Volatility is contracting");
    expect(p).toContain("Outcome: YES. My Brier score on this question: 0.476");
    expect(p).toMatch(/day \+1: close \d+\.\d\d, high \d+\.\d\d, low \d+\.\d\d/);
    expect(p).toMatch(/day \+7: close \d+\.\d\d/);
    expect(p).not.toMatch(/day \+8/);
    expect(p).toMatch(/Largest move up: [+-]\d+\.\d\d%\. Largest move down: -?\d+\.\d\d%/);
    expect(p).not.toContain(NO_LESSONS); // no memory section in a post-mortem
  });

  it("refuses to run before the resolution window has closed", () => {
    expect(() => renderReflectionPrompt({ ...args("DIRECTION"), candles: candles.slice(0, -14) })).toThrow(/day \+7/);
  });
});
