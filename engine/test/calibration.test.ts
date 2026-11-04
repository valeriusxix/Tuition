import { describe, expect, it } from "vitest";
import { buildCalibrationSnapshot, calibrationGroups, MAX_GROUPS, type CalibrationRow } from "../src/memory/calibration";
import { decodeHeader, MAX_MEMORY_CHARS, memoryBody } from "../src/memory/format";

const row = (type: CalibrationRow["type"], trend: CalibrationRow["trend"], volRegime: CalibrationRow["volRegime"], p: number, y: 0 | 1): CalibrationRow => ({
  type,
  trend,
  volRegime,
  p,
  y,
});

// BREAKOUT/down/high: p̄ 0.40, ȳ 0.75 (n=4) → too LOW by 0.35.
// DIRECTION/up/normal: p̄ 0.70, ȳ 0.40 (n=5) → too HIGH by 0.30.
// DIRECTION/flat/low: n=3 → below the n ≥ 4 floor, not listed.
const rows: CalibrationRow[] = [
  ...[1, 1, 1, 0].map((y) => row("BREAKOUT", "down", "high", 0.4, y as 0 | 1)),
  ...[1, 1, 0, 0, 0].map((y) => row("DIRECTION", "up", "normal", 0.7, y as 0 | 1)),
  ...[1, 0, 1].map((y) => row("DIRECTION", "flat", "low", 0.5, y as 0 | 1)),
];

describe("calibration snapshot (§7.8)", () => {
  it("groups by type × trend × volRegime, keeps n ≥ 4, largest |gap| first", () => {
    const g = calibrationGroups(rows);
    expect(g.map((x) => [x.type, x.trend, x.volRegime, x.n])).toEqual([
      ["BREAKOUT", "down", "high", 4],
      ["DIRECTION", "up", "normal", 5],
    ]);
    expect(g[0]!.meanP).toBeCloseTo(0.4);
    expect(g[0]!.freqY).toBeCloseTo(0.75);
    expect(g[0]!.gap).toBeCloseTo(0.35);
    expect(g[1]!.gap).toBeCloseTo(-0.3);
  });

  it("writes nothing with fewer than 8 resolved forecasts", () => {
    expect(buildCalibrationSnapshot({ runId: "r-1", simDate: "2026-05-04", rows: rows.slice(0, 7) })).toBeNull();
  });

  it("renders the header, one line per group and the overall Brier", () => {
    const s = buildCalibrationSnapshot({ runId: "r-1", simDate: "2026-05-04", rows })!;
    expect(decodeHeader(s.text)).toEqual({ kind: "calibration", fields: { run: "r-1", sim: "2026-05-04", n: "12" } });
    // Brier: 4 × (0.4 − y)² → 3×0.36 + 0.16 = 1.24; 5 × (0.7 − y)² → 2×0.09 + 3×0.49 = 1.65; 3 × 0.25 = 0.75 → 3.64 / 12.
    expect(s.brier).toBeCloseTo(3.64 / 12);
    expect(memoryBody(s.text).split("\n")).toEqual([
      "CALIBRATION SNAPSHOT after 12 resolved forecasts.",
      "BREAKOUT, down trend, high vol: I forecast 0.40 on average (n=4) but it happened 0.75 of the time → my P(YES) was too LOW by 0.35.",
      "DIRECTION, up trend, normal vol: I forecast 0.70 on average (n=5) but it happened 0.40 of the time → my P(YES) was too HIGH by 0.30.",
      "Overall Brier so far 0.303 (coin-flip is 0.250).",
    ]);
  });

  it("says so when no group is big enough yet", () => {
    const thin = [...[1, 0, 1].map((y) => row("DIRECTION", "flat", "low", 0.5, y as 0 | 1)), ...[0, 0, 1].map((y) => row("BREAKOUT", "up", "low", 0.5, y as 0 | 1)), row("BREAKOUT", "down", "low", 0.5, 1), row("DIRECTION", "down", "low", 0.5, 0)];
    expect(memoryBody(buildCalibrationSnapshot({ runId: "r-1", simDate: "2026-05-04", rows: thin })!.text)).toMatch(/No regime group has 4 or more/);
  });

  it("lists at most 8 groups and always fits the memory length cap", () => {
    const many: CalibrationRow[] = [];
    for (const type of ["DIRECTION", "BREAKOUT"] as const)
      for (const trend of ["up", "down", "flat"] as const)
        for (const vol of ["low", "normal", "high"] as const) for (let i = 0; i < 6; i++) many.push(row(type, trend, vol, 0.33, (i % 2) as 0 | 1));
    const s = buildCalibrationSnapshot({ runId: "r-20261104-0900-ab12", simDate: "2026-09-28", rows: many })!;
    expect(s.groups.length).toBeLessThanOrEqual(MAX_GROUPS);
    expect(s.groups.length).toBeGreaterThan(0);
    expect(s.text.length).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
  });
});
