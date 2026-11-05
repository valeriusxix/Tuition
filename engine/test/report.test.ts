// §8 report on a hand-built checkpoint with hand-computed answers: the common question set, metrics
// by split and type, skill vs base, paired comparisons and the headline, §8.5 influence, and the
// cross-run D38 tuning comparison.
import type { Arm, Features, Forecast, Question, QuestionType, Split } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { newCheckpoint, type Checkpoint, type LessonRecord } from "../src/replay/checkpoint";
import { buildReport, compareRuns, pickHeadline, scoredRows } from "../src/score/report";

const features: Features = {
  ret7: 0, ret30: 0, vol7: 1, vol30: 1, volRatio: 1, smaDist20: 0, smaSlope20: 0, drawdown30: 0, lastRange: 1,
  trend: "flat", volRegime: "normal", volTrend: "stable",
};
const W1 = "2026-03-02";
const W2 = "2026-03-09";
const W3 = "2026-06-01";

function question(id: string, type: QuestionType, decisionDate: string, split: Split): Question {
  return { id, symbol: "BTC", assetCode: "Asset A", type, decisionDate, resolveDate: decisionDate, split, features };
}

function forecast(questionId: string, arm: Arm, p: number, cited: string[] = [], recalled: string[] = []): Forecast {
  return {
    questionId, arm, p, rationale: "r", citedBlobIds: cited, model: "m", createdAt: "2026-11-05T00:00:00.000Z",
    recalled: recalled.map((blobId) => ({ blobId, distance: 0.3, text: "t", kind: "lesson" as const })),
  };
}

function lesson(blobId: string | undefined): LessonRecord {
  return { questionId: "x", simDate: W1, type: "DIRECTION", regime: "flat/normal/stable", text: "[TUITION v1|kind=lesson]\nbody", adjustment: "none", magnitude: 0, model: "m", ...(blobId ? { blobId } : {}) };
}

/**
 * Scored (common set): A, B, C (dev) and D (test). E has no outcome; F has no mem forecast.
 *          y   base nomem nomem2 mem   cited      recalled
 *   A  D   1   .5   .4    .5     .7    L1         L1 L3
 *   B  B   0   .5   .6    .6     .6
 *   C  D   0   .5   .3    .2     .5    L1 L2      L1 L2
 *   D  B   1   .5   .5    .4     .8    L2 X       L2 L1
 *   E  D   -   .5   .5    .5     .5    L3         L3
 *   F  B   0   .5   .5    .5     -
 */
function fixture(memP: Partial<Record<string, number>> = {}): Checkpoint {
  const cp = newCheckpoint({ runId: "r-test", mode: "dev", config: parseConfig({}), now: new Date("2026-11-05T00:00:00Z"), questions: [
    question("A", "DIRECTION", W1, "dev"),
    question("B", "BREAKOUT", W1, "dev"),
    question("C", "DIRECTION", W2, "dev"),
    question("D", "BREAKOUT", W3, "test"),
    question("E", "DIRECTION", W3, "test"),
    question("F", "BREAKOUT", W3, "test"),
  ] });
  cp.outcomes = { A: 1, B: 0, C: 0, D: 1, F: 0 };
  const table: [string, number, number, number, number | undefined, string[], string[]][] = [
    ["A", 0.5, 0.4, 0.5, 0.7, ["L1"], ["L1", "L3"]],
    ["B", 0.5, 0.6, 0.6, 0.6, [], []],
    ["C", 0.5, 0.3, 0.2, 0.5, ["L1", "L2"], ["L1", "L2"]],
    ["D", 0.5, 0.5, 0.4, 0.8, ["L2", "X"], ["L2", "L1"]],
    ["E", 0.5, 0.5, 0.5, 0.5, ["L3"], ["L3"]],
    ["F", 0.5, 0.5, 0.5, undefined, [], []],
  ];
  cp.forecasts = { base: {}, nomem: {}, nomem2: {}, mem: {} };
  for (const [id, b, n, n2, m, cited, recalled] of table) {
    cp.forecasts.base![id] = forecast(id, "base", b);
    cp.forecasts.nomem![id] = forecast(id, "nomem", n);
    cp.forecasts.nomem2![id] = forecast(id, "nomem2", n2);
    if (m !== undefined) cp.forecasts.mem![id] = forecast(id, "mem", memP[id] ?? m, cited, recalled);
  }
  cp.lessons = [lesson("L1"), lesson("L2"), lesson("L3"), lesson(undefined)];
  return cp;
}

