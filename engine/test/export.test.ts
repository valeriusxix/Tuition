// §15: the web data files that `export` writes validate against their shared schemas. Built from a
// real (dry) replay on InMemoryStore over synthetic candles, written to disk and parsed back.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CurveFileSchema,
  LessonsFileSchema,
  QuestionsFileSchema,
  ReliabilityFileSchema,
  SummaryFileSchema,
  type Candle,
  type MemoryLedgerEntry,
} from "@tuition/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Forecaster } from "../src/agent/forecast";
import { StubReflector } from "../src/agent/reflect";
import { parseExportArgs } from "../src/commands/export";
import { parseConfig } from "../src/config";
import { InMemoryStore } from "../src/memory/store";
import { buildWebData, calibrationUse, ledgerCounts, pricePath, runRef, writeWebData, type WebData } from "../src/publish/export";
import { generateQuestions } from "../src/questions/generate";
import { checkpointPath, newCheckpoint, type Checkpoint } from "../src/replay/checkpoint";
import { runReplay } from "../src/replay/run";
import { buildReport } from "../src/score/report";
import { mulberry32 } from "../src/util/rng";
import { candlesFromCloses } from "./helpers";

const SYMBOLS = ["BTC", "ETH", "SOL", "SUI"];
// Six decision Mondays, 2026-03-02 … 2026-04-06: three dev, three test.
const config = parseConfig({ MEMORY_BACKEND: "memory", REPLAY_START: "2026-03-02", REPLAY_END: "2026-04-06", DEV_SPLIT_END: "2026-03-16" });

function walk(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * Math.exp((rng() - 0.5) * 0.06));
  return out;
}
const candles = new Map<string, Candle[]>(SYMBOLS.map((s, i) => [s, candlesFromCloses(walk(270, 11 + i), "2025-08-01", 0.01)]));

/** Confident on DIRECTION, cautious on BREAKOUT; always cites the first lesson it is shown. */
const forecaster: Forecaster = {
  async forecast(prompt, offered) {
    return { p: prompt.user.includes("DIRECTION:") ? 0.8 : 0.3, rationale: "test", cited: offered.slice(0, 1), model: "test-model" };
  },
};

const ledgerEntry = (blobId: string, kind: MemoryLedgerEntry["kind"], namespace: string): MemoryLedgerEntry => ({
  key: "a".repeat(64), namespace, kind, blobId, jobId: "job", createdAt: "2026-11-05T00:00:00.000Z", textSha256: "b".repeat(64),
});

let cp: Checkpoint;
let data: WebData;

beforeAll(async () => {
  const { questions } = generateQuestions({
    candles, symbols: SYMBOLS, start: config.REPLAY_START, end: config.REPLAY_END, devSplitEnd: config.DEV_SPLIT_END, horizon: 7, seed: 42,
  });
  cp = newCheckpoint({ runId: "r-20261105-1200-ab12", mode: "dry", config, questions, now: new Date("2026-11-05T12:00:00Z") });
  await runReplay(cp, {
    config,
    store: new InMemoryStore(),
    forecaster,
    reflector: new StubReflector(),
    candles,
    checkpointFile: checkpointPath(cp.runId, mkdtempSync(join(tmpdir(), "tuition-export-test-"))),
    arms: ["base", "nomem", "nomem2", "mem"],
  });
  const ledgers = [
    ledgerEntry("blob-1", "forecast", "tuition.live.forecasts"),
    ledgerEntry("blob-1", "forecast", "tuition.live.forecasts"), // the same blob twice counts once
    ledgerEntry("blob-2", "smoke", "tuition.smoke"),
  ];
  data = buildWebData({ cp, report: buildReport(cp), candles, ledgers, generatedAt: "2026-11-05T12:30:00.000Z" });
});

vi.setConfig({ testTimeout: 30_000 }); // a dry replay does real checkpoint I/O

