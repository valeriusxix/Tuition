// §7.4 / §15: a dry replay on InMemoryStore. Every recalled memory must predate the decision it informs,
// writes must happen in simulated-time order, the memory-OFF arms must never touch memory, and a resumed
// run must not re-call the LLM or write anything twice.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Arm, Candle, Question } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import type { Forecaster } from "../src/agent/forecast";
import { StubReflector, type Reflector } from "../src/agent/reflect";
import { parseConfig } from "../src/config";
import { parseReplayArgs } from "../src/commands/replay";
import { decodeHeader, encodeMemory } from "../src/memory/format";
import { InMemoryStore, type MemoryRecall, type MemoryWrite } from "../src/memory/store";
import { isPromptSafe } from "../src/prompt/render";
import { generateQuestions } from "../src/questions/generate";
import { resolveOutcome } from "../src/questions/resolve";
import { checkpointPath, makeRunId, newCheckpoint, readCheckpoint, type Checkpoint } from "../src/replay/checkpoint";
import { runReplay, type ReplayDeps } from "../src/replay/run";
import { laplaceRate } from "../src/score/metrics";
import { mulberry32 } from "../src/util/rng";
import { candlesFromCloses } from "./helpers";

const SYMBOLS = ["BTC", "ETH", "SOL", "SUI"];
// Six decision Mondays: 2026-03-02 … 2026-04-06; dev through 2026-03-16.
const config = parseConfig({ MEMORY_BACKEND: "memory", REPLAY_START: "2026-03-02", REPLAY_END: "2026-04-06", DEV_SPLIT_END: "2026-03-16", LLM_CONCURRENCY: "3" });

/** A seeded random walk with ~3% daily moves, so outcomes are mixed. */
function walk(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * Math.exp((rng() - 0.5) * 0.06));
  return out;
}
const candles = new Map<string, Candle[]>(SYMBOLS.map((s, i) => [s, candlesFromCloses(walk(270, 7 + i), "2025-08-01", 0.01)]));

function questions(): Question[] {
  const { questions: qs, skipped } = generateQuestions({
    candles,
    symbols: SYMBOLS,
    start: config.REPLAY_START,
    end: config.REPLAY_END,
    devSplitEnd: config.DEV_SPLIT_END,
    horizon: 7,
    seed: 42,
  });
  expect(skipped).toEqual([]);
  return qs;
}

/** A store that records every write and recall in order. */
class RecordingStore extends InMemoryStore {
  readonly events: ({ op: "write"; input: MemoryWrite } | { op: "recall"; input: MemoryRecall })[] = [];
  override async write(input: MemoryWrite) {
    this.events.push({ op: "write", input });
    return super.write(input);
  }
  override async recall(input: MemoryRecall) {
    this.events.push({ op: "recall", input });
    return super.recall(input);
  }
}

/** Confident on DIRECTION (so some forecasts miss badly and some do not), 0.5 on BREAKOUT. */
function countingForecaster() {
  const prompts: string[] = [];
  const forecaster: Forecaster = {
    async forecast(prompt, offered) {
      prompts.push(prompt.user);
      const p = prompt.user.includes("DIRECTION:") ? 0.85 : 0.5;
      return { p, rationale: "test", cited: offered.slice(0, 1), model: "test-model" };
    },
  };
  return { forecaster, prompts };
}

function setup(arms: Arm[], opts: { store?: RecordingStore; reflector?: Reflector; cp?: Checkpoint; dir?: string } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "tuition-replay-test-"));
  const cp = opts.cp ?? newCheckpoint({ runId: "r-20261104-0900-ab12", mode: "dry", config, questions: questions(), now: new Date("2026-11-04T09:00:00Z") });
  const store = opts.store ?? new RecordingStore();
  const { forecaster, prompts } = countingForecaster();
  const deps: ReplayDeps = {
    config,
    store,
    forecaster,
    reflector: opts.reflector ?? new StubReflector(),
    candles,
    checkpointFile: checkpointPath(cp.runId, dir),
    arms,
  };
  return { cp, store, deps, prompts, dir };
}

