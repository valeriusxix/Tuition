import { describe, expect, it } from "vitest";
import { computeFeatures, median, MIN_HISTORY_DAYS, regimeOf, sampleStdev, sma, volatility } from "../src/features/regime";
import { alternating, candlesFromCloses, geometric } from "./helpers";

describe("statistics helpers", () => {
  it("sample stdev and median", () => {
    expect(sampleStdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
    expect(sampleStdev([1])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it("volatility of alternating ±a log returns over 7 days is a·√(8/7), in %", () => {
    const a = Math.log(1.02);
    const c = candlesFromCloses(alternating(20, 100, a));
    expect(volatility(c, 7, 7)).toBeCloseTo(a * Math.sqrt(8 / 7) * 100, 9);
  });

  it("sma averages the last n closes", () => {
    const c = candlesFromCloses([1, 2, 3, 4, 5]);
    expect(sma(c, 4, 2)).toBe(4.5);
    expect(sma(c, 4, 5)).toBe(3);
  });
});

describe("computeFeatures", () => {
  it("matches hand-computed values on a +1%/day series", () => {
    const c = candlesFromCloses(geometric(260, 100, 1.01));
    const d = 250;
    const f = computeFeatures(c, d);
    expect(f.ret7).toBeCloseTo((1.01 ** 7 - 1) * 100, 2);
    expect(f.ret30).toBeCloseTo((1.01 ** 30 - 1) * 100, 2);
    expect(f.vol7).toBe(0);
    expect(f.vol30).toBe(0);
    expect(f.volRatio).toBe(1); // defined as 1 when vol30 is 0
    const sma20 = (1 / 20) * Array.from({ length: 20 }, (_, k) => 1.01 ** -k).reduce((a, b) => a + b, 0); // relative to close
    expect(f.smaDist20).toBeCloseTo((1 / sma20 - 1) * 100, 2);
    expect(f.smaSlope20).toBeCloseTo((1.01 ** 5 - 1) * 100, 2);
    expect(f.drawdown30).toBe(0); // close is the 30-day high
    expect(f.lastRange).toBeCloseTo((1 - 1 / 1.01) * 100, 2);
    expect(f.trend).toBe("up");
    expect(f.volTrend).toBe("stable");
    expect(regimeOf(f)).toBe("up/normal/stable");
  });

  it("labels a steady decline as a downtrend with a drawdown", () => {
    const c = candlesFromCloses(geometric(260, 100, 0.99));
    const f = computeFeatures(c, 250);
    expect(f.trend).toBe("down");
    expect(f.drawdown30).toBeCloseTo((1 - 0.99 ** 30) * 100, 1); // 30-day high = open of day d-29 = close of day d-30
    expect(f.ret7).toBeLessThan(0);
  });

  it("calls a sideways market flat", () => {
    const c = candlesFromCloses(alternating(260, 100, Math.log(1.01)));
    expect(computeFeatures(c, 250).trend).toBe("flat");
  });

  it("flags high and expanding volatility after a calm stretch", () => {
    const calm = alternating(240, 100, Math.log(1.005));
    const wild = alternating(12, calm[calm.length - 1]!, Math.log(1.03)).slice(1);
    const c = candlesFromCloses([...calm, ...wild]);
    const f = computeFeatures(c, c.length - 1);
    expect(f.volRegime).toBe("high");
    expect(f.volTrend).toBe("expanding");
    expect(f.volRatio).toBeGreaterThan(1.2);
  });

  it("flags low and contracting volatility after a wild stretch", () => {
    const wild = alternating(240, 100, Math.log(1.03));
    const calm = alternating(12, wild[wild.length - 1]!, Math.log(1.005)).slice(1);
    const c = candlesFromCloses([...wild, ...calm]);
    const f = computeFeatures(c, c.length - 1);
    expect(f.volRegime).toBe("low");
    expect(f.volTrend).toBe("contracting");
  });

  it("uses only candles up to the decision day", () => {
    const c = candlesFromCloses(geometric(260, 100, 1.01));
    const before = computeFeatures(c, 220);
    const changedFuture = c.map((x, i) => (i > 220 ? { ...x, close: x.close * 3, high: x.high * 3 } : x));
    expect(computeFeatures(changedFuture, 220)).toEqual(before);
  });

  it("refuses to compute without enough history", () => {
    const c = candlesFromCloses(geometric(260, 100, 1.01));
    expect(() => computeFeatures(c, MIN_HISTORY_DAYS - 1)).toThrow(/history/);
    expect(() => computeFeatures(c, MIN_HISTORY_DAYS)).not.toThrow();
  });
});
