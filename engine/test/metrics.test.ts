import { describe, expect, it } from "vitest";
import {
  accuracy,
  blockBootstrap,
  brier,
  brierSkill,
  clampP,
  ece,
  laplaceRate,
  learningCurve,
  logLoss,
  reliability,
} from "../src/score/metrics";

describe("point metrics", () => {
  it("Brier is the mean squared error", () => {
    expect(brier([{ p: 0.7, y: 1 }, { p: 0.2, y: 0 }])).toBeCloseTo(0.065, 12);
    expect(brier([{ p: 0.5, y: 1 }])).toBe(0.25); // coin flip
  });

  it("log loss clips p to [0.02, 0.98]", () => {
    expect(logLoss([{ p: 0.99, y: 1 }, { p: 0.5, y: 0 }])).toBeCloseTo((-Math.log(0.98) + Math.log(2)) / 2, 12);
    expect(logLoss([{ p: 0, y: 1 }])).toBeCloseTo(-Math.log(0.02), 12);
    expect(clampP(1)).toBe(0.98);
    expect(clampP(-1)).toBe(0.02);
  });

  it("accuracy at 0.5 gives half credit to exact coin flips", () => {
    expect(accuracy([{ p: 0.7, y: 1 }, { p: 0.2, y: 0 }, { p: 0.5, y: 1 }, { p: 0.6, y: 0 }])).toBeCloseTo(0.625, 12);
  });

  it("reliability bins and ECE match a hand-computed example", () => {
    const rows = [
      { p: 0.15, y: 0 as const },
      { p: 0.15, y: 1 as const },
      { p: 0.85, y: 1 as const },
      { p: 0.85, y: 1 as const },
    ];
    expect(reliability(rows)).toEqual([
      { binMid: 0.15, meanP: 0.15, freqY: 0.5, n: 2 },
      { binMid: 0.85, meanP: 0.85, freqY: 1, n: 2 },
    ]);
    expect(ece(rows)).toBeCloseTo(0.25, 12);
  });

  it("puts p = 1 in the top bin", () => {
    expect(reliability([{ p: 1, y: 1 }])[0]!.binMid).toBe(0.95);
  });

  it("Brier skill score against the base arm", () => {
    expect(brierSkill(0.2, 0.25)).toBeCloseTo(0.2, 12);
  });

  it("Laplace base rate starts at 0.5 and never hits 0 or 1", () => {
    expect(laplaceRate([])).toBe(0.5);
    expect(laplaceRate([1])).toBeCloseTo(2 / 3, 12);
    expect(laplaceRate([0, 0])).toBe(0.25);
  });
});

describe("learning curve", () => {
  it("emits one rolling and cumulative point per decision date", () => {
    const rows = [
      { decisionDate: "2026-03-02", brier: 0.4 },
      { decisionDate: "2026-03-02", brier: 0.2 },
      { decisionDate: "2026-03-09", brier: 0.1 },
      { decisionDate: "2026-03-09", brier: 0.1 },
    ];
    const curve = learningCurve(rows, 2);
    expect(curve).toHaveLength(2);
    expect(curve[0]).toMatchObject({ decisionDate: "2026-03-02", n: 2 });
    expect(curve[0]!.rolling).toBeCloseTo(0.3, 12);
    expect(curve[1]!.rolling).toBeCloseTo(0.1, 12);
    expect(curve[1]!.cumulative).toBeCloseTo(0.2, 12);
  });
});

describe("block bootstrap", () => {
  const diffs = Array.from({ length: 40 }, (_, i) => ({ week: `w${Math.floor(i / 8)}`, d: Math.sin(i) * 0.05 + 0.01 }));

  it("is deterministic for a seed", () => {
    expect(blockBootstrap(diffs, 500, 7)).toEqual(blockBootstrap(diffs, 500, 7));
    expect(blockBootstrap(diffs, 500, 7).ci95).not.toEqual(blockBootstrap(diffs, 500, 8).ci95);
  });

  it("reports the observed mean, a CI containing it, and blocks = weeks", () => {
    const r = blockBootstrap(diffs, 2000, 42);
    const observed = diffs.reduce((s, x) => s + x.d, 0) / diffs.length;
    expect(r.meanDelta).toBeCloseTo(observed, 12);
    expect(r.ci95[0]).toBeLessThan(observed);
    expect(r.ci95[1]).toBeGreaterThan(observed);
    expect(r.blocks).toBe(5);
    expect(r.n).toBe(40);
  });

  it("collapses to a point when every difference is equal", () => {
    const r = blockBootstrap([{ week: "a", d: 0.01 }, { week: "b", d: 0.01 }], 100, 1);
    expect(r.ci95[0]).toBeCloseTo(0.01, 12);
    expect(r.ci95[1]).toBeCloseTo(0.01, 12);
    expect(r.shareAboveZero).toBe(1);
  });
});
