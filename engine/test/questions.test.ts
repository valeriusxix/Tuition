import type { Candle } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import {
  assetCodeMap,
  breakoutThreshold,
  generateQuestions,
  indexOfDate,
  maxExcursion,
  questionsFor,
} from "../src/questions/generate";
import { resolveOutcome } from "../src/questions/resolve";
import { addDays } from "../src/util/dates";
import { alternating, candlesFromCloses, geometric } from "./helpers";

/** Flat closes at 100 whose highs/lows reach exactly ±`up`/`down`. */
function flatWithRange(n: number, up: number, down: number, start = "2025-01-01"): Candle[] {
  return candlesFromCloses(Array(n).fill(100), start).map((c) => ({ ...c, high: 100 * (1 + up), low: 100 * (1 - down) }));
}

describe("outcomes", () => {
  const H = 7;

  it("DIRECTION is YES only when the close 7 days later is strictly higher", () => {
    const up = candlesFromCloses([100, 99, 98, 99, 100, 101, 102, 100.01]);
    expect(resolveOutcome({ type: "DIRECTION", decisionDate: "2025-01-01" }, up, H)).toBe(1);
    const same = candlesFromCloses([100, 120, 80, 100, 100, 100, 100, 100]);
    expect(resolveOutcome({ type: "DIRECTION", decisionDate: "2025-01-01" }, same, H)).toBe(0);
    const down = candlesFromCloses([100, 101, 102, 103, 104, 105, 106, 99]);
    expect(resolveOutcome({ type: "DIRECTION", decisionDate: "2025-01-01" }, down, H)).toBe(0);
  });

  it("BREAKOUT is YES when a high or low reaches the threshold (inclusive), either direction", () => {
    const touchUp = flatWithRange(8, 0.01, 0.01).map((c, i) => (i === 3 ? { ...c, high: 105 } : c));
    expect(resolveOutcome({ type: "BREAKOUT", decisionDate: "2025-01-01", threshold: 0.05 }, touchUp, H)).toBe(1);
    const touchDown = flatWithRange(8, 0.01, 0.01).map((c, i) => (i === 7 ? { ...c, low: 95 } : c));
    expect(resolveOutcome({ type: "BREAKOUT", decisionDate: "2025-01-01", threshold: 0.05 }, touchDown, H)).toBe(1);
    const inside = flatWithRange(8, 0.049, 0.049);
    expect(resolveOutcome({ type: "BREAKOUT", decisionDate: "2025-01-01", threshold: 0.05 }, inside, H)).toBe(0);
  });

  it("ignores moves on the decision day itself and after the horizon", () => {
    const c = flatWithRange(10, 0.01, 0.01).map((x, i) => (i === 0 || i === 8 ? { ...x, high: 200 } : x));
    expect(resolveOutcome({ type: "BREAKOUT", decisionDate: "2025-01-01", threshold: 0.05 }, c, H)).toBe(0);
  });

  it("is undefined until the whole window exists", () => {
    const c = candlesFromCloses([100, 101, 102]);
    expect(resolveOutcome({ type: "DIRECTION", decisionDate: "2025-01-01" }, c, H)).toBeUndefined();
  });
});

describe("BREAKOUT threshold", () => {
  it("is the median 7-day max excursion of past windows, to 3 decimals", () => {
    const c = flatWithRange(300, 0.05, 0.03);
    expect(maxExcursion(c, 10, 7)).toBeCloseTo(0.05, 12);
    expect(breakoutThreshold(c, 250, 7)).toBe(0.05);
  });

  it("uses only windows ending on or before the decision day", () => {
    const c = flatWithRange(300, 0.05, 0.03);
    const d = 250;
    const before = breakoutThreshold(c, d, 7);
    // Huge moves after d would raise any window that peeked into the future.
    const future = c.map((x, i) => (i > d ? { ...x, high: 1000, low: 1 } : x));
    expect(breakoutThreshold(future, d, 7)).toBe(before);
    // ...while the same change on the last in-window day does move it.
    const past = c.map((x, i) => (i > d - 120 && i <= d ? { ...x, high: 120 } : x));
    expect(breakoutThreshold(past, d, 7)).toBeGreaterThan(before);
  });
});

describe("question generation", () => {
  const closes = alternating(300, 100, Math.log(1.01));
  const candles = new Map([
    ["BTC", candlesFromCloses(closes, "2025-01-01", 0.01)],
    ["ETH", candlesFromCloses(geometric(300, 50, 1.002), "2025-01-01", 0.01)],
  ]);

  it("maps symbols to fixed asset codes with a seeded shuffle", () => {
    const a = assetCodeMap(["BTC", "ETH", "SOL", "SUI"], 42);
    expect(assetCodeMap(["BTC", "ETH", "SOL", "SUI"], 42)).toEqual(a);
    expect([...a.values()].sort()).toEqual(["Asset A", "Asset B", "Asset C", "Asset D"]);
    expect(() => assetCodeMap(["A", "B", "C", "D", "E", "F", "G"], 1)).toThrow();
  });

  it("creates DIRECTION and BREAKOUT questions for every Monday × symbol", () => {
    // 2025-08-11 and 2025-08-18 are Mondays; index ~222 leaves enough history and future.
    const { questions, skipped } = generateQuestions({
      candles,
      symbols: ["BTC", "ETH"],
      start: "2025-08-11",
      end: "2025-08-18",
      devSplitEnd: "2025-08-11",
      horizon: 7,
      seed: 42,
    });
    expect(skipped).toEqual([]);
    expect(questions).toHaveLength(8);
    const q = questions.find((x) => x.id === "BREAKOUT-ETH-2025-08-18")!;
    expect(q).toMatchObject({ type: "BREAKOUT", symbol: "ETH", decisionDate: "2025-08-18", resolveDate: "2025-08-25", split: "test" });
    expect(q.threshold).toBeGreaterThan(0);
    const direction = questions.find((x) => x.id === "DIRECTION-BTC-2025-08-11")!;
    expect(direction.split).toBe("dev");
    expect(direction.threshold).toBeUndefined();
    expect(questions.every((x) => x.outcome === undefined)).toBe(true);
  });

  it("skips with a reason when history is short, the future is missing, or candles have a gap", () => {
    const c = candles.get("BTC")!;
    const base = { symbol: "BTC", assetCode: "Asset A", candles: c, split: "dev" as const, horizon: 7, needFuture: true };
    expect(questionsFor({ ...base, decisionDate: "2025-02-03" }).skipped[0]!.reason).toMatch(/history/);
    const last = addDays("2025-01-01", c.length - 1);
    expect(questionsFor({ ...base, decisionDate: addDays(last, -3) }).skipped[0]!.reason).toMatch(/no candles through/);
    expect(questionsFor({ ...base, decisionDate: addDays(last, -3), needFuture: false }).questions).toHaveLength(2);
    const gapped = c.filter((_, i) => i !== 200);
    expect(questionsFor({ ...base, candles: gapped, decisionDate: "2025-08-11" }).skipped[0]!.reason).toMatch(/gap/);
  });

  it("finds candle indexes by date", () => {
    const c = candles.get("BTC")!;
    expect(indexOfDate(c, "2025-01-03")).toBe(2);
    expect(indexOfDate(c, "2024-12-31")).toBe(-1);
  });
});
