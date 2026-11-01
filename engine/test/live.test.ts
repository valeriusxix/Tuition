import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveFileSchema } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import { interpretOutput, limitWords, type Forecaster } from "../src/agent/forecast";
import { parseConfig } from "../src/config";
import { allowedRuns, forecastMemoryText, LIVE_NAMESPACES, runLive, type LivePaths } from "../src/live/daily";
import { decodeHeader } from "../src/memory/format";
import { InMemoryStore } from "../src/memory/store";
import { isPromptSafe } from "../src/prompt/render";
import { alternating, candlesFromCloses, geometric } from "./helpers";

const SYMBOLS = ["BTC", "ETH", "SOL", "SUI"];
const config = parseConfig({ MEMORY_BACKEND: "memory" });

/** 260 synthetic daily candles per symbol ending on `lastDay`. */
function candlesThrough(days: number) {
  return new Map(
    SYMBOLS.map((s, i) => [s, candlesFromCloses(i % 2 ? geometric(days, 100 + i, 1.001) : alternating(days, 50 + i, Math.log(1.02)), "2026-02-15", 0.01)]),
  );
}

function tempPaths(): LivePaths {
  const dir = mkdtempSync(join(tmpdir(), "tuition-live-test-"));
  return { stateFile: join(dir, "live-forecasts.json"), ledgerFile: join(dir, "live-ledger.jsonl"), liveJson: join(dir, "live.json") };
}

function recordingForecaster() {
  const prompts: string[] = [];
  const forecaster: Forecaster = {
    async forecast(prompt) {
      prompts.push(prompt.system + prompt.user);
      return { p: 0.61, rationale: "Synthetic test rationale.", cited: [], model: "test-model" };
    },
  };
  return { forecaster, prompts };
}

describe("live mode", () => {
  // 2026-02-15 + 259 days = 2026-11-01; "now" is 2026-11-02, so the last closed candle is 2026-11-01.
  const now = new Date("2026-11-02T00:17:00Z");

  it("commits one forecast per asset and type to tuition.live.forecasts, then exports live.json", async () => {
    const store = new InMemoryStore();
    const paths = tempPaths();
    const { forecaster, prompts } = recordingForecaster();
    const s = await runLive({ config, store, forecaster, candles: candlesThrough(260), now, paths });

    expect(s.decisionDate).toBe("2026-11-01");
    expect(s.committed).toHaveLength(8);
    expect(store.writes).toHaveLength(8);
    expect(store.writes.every((w) => w.namespace === LIVE_NAMESPACES.forecasts && w.kind === "forecast")).toBe(true);
    const header = decodeHeader(store.writes[0]!.text)!;
    expect(header.kind).toBe("forecast");
    expect(header.fields).toMatchObject({ run: "live", sim: "2026-11-01", resolves: "2026-11-08", p: "0.61" });
    expect(SYMBOLS).toContain(header.fields.sym); // real symbol in the header only

    // The model never saw a ticker.
    for (const p of prompts) expect(isPromptSafe(p, SYMBOLS)).toBe(true);

    const file = LiveFileSchema.parse(JSON.parse(readFileSync(paths.liveJson, "utf8")));
    expect(file.pending).toHaveLength(8);
    expect(file.pending.every((r) => r.blobId.startsWith("mem-"))).toBe(true);
    expect(file.metrics).toEqual({ pending: 8, resolved: 0, brier: null });
  });

  it("is idempotent: a second run on the same day writes nothing", async () => {
    const store = new InMemoryStore();
    const paths = tempPaths();
    const deps = { config, store, forecaster: recordingForecaster().forecaster, candles: candlesThrough(260), now, paths };
    await runLive(deps);
    const again = await runLive(deps);
    expect(again.committed).toHaveLength(0);
    expect(again.alreadyCommitted).toBe(8);
    expect(store.writes).toHaveLength(8);
  });

  it("resolves commitments once their window has closed, and keeps forecasting", async () => {
    const store = new InMemoryStore();
    const paths = tempPaths();
    const forecaster = recordingForecaster().forecaster;
    await runLive({ config, store, forecaster, candles: candlesThrough(260), now, paths });
    const later = await runLive({ config, store, forecaster, candles: candlesThrough(267), now: new Date("2026-11-09T00:17:00Z"), paths });
    expect(later.resolvedNow).toBe(8);
    expect(later.committed).toHaveLength(8);
    expect(later.file.resolved).toHaveLength(8);
    expect(later.file.metrics.brier).not.toBeNull();
    expect(later.file.resolved.every((r) => r.brier === (r.p - r.outcome!) ** 2)).toBe(true);
  });

  it("refuses to run without a candle for the decision day", async () => {
    await expect(
      runLive({ config, store: new InMemoryStore(), forecaster: recordingForecaster().forecaster, candles: candlesThrough(250), now, paths: tempPaths() }),
    ).rejects.toThrow(/No live questions/);
  });

  it("allows lessons from the live run and any configured official run", () => {
    expect([...allowedRuns(["tuition.r-20261104-0900-ab12.lessons", "tuition.live.lessons", "junk"])]).toEqual(["live", "r-20261104-0900-ab12"]);
  });

  it("writes the §9.5 commitment body with the asset code, never the ticker", () => {
    const text = forecastMemoryText(
      { id: "BREAKOUT-SOL-2026-11-01", symbol: "SOL", assetCode: "Asset D", type: "BREAKOUT", decisionDate: "2026-11-01", resolveDate: "2026-11-08", threshold: 0.097, split: "live", features: {} as never },
      { p: 0.63, rationale: "Volatility is compressing." },
    );
    const [header, body] = text.split("\n");
    expect(header).toContain("sym=SOL");
    expect(body).toBe("FORECAST (BREAKOUT ±9.7%, Asset D, made on sim day 2026-11-01, resolves 2026-11-08): P(YES)=0.63. Rationale: Volatility is compressing.");
  });
});

describe("forecast output", () => {
  it("clamps p, trims the rationale and drops citations that were never offered", () => {
    const r = interpretOutput({ probability: 0.999, rationale: "word ".repeat(80), cited_lessons: ["b1", "made-up", "b1"] }, ["b1"], "m");
    expect(r).toMatchObject({ p: 0.98, cited: ["b1"], model: "m" });
    expect(typeof r !== "string" && r.rationale.split(" ").length).toBe(60);
  });

  it("explains invalid output instead of guessing", () => {
    expect(interpretOutput({ probability: 1.5, rationale: "", cited_lessons: [] }, [], "m")).toMatch(/outside/);
    expect(interpretOutput({ prob: 0.5 }, [], "m")).toMatch(/schema/);
    expect(interpretOutput(null, [], "m")).toMatch(/schema/);
  });

  it("limitWords leaves short text alone", () => {
    expect(limitWords("short and sweet", 60)).toBe("short and sweet");
  });
});