describe("buildReport (§8)", () => {
  it("scores every arm on the same resolved questions", () => {
    expect(scoredRows(fixture()).map((r) => r.q.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("computes metrics per split and type, with skill against base on the same slice", () => {
    const r = buildReport(fixture());
    expect(r.arms).toEqual(["base", "nomem", "nomem2", "mem"]);
    expect(r.weeks).toEqual([W1, W2, W3]);
    expect(r.metrics.mem!.all!.all!.brier).toBeCloseTo(0.185, 12);
    expect(r.metrics.nomem!.all!.all!.brier).toBeCloseTo(0.265, 12);
    expect(r.metrics.nomem2!.all!.all!.brier).toBeCloseTo(0.2525, 12);
    expect(r.metrics.mem!.dev!.all!.brier).toBeCloseTo(0.7 / 3, 12);
    expect(r.metrics.mem!.test!.all!).toMatchObject({ n: 1 });
    expect(r.metrics.mem!.test!.all!.brier).toBeCloseTo(0.04, 12);
    expect(r.metrics.mem!.all!.DIRECTION!.brier).toBeCloseTo(0.17, 12);
    expect(r.metrics.mem!.test!.DIRECTION).toBeUndefined(); // E is unresolved
    expect(r.metrics.mem!.all!.all!.skillVsBase).toBeCloseTo(1 - 0.185 / 0.25, 12);
    expect(r.metrics.base!.all!.all!.skillVsBase).toBeNull();
  });

  it("pairs arms question by question and picks the test split for the headline", () => {
    const r = buildReport(fixture());
    const all = r.comparisons.find((c) => c.id === "mem_vs_nomem" && c.split === "all")!;
    expect(all.meanDelta).toBeCloseTo(0.08, 12); // (.27 + 0 − .16 + .21) / 4
    expect(all.referenceBrier - all.candidateBrier).toBeCloseTo(all.meanDelta, 12);
    expect(all).toMatchObject({ n: 4, blocks: 3, resamples: 2000 });
    expect(r.comparisons.map((c) => c.id)).toContain("nomem2_vs_nomem");
    expect(r.headline).toMatchObject({ id: "mem_vs_nomem", split: "test", n: 1 });
    expect(r.headline!.meanDelta).toBeCloseTo(0.21, 12);
    expect(pickHeadline(r.comparisons.filter((c) => c.split !== "test"))).toMatchObject({ split: "dev" });
  });

  it("builds a learning curve per arm, one point per decision date", () => {
    const r = buildReport(fixture());
    expect(r.curves.mem!.map((p) => p.decisionDate)).toEqual([W1, W2, W3]);
    expect(r.curves.mem![2]!.cumulative).toBeCloseTo(0.185, 12);
    expect(r.curves.mem![2]!.n).toBe(4);
    expect(r.reliability.mem!.all!.n).toBe(4);
  });

  it("measures memory influence per question and per lesson (§8.5)", () => {
    const r = buildReport(fixture());
    expect(r.perQuestion.get("A")!.shift).toBeCloseTo(0.3, 12);
    expect(r.perQuestion.get("C")!.brierGain).toBeCloseTo(-0.16, 12);
    expect(r.perQuestion.has("E")).toBe(false);

    expect(r.influence!.paired).toBe(4);
    expect(r.influence!.citing).toBe(3); // A, C, D; the unknown blob "X" is ignored
    expect(r.influence!.meanShiftCiting).toBeCloseTo(0.8 / 3, 12);
    expect(r.influence!.meanBrierGainCiting).toBeCloseTo(0.32 / 3, 12);
    expect(r.influence!.meanBrierGainNotCiting).toBeCloseTo(0, 12);

    const l1 = r.perLesson.get("L1")!;
    expect(l1).toMatchObject({ timesCited: 2, timesRecalled: 3, citedBy: ["A", "C"] });
    expect(l1.gains.reduce((a, b) => a + b, 0) / l1.gains.length).toBeCloseTo(0.055, 12);
    expect(r.perLesson.get("L2")).toMatchObject({ timesCited: 2, timesRecalled: 2 });
    expect(r.perLesson.get("L3")).toMatchObject({ timesCited: 1, timesRecalled: 2, gains: [] }); // cited only on unresolved E
    expect(r.perLesson.has("X")).toBe(false);
  });

  it("reports nothing to score for an empty run", () => {
    const cp = fixture();
    cp.forecasts = {};
    const r = buildReport(cp);
    expect(r.rows).toEqual([]);
    expect(r.headline).toBeNull();
    expect(r.influence).toBeNull();
  });
});

describe("compareRuns (D38 tuning rule)", () => {
  it("adopts a candidate only when its paired gain beats the no-memory noise floor", () => {
    const reference = fixture();
    const better = fixture({ A: 0.9, B: 0.1, C: 0.1 });
    better.runId = "r-better";
    const cmp = compareRuns(better, reference, [], "dev");
    expect(cmp.n).toBe(3);
    expect(cmp.referenceBrier).toBeCloseTo(0.7 / 3, 12);
    expect(cmp.candidateBrier).toBeCloseTo(0.01, 12);
    expect(cmp.bootstrap.meanDelta).toBeCloseTo(0.7 / 3 - 0.01, 12);
    expect(cmp.noisePasses).toHaveLength(4); // nomem and nomem2 of both runs
    expect(cmp.noiseFloor).toBeCloseTo(0.27 - 0.65 / 3, 12);
    expect(cmp.adopt).toBe(true);

    const same = fixture();
    same.runId = "r-same";
    expect(compareRuns(same, reference, [], "dev").adopt).toBe(false);
  });

  it("refuses runs whose outcomes disagree", () => {
    const other = fixture();
    other.outcomes = { ...other.outcomes, A: 0 };
    expect(() => compareRuns(other, fixture(), [], "dev")).toThrow(/outcome of A differs/);
  });
});