describe("replay leakage controls (§7.4)", () => {
  it("only ever recalls memories created on or before the decision date", async () => {
    const { cp, store, deps } = setup(["base", "nomem", "mem"]);
    const result = await runReplay(cp, deps);
    expect(result.weeks).toHaveLength(6);

    const mem = cp.forecasts.mem!;
    let recalledLessons = 0;
    for (const q of cp.questions) {
      const f = mem[q.id]!;
      for (const m of f.recalled) {
        const h = decodeHeader(m.text)!;
        expect(h.fields.run).toBe(cp.runId);
        expect(h.fields.sim! <= q.decisionDate).toBe(true);
        expect(h.fields.q).not.toBe(q.id); // never a lesson about this very question
        if (m.kind === "lesson") recalledLessons++;
      }
      for (const id of f.citedBlobIds) expect(f.recalled.map((m) => m.blobId)).toContain(id);
    }
    expect(recalledLessons).toBeGreaterThan(0); // memory really was used

    // Writes happen in simulated-time order, and only for questions already resolved.
    const writes = store.events.flatMap((e) => (e.op === "write" ? [e.input] : []));
    const sims = writes.map((w) => w.simDate!);
    expect([...sims].sort()).toEqual(sims);
    for (const l of cp.lessons) {
      const q = cp.questions.find((x) => x.id === l.questionId)!;
      expect(l.simDate).toBe(q.resolveDate);
      expect(l.blobId).toBeDefined();
    }

    // Recall for week D happens after every write dated ≤ D and before any write dated > D.
    let latestWrite = "";
    let week = "";
    const weekOf = new Map(cp.questions.map((q) => [q.id, q.decisionDate]));
    const recallWeeks = cp.questions.filter((q) => mem[q.id]).map((q) => q.decisionDate);
    let r = 0;
    for (const e of store.events) {
      if (e.op === "write") {
        expect(e.input.simDate! >= week).toBe(true);
        latestWrite = e.input.simDate!;
      } else if (e.input.namespace === cp.namespaces.lessons) {
        week = recallWeeks[r++] ?? week;
        expect(latestWrite <= week).toBe(true);
      }
    }
    expect(weekOf.size).toBe(48);
  });

  it("writes a lesson exactly for the mem forecasts that missed by at least LESSON_ERROR_THRESHOLD", async () => {
    const { cp, deps } = setup(["mem"]);
    await runReplay(cp, deps);
    const lastWeek = "2026-04-06";
    const expected = cp.questions
      .filter((q) => q.resolveDate <= lastWeek && Math.abs(cp.forecasts.mem![q.id]!.p - cp.outcomes[q.id]!) >= config.LESSON_ERROR_THRESHOLD)
      .map((q) => q.id)
      .sort();
    expect(cp.lessons.map((l) => l.questionId).sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(40); // the confident DIRECTION forecasts that came true wrote nothing
    // One calibration snapshot per week once ≥ 8 forecasts are resolved: weeks 2–6.
    expect(cp.calibrations.map((c) => c.simDate)).toEqual(["2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30", "2026-04-06"]);
  });

  it("drops a recalled memory dated after the decision date, even if the store returns one", async () => {
    const store = new RecordingStore();
    const { cp, deps } = setup(["mem"], { store });
    const future = encodeMemory("lesson", { run: cp.runId, q: "DIRECTION-BTC-2030-01-07", sim: "2030-01-14" }, "LESSON (DIRECTION question; trend up down flat; volatility): from the future.");
    await store.write({ namespace: cp.namespaces.lessons, text: future, key: "f".repeat(64), kind: "lesson" });
    await runReplay(cp, deps);
    for (const f of Object.values(cp.forecasts.mem!)) expect(f.recalled.some((m) => m.text === future)).toBe(false);
  });

  it("memory-OFF arms never call recall or write", async () => {
    const { cp, store, deps, prompts } = setup(["base", "nomem", "nomem2"]);
    await runReplay(cp, deps);
    expect(store.events).toEqual([]);
    expect(Object.keys(cp.forecasts.nomem!)).toHaveLength(48);
    expect(Object.keys(cp.forecasts.nomem2!)).toHaveLength(48);
    expect(prompts).toHaveLength(96);
    for (const p of prompts) {
      expect(p).toContain("No lessons are available.");
      expect(isPromptSafe(p, SYMBOLS)).toBe(true);
    }
  });

  it("base arm is the Laplace rate of the same type and symbol's questions resolved by the decision date", async () => {
    const { cp, deps } = setup(["base"]);
    await runReplay(cp, deps);
    for (const q of cp.questions) {
      const past = cp.questions.filter((x) => x.symbol === q.symbol && x.type === q.type && x.resolveDate <= q.decisionDate);
      const ys = past.map((x) => resolveOutcome(x, candles.get(x.symbol)!, 7)!);
      expect(cp.forecasts.base![q.id]!.p).toBeCloseTo(laplaceRate(ys));
    }
    expect(cp.forecasts.base![cp.questions[0]!.id]!.p).toBe(0.5); // nothing resolved yet
  });
});

describe("replay checkpointing (§7.11)", () => {
  it("resumes from the last completed week without re-forecasting or re-writing", async () => {
    const store = new RecordingStore();
    const first = setup(["base", "nomem", "mem"], { store });
    await runReplay(first.cp, { ...first.deps, limit: 3 });
    expect(first.cp.progress).toEqual({ base: "2026-03-16", nomem: "2026-03-16", mem: "2026-03-16" });
    const writesAfter3 = store.writes.length;
    const promptsAfter3 = first.prompts.length;

    // Reload from disk, as `replay --resume` does, and continue to the end with the same memory.
    const cp = readCheckpoint(first.deps.checkpointFile);
    const again = setup(["base", "nomem", "mem"], { store, cp, dir: first.dir });
    await runReplay(cp, again.deps);
    expect(again.prompts).toHaveLength(2 * 48 - promptsAfter3); // only weeks 4–6, for nomem and mem
    expect(Object.keys(cp.forecasts.mem!)).toHaveLength(48);

    const keys = store.writes.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length); // nothing written twice
    expect(store.writes.length).toBeGreaterThan(writesAfter3);

    // A third pass is a no-op.
    const third = setup(["base", "nomem", "mem"], { store, cp, dir: first.dir });
    await runReplay(cp, third.deps);
    expect(third.prompts).toHaveLength(0);
  });

  it("reuses a lesson saved before a crash instead of reflecting again", async () => {
    let calls = 0;
    const flaky: Reflector = {
      async reflect(prompt) {
        calls++;
        return new StubReflector().reflect(prompt);
      },
    };
    const store = new RecordingStore();
    const { cp, deps } = setup(["mem"], { store, reflector: flaky });
    await runReplay(cp, { ...deps, limit: 2 });
    const reflected = calls;
    expect(reflected).toBeGreaterThan(0);
    // Simulate a crash between saving the lesson text and the Walrus write completing: the week's
    // progress marker has not advanced yet (it only moves once every write for the week is done).
    const pending = cp.lessons[0]!;
    delete pending.blobId;
    cp.progress.mem = "2026-03-02";
    await runReplay(cp, { ...deps, limit: 2 });
    expect(calls).toBe(reflected); // no new LLM call: the saved text is written as-is
    expect(pending.blobId).toBeDefined();
  });

  it("records a skipped reflection and does not retry it", async () => {
    const { ReflectionSkipped } = await import("../src/agent/reflect");
    let calls = 0;
    const broken: Reflector = {
      async reflect() {
        calls++;
        throw new ReflectionSkipped("reflection failed twice: test");
      },
    };
    const { cp, deps } = setup(["mem"], { reflector: broken });
    await runReplay(cp, { ...deps, limit: 3 });
    expect(cp.lessons).toEqual([]);
    expect(cp.reflectionSkips.length).toBe(calls);
    const before = calls;
    await runReplay(cp, { ...deps, limit: 3 });
    expect(calls).toBe(before);
  });
});