describe("export (§12.1)", () => {
  it("writes five files that validate against their schemas when read back", () => {
    const dir = mkdtempSync(join(tmpdir(), "tuition-web-data-"));
    const paths = writeWebData(dir, data);
    expect(readdirSync(dir).sort()).toEqual(["curve.json", "lessons.json", "questions.json", "reliability.json", "summary.json"]);
    expect(paths).toHaveLength(5);
    const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), "utf8"));
    expect(() => SummaryFileSchema.parse(read("summary.json"))).not.toThrow();
    expect(() => CurveFileSchema.parse(read("curve.json"))).not.toThrow();
    expect(() => ReliabilityFileSchema.parse(read("reliability.json"))).not.toThrow();
    expect(() => QuestionsFileSchema.parse(read("questions.json"))).not.toThrow();
    expect(() => LessonsFileSchema.parse(read("lessons.json"))).not.toThrow();
  });

  it("writes nothing when any file fails validation", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "tuition-web-data-")), "out");
    const bad = { ...data, curve: { ...data.curve, window: 0 } };
    expect(() => writeWebData(dir, bad)).toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  it("summarises the run: all four arms, a test-split headline and mainnet counts", () => {
    const s = data.summary;
    expect(s.arms).toEqual(["base", "nomem", "nomem2", "mem"]);
    expect(s.counts.questions).toBe(48); // 6 weeks × 4 assets × 2 types
    expect(s.counts.bySplit).toEqual({ dev: 24, test: 24 });
    expect(s.headline).toMatchObject({ id: "mem_vs_nomem", split: "test", n: 24, blocks: 3 });
    expect(s.metrics.mem?.test?.BREAKOUT?.n).toBe(12);
    expect(s.memories.run.lessons).toBe(cp.lessons.filter((l) => l.blobId).length);
    expect(s.memories.run.lessons).toBeGreaterThan(0);
    expect(s.memories.mainnet).toEqual({ total: 2, byKind: { forecast: 1, smoke: 1 }, byNamespace: { "tuition.live.forecasts": 1, "tuition.smoke": 1 } });
  });

  it("gives every question a rebased price path, all arm forecasts and the memory shift", () => {
    expect(data.questions.questions).toHaveLength(48);
    for (const q of data.questions.questions) {
      expect(q.path.dayFrom).toBe(-59);
      expect(q.path.closes).toHaveLength(67);
      expect(q.path.closes[59]).toBe(100);
      expect(q.path.futureHighs).toHaveLength(7);
      expect(Object.keys(q.forecasts)).toEqual(["base", "nomem", "nomem2", "mem"]);
      expect(q.outcome).toBeDefined();
      expect(q.shift).toBeCloseTo(q.forecasts.mem!.p - q.forecasts.nomem!.p, 6);
    }
  });

  it("counts lesson citations consistently with the mem forecasts", () => {
    const cited = Object.values(cp.forecasts.mem!).reduce((s, f) => s + new Set(f.citedBlobIds).size, 0);
    expect(cited).toBeGreaterThan(0);
    expect(data.lessons.lessons.reduce((s, l) => s + l.timesCited, 0)).toBe(cited);
    for (const l of data.lessons.lessons) {
      expect(l.body.startsWith("[TUITION")).toBe(false);
      expect(l.citedBy).toHaveLength(l.timesCited);
    }
    expect(data.lessons.calibrations.length).toBe(cp.calibrations.length);
  });
});

describe("export helpers", () => {
  it("rebases the price path so the decision close is 100", () => {
    // high/low = max/min(open, close), open = previous close: day +1 is 100→200, day +2 is 200→25.
    const c = candlesFromCloses([50, 80, 100, 200, 25], "2026-01-01");
    expect(pricePath(c, "2026-01-03", 7)).toEqual({ dayFrom: -2, closes: [50, 80, 100, 200, 25], futureHighs: [200, 200], futureLows: [100, 25] });
    expect(() => pricePath(c, "2026-02-01", 7)).toThrow(/no candle/);
  });

  it("counts each mainnet blob once", () => {
    expect(ledgerCounts([]).total).toBe(0);
  });

  it("parses export arguments and requires a run", () => {
    expect(parseExportArgs(["--run", "r-1", "--out", "x"])).toEqual({ run: "r-1", out: "x", docs: false });
    expect(parseExportArgs(["--run", "r-1", "--docs"])).toEqual({ run: "r-1", docs: true });
    expect(() => parseExportArgs(["--run", "r-1", "--out", "x", "--docs"])).toThrow(/cannot be combined/);
    expect(() => parseExportArgs([])).toThrow(/--run/);
    expect(() => parseExportArgs(["--run"])).toThrow(/needs a value/);
  });
});

describe("calibration use and the run pair (D51)", () => {
  it("a fixed run gets the newest snapshot every week", () => {
    const u = calibrationUse(cp);
    expect(u.written).toBe(cp.calibrations.length);
    expect(u.weeks).toBeGreaterThan(0);
    expect(u.staleWeeks).toBe(0);
    expect(u.frozenFrom).toBeNull();
    expect(data.summary.calibrationUse).toEqual(u);
  });

  it("counts a frozen snapshot as stale, and dates the longest streak", () => {
    const frozen: Checkpoint = structuredClone(cp);
    const first = frozen.calibrations[0]!;
    const firstRecalled = Object.values(frozen.forecasts.mem!).flatMap((f) => f.recalled).find((m) => m.kind === "calibration" && m.text === first.text)!;
    for (const f of Object.values(frozen.forecasts.mem!)) {
      const i = f.recalled.findIndex((m) => m.kind === "calibration");
      if (i >= 0) f.recalled[i] = firstRecalled; // every week sees the first snapshot only
    }
    const u = calibrationUse(frozen);
    expect(u.used).toBe(1);
    expect(u.staleWeeks).toBe(u.weeks - 1);
    expect(u.frozenFrom).toBe(frozen.calibrations[1]!.simDate);
  });

  it("puts the original run beside its rerun in summary.json", () => {
    const original = runRef(cp, buildReport(cp), "original");
    expect(original.headline?.id).toBe("mem_vs_nomem");
    expect(original.comparisons.every((c) => c.split === "test")).toBe(true);
    expect(Object.keys(original.testBrier).sort()).toEqual(["base", "mem", "nomem", "nomem2"]);
    const pair = buildWebData({ cp: { ...cp, rerunOf: cp.runId }, report: buildReport(cp), candles, ledgers: [], generatedAt: "2026-11-09T12:00:00.000Z", otherRun: original });
    expect(SummaryFileSchema.parse(pair.summary)).toMatchObject({ rerunOf: cp.runId, otherRun: { role: "original", runId: cp.runId } });
  });
});
