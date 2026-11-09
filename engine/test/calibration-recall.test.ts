// D51 / AUDIT B3: the memory arm must get the newest calibration snapshot every week, even when the
// relayer ranks newer snapshots further from the query (they are longer, so they embed further away).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candle, RecalledMemory } from "@tuition/shared";
import { describe, expect, it, vi } from "vitest";
import type { Forecaster } from "../src/agent/forecast";
import { StubReflector } from "../src/agent/reflect";
import { parseConfig } from "../src/config";
import { decodeHeader, encodeMemory } from "../src/memory/format";
import { InMemoryStore } from "../src/memory/store";
import { generateQuestions } from "../src/questions/generate";
import { checkpointPath, newCheckpoint } from "../src/replay/checkpoint";
import { checkRerun, parseReplayArgs } from "../src/commands/replay";
import { newestSnapshot, runReplay } from "../src/replay/run";
import { mulberry32 } from "../src/util/rng";
import { candlesFromCloses } from "./helpers";

vi.setConfig({ testTimeout: 60_000 });

const SYMBOLS = ["BTC", "ETH", "SOL", "SUI"];
// Twelve decision Mondays, 2026-03-02 … 2026-05-18: eleven snapshots, more than the relayer's "recent" window of 5.
const config = parseConfig({ MEMORY_BACKEND: "memory", REPLAY_START: "2026-03-02", REPLAY_END: "2026-05-18", DEV_SPLIT_END: "2026-03-30", LLM_CONCURRENCY: "4" });

function walk(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * Math.exp((rng() - 0.5) * 0.06));
  return out;
}
const candles = new Map<string, Candle[]>(SYMBOLS.map((s, i) => [s, candlesFromCloses(walk(320, 11 + i), "2025-08-01", 0.01)]));

/** Like the real relayer on this query: every later write sits a little further away. */
class RelayerLikeStore extends InMemoryStore {
  protected override distance(_query: string, _text: string, order: number): number {
    return 0.3 + order / 1000;
  }
}

const forecaster: Forecaster = {
  async forecast(prompt) {
    return { p: prompt.user.includes("DIRECTION:") ? 0.8 : 0.4, rationale: "test", cited: [], model: "test-model" };
  },
};

const snap = (sim: string, n: number): RecalledMemory => ({
  blobId: `b-${sim}-${n}`,
  distance: 0.5,
  kind: "calibration",
  text: encodeMemory("calibration", { run: "r-1", sim, n: String(n) }, "CALIBRATION SNAPSHOT"),
});

describe("calibration recall (D51)", () => {
  it("newestSnapshot picks the latest sim date, then the larger n", () => {
    expect(newestSnapshot([])).toBeUndefined();
    expect(newestSnapshot([snap("2026-04-06", 40), snap("2026-05-04", 96), snap("2026-04-20", 56)])!.blobId).toBe("b-2026-05-04-96");
    expect(newestSnapshot([snap("2026-05-04", 88), snap("2026-05-04", 96)])!.blobId).toBe("b-2026-05-04-96");
  });

  it("the relayer-like store's recent sort only reorders the nearest window", async () => {
    const store = new RelayerLikeStore();
    for (let i = 1; i <= 8; i++) await store.write({ namespace: "cal", text: snap(`2026-04-0${i}`, i).text, key: `k${i}`, kind: "calibration" });
    const [top] = await store.recall({ namespace: "cal", query: "calibration snapshot", limit: 1, sort: "recent" });
    expect(top!.blobId).toBe("mem-5"); // newest of the 5 nearest, not mem-8: the bug the old call had
  });

  it("every mem forecast sees the newest snapshot written so far", async () => {
    const { questions, skipped } = generateQuestions({
      candles,
      symbols: SYMBOLS,
      start: config.REPLAY_START,
      end: config.REPLAY_END,
      devSplitEnd: config.DEV_SPLIT_END,
      horizon: 7,
      seed: 42,
    });
    expect(skipped).toEqual([]);
    const cp = newCheckpoint({ runId: "r-20261109-1400-cd34", mode: "dry", config, questions, now: new Date("2026-11-09T14:00:00Z") });
    const dir = mkdtempSync(join(tmpdir(), "tuition-calrecall-"));
    const result = await runReplay(cp, {
      config,
      store: new RelayerLikeStore(),
      forecaster,
      reflector: new StubReflector(),
      candles,
      checkpointFile: checkpointPath(cp.runId, dir),
      arms: ["mem"],
      calibrationRetryMs: 0,
    });
    expect(result.weeks).toHaveLength(12);
    expect(cp.calibrations.length).toBeGreaterThan(6);

    let checked = 0;
    for (const q of cp.questions) {
      const expected = cp.calibrations.filter((c) => c.simDate <= q.decisionDate).map((c) => c.simDate).sort().at(-1);
      const got = cp.forecasts.mem![q.id]!.recalled.find((m) => m.kind === "calibration");
      expect(got ? decodeHeader(got.text)!.fields.sim : undefined).toBe(expected);
      if (expected) checked++;
    }
    expect(checked).toBeGreaterThan(60);
    expect(cp.calibrationMisses ?? []).toEqual([]);
  });
});

describe("the one corrected rerun (D51)", () => {
  const official = { runId: "r-20261106-1001-f2a8", mode: "official" as const, rerunOf: undefined };
  it("parses --rerun-of only with --official and not with --resume", () => {
    expect(parseReplayArgs(["--official", "--rerun-of", official.runId]).rerunOf).toBe(official.runId);
    expect(() => parseReplayArgs(["--rerun-of", official.runId])).toThrow(/--official/);
    expect(() => parseReplayArgs(["--official", "--rerun-of", official.runId, "--resume", "r-x"])).toThrow(/--resume alone/);
  });
  it("allows exactly one rerun, of an official run that is not itself a rerun", () => {
    expect(() => checkRerun(official, [official])).not.toThrow();
    expect(() => checkRerun({ ...official, mode: "dev" }, [])).toThrow(/only an official run/);
    const rerun = { runId: "r-20261109-1500-aa11", mode: "official" as const, rerunOf: official.runId };
    expect(() => checkRerun(rerun, [official, rerun])).toThrow(/itself a rerun/);
    expect(() => checkRerun(official, [official, rerun])).toThrow(/only one rerun/);
  });
});