describe("replay arguments and identity", () => {
  it("parses arms in canonical order and guards --official", () => {
    expect(parseReplayArgs(["--arms", "mem,base", "--limit", "4"])).toEqual({ dry: false, official: false, arms: ["base", "mem"], limit: 4 });
    expect(() => parseReplayArgs(["--arms", "mem,foo"])).toThrow(/foo/);
    expect(() => parseReplayArgs(["--official", "--dry"])).toThrow(/cannot be combined/);
    expect(() => parseReplayArgs(["--official", "--limit", "4"])).toThrow(/every week/);
    expect(() => parseReplayArgs(["--limit", "0"])).toThrow(/positive/);
    expect(() => parseReplayArgs(["--resume"])).toThrow(/needs a value/);
  });

  it("makes §7.2 run IDs", () => {
    expect(makeRunId(new Date("2026-11-04T09:07:00Z"), 42)).toMatch(/^r-20261104-0907-[0-9a-f]{4}$/);
    expect(makeRunId(new Date("2026-11-04T09:07:00Z"), 42)).toBe(makeRunId(new Date("2026-11-04T09:07:00Z"), 42));
  });

  it("refuses questions that already carry an outcome", () => {
    const q = { ...questions()[0]!, outcome: 1 as const };
    expect(() => newCheckpoint({ runId: "r-x", mode: "dry", config, questions: [q], now: new Date() })).toThrow(/outcomes/);
  });
});
