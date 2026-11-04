import type { Question } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import { interpretReflection, lessonMemoryText, limitChars, regimeWords, StubReflector, type ReflectResult } from "../src/agent/reflect";
import { decodeHeader, MAX_MEMORY_CHARS, memoryBody } from "../src/memory/format";
import { isPromptSafe } from "../src/prompt/render";

const TICKERS = ["BTC", "ETH", "SOL", "SUI"];

const question: Question = {
  id: "BREAKOUT-SOL-2026-04-13",
  symbol: "SOL",
  assetCode: "Asset D",
  type: "BREAKOUT",
  decisionDate: "2026-04-13",
  resolveDate: "2026-04-20",
  threshold: 0.072,
  split: "dev",
  features: {
    ret7: -4.2, ret30: -12, vol7: 5.1, vol30: 3.9, volRatio: 1.31, smaDist20: -6, smaSlope20: -2.1,
    drawdown30: 18, lastRange: 6.1, trend: "down", volRegime: "high", volTrend: "expanding",
  },
};

const ok = { lesson: "When volatility expands inside a downtrend I underestimate large excursions.", applies_when: "trend down and volRatio > 1.2", adjustment: "raise", magnitude: 0.15 };

describe("interpretReflection (§7.5)", () => {
  it("accepts a valid lesson", () => {
    expect(interpretReflection(ok, TICKERS, "m")).toEqual({
      lesson: ok.lesson,
      appliesWhen: ok.applies_when,
      adjustment: "raise",
      magnitude: 0.15,
      model: "m",
    });
  });

  it("clamps magnitude to [0, 0.3] and zeroes it for adjustment none", () => {
    expect(interpretReflection({ ...ok, magnitude: 0.9 }, TICKERS, "m")).toMatchObject({ magnitude: 0.3 });
    expect(interpretReflection({ ...ok, magnitude: -1 }, TICKERS, "m")).toMatchObject({ magnitude: 0 });
    expect(interpretReflection({ ...ok, adjustment: "none", magnitude: 0.2 }, TICKERS, "m")).toMatchObject({ adjustment: "none", magnitude: 0 });
  });

  it("trims over-long text at a word boundary instead of rejecting it", () => {
    const r = interpretReflection({ ...ok, lesson: "word ".repeat(100), applies_when: "cond ".repeat(60) }, TICKERS, "m") as ReflectResult;
    expect(r.lesson.length).toBeLessThanOrEqual(280);
    expect(r.appliesWhen.length).toBeLessThanOrEqual(120);
    expect(r.lesson.endsWith("…")).toBe(true);
  });

  it("rejects tickers, dates, bad schema and empty lessons with a reason", () => {
    expect(interpretReflection({ ...ok, lesson: "SOL tends to break out after a drawdown like this one." }, TICKERS, "m")).toMatch(/ticker/);
    expect(interpretReflection({ ...ok, applies_when: "after 2026-04-13" }, TICKERS, "m")).toMatch(/date/);
    expect(interpretReflection({ ...ok, adjustment: "up" }, TICKERS, "m")).toMatch(/schema/);
    expect(interpretReflection({ ...ok, lesson: " " }, TICKERS, "m")).toMatch(/empty/);
    expect(interpretReflection(null, TICKERS, "m")).toMatch(/schema/);
  });
});

describe("limitChars", () => {
  it("leaves short text alone and normalises whitespace", () => {
    expect(limitChars("  a  b\nc ", 10)).toBe("a b c");
  });
  it("never exceeds the limit", () => {
    for (const n of [20, 37, 120, 280]) expect(limitChars("lorem ipsum dolor sit amet ".repeat(30), n).length).toBeLessThanOrEqual(n);
  });
});

describe("lessonMemoryText (§7.6)", () => {
  const result = interpretReflection(ok, TICKERS, "m") as ReflectResult;
  const text = lessonMemoryText({ runId: "r-20261104-0900-ab12", question, simDate: question.resolveDate, result });

  it("carries the machine header with the run, question, regime and sim date", () => {
    const h = decodeHeader(text)!;
    expect(h.kind).toBe("lesson");
    expect(h.fields).toEqual({
      run: "r-20261104-0900-ab12",
      q: "BREAKOUT-SOL-2026-04-13",
      type: "BREAKOUT",
      regime: "down/high/expanding",
      sim: "2026-04-20",
      adj: "raise",
      mag: "0.15",
    });
  });

  it("has a human body in the §7.6 shape with no ticker or date", () => {
    const body = memoryBody(text);
    expect(body).toBe(
      "LESSON (BREAKOUT, downtrend, high volatility, volatility expanding): When volatility expands inside a downtrend I underestimate large excursions. " +
        "Applies when trend down and volRatio > 1.2. Next time, raise my P(YES) by about 0.15.",
    );
    expect(isPromptSafe(body, TICKERS)).toBe(true);
  });

  it("fits the memory length cap even at maximum field lengths", () => {
    const long = interpretReflection({ ...ok, lesson: "x".repeat(400), applies_when: "y ".repeat(200) }, TICKERS, "m") as ReflectResult;
    expect(lessonMemoryText({ runId: "r-20261104-0900-ab12", question, simDate: "2026-04-20", result: long }).length).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
  });

  it("says 'no adjustment' for bad-luck lessons", () => {
    const none = interpretReflection({ ...ok, adjustment: "none" }, TICKERS, "m") as ReflectResult;
    expect(memoryBody(lessonMemoryText({ runId: "r-1", question, simDate: "2026-04-20", result: none }))).toMatch(/No probability adjustment/);
  });

  it("describes the regime in words", () => {
    expect(regimeWords(question)).toBe("BREAKOUT, downtrend, high volatility, volatility expanding");
  });
});

describe("StubReflector", () => {
  it("is deterministic and points the adjustment toward the outcome", async () => {
    const s = new StubReflector();
    const yes = await s.reflect({ system: "", user: "Regime: x (down/high/expanding)\nMy forecast: P(YES) = 0.20.\nOutcome: YES." });
    const no = await s.reflect({ system: "", user: "Regime: x (down/high/expanding)\nMy forecast: P(YES) = 0.80.\nOutcome: NO." });
    expect(yes.adjustment).toBe("raise");
    expect(no.adjustment).toBe("lower");
    expect(await s.reflect({ system: "", user: "My forecast: P(YES) = 0.20.\nOutcome: YES." })).toEqual(await s.reflect({ system: "", user: "My forecast: P(YES) = 0.20.\nOutcome: YES." }));
  });
});
