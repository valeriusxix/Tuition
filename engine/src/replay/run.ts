// §7 the A/B experiment. The same questions go through every arm in strict chronological order:
//   base    trailing Laplace base rate per type × symbol (no LLM)
//   nomem   LLM, "No lessons are available.", no recall, no writes
//   nomem2  an independent repeat of nomem: the A/A noise floor (D18)
//   mem     LLM with recalled lessons + the latest calibration snapshot from Walrus Memory; writes a lesson
//           after each bad miss and a calibration snapshot each week
// Weekly loop for decision Monday D (§7.3): resolve → reflect → calibrate → forecast. Recall for D happens
// after every write for resolve dates ≤ D and before any later write (§7.4).
import type { Arm, Candle, Forecast, Question, RecalledMemory } from "@tuition/shared";
import type { Forecaster } from "../agent/forecast";
import { lessonMemoryText, ReflectionSkipped, type Reflector } from "../agent/reflect";
import type { Config } from "../config";
import { regimeOf } from "../features/regime";
import { log } from "../log";
import { buildCalibrationSnapshot, type CalibrationRow } from "../memory/calibration";
import { decodeHeader, memoryBody } from "../memory/format";
import type { MemoryStore } from "../memory/store";
import { isPromptSafe, recallQuery, renderForecastPrompt, renderReflectionPrompt, type PromptLesson } from "../prompt/render";
import { resolveOutcome } from "../questions/resolve";
import { armMetrics, laplaceRate, type ArmMetrics } from "../score/metrics";
import { memoryKey } from "../util/hash";
import { mapLimit } from "../util/ratelimit";
import { ARM_ORDER, writeCheckpoint, type Checkpoint, type LessonRecord } from "./checkpoint";

export const CALIBRATION_QUERY = "calibration snapshot";
export const BASE_MODEL = "base-rate";
/**
 * How many calibration snapshots one recall asks for (D51). More than a full run ever writes (one per
 * decision week, 33 in the default window), so the whole namespace comes back and the newest is chosen
 * here by its header date. `limit: 1, sort: "recent"` only reorders the relayer's nearest few candidates,
 * which froze the snapshot in r-20261106-1001-f2a8 (AUDIT B3).
 */
export const CALIBRATION_RECALL_LIMIT = 100;

/** The snapshot with the latest header `sim` date (ties: the larger n), or undefined. */
export function newestSnapshot(memories: readonly RecalledMemory[]): RecalledMemory | undefined {
  const key = (m: RecalledMemory) => {
    const f = decodeHeader(m.text)?.fields;
    return { sim: f?.sim ?? "", n: Number(f?.n ?? 0) };
  };
  let best: RecalledMemory | undefined;
  for (const m of memories) {
    if (!best) {
      best = m;
      continue;
    }
    const a = key(m);
    const b = key(best);
    if (a.sim > b.sim || (a.sim === b.sim && a.n > b.n)) best = m;
  }
  return best;
}

export class LeakageError extends Error {
  override name = "LeakageError";
}

export interface ReplayDeps {
  config: Config; // with the checkpoint's snapshot applied
  store: MemoryStore;
  forecaster: Forecaster;
  reflector: Reflector;
  candles: ReadonlyMap<string, readonly Candle[]>;
  checkpointFile: string;
  arms: readonly Arm[];
  limit?: number; // first N decision weeks only
  calibrationRetryMs?: number; // pause before re-asking for a missing newest snapshot (tests: 0)
}

export interface WeekReport {
  arm: Arm;
  decisionDate: string;
  forecasts: number;
  meanP: number;
  lessonsWritten: number;
  reflectionsSkipped: number;
  calibrationN?: number;
  recalledLessons: number; // mem: total lessons shown across this week's prompts
  costUsd: number;
}

export interface ReplayResult {
  weeks: string[];
  reports: WeekReport[];
  metrics: Partial<Record<Arm, { all: ArmMetrics; dev?: ArmMetrics; test?: ArmMetrics }>>;
}

/** The decision Mondays of the run, ascending, cut to the first `limit` when given. */
export function decisionWeeks(questions: readonly Question[], limit?: number): string[] {
  const weeks = [...new Set(questions.map((q) => q.decisionDate))].sort();
  return limit === undefined ? weeks : weeks.slice(0, limit);
}

export function sortArms(arms: readonly Arm[]): Arm[] {
  return ARM_ORDER.filter((a) => arms.includes(a));
}

export async function runReplay(cp: Checkpoint, deps: ReplayDeps): Promise<ReplayResult> {
  const { config, store, forecaster, reflector, candles, checkpointFile } = deps;
  const horizon = config.HORIZON_DAYS;
  const weeks = decisionWeeks(cp.questions, deps.limit);
  const byDate = new Map<string, Question[]>();
  for (const q of cp.questions) (byDate.get(q.decisionDate) ?? byDate.set(q.decisionDate, []).get(q.decisionDate)!).push(q);
  const save = () => writeCheckpoint(checkpointFile, cp);
  const addCost = (key: string, usd: number | undefined) => {
    if (usd !== undefined) cp.costUsd[key] = (cp.costUsd[key] ?? 0) + usd;
  };
  const candlesOf = (q: Question) => {
    const c = candles.get(q.symbol);
    if (!c) throw new Error(`no candles for ${q.symbol}`);
    return c;
  };

  /** The outcome of q as known at simulated date D: undefined until q.resolveDate ≤ D. */
  const outcomeAt = (q: Question, D: string): 0 | 1 | undefined => {
    if (q.resolveDate > D) return undefined;
    let y = cp.outcomes[q.id];
    if (y === undefined) {
      y = resolveOutcome(q, candlesOf(q), horizon);
      if (y === undefined) throw new Error(`cannot resolve ${q.id}: candles missing for its window`);
      cp.outcomes[q.id] = y;
    }
    return y;
  };

  const resolvedMem = (D: string) =>
    cp.questions.flatMap((q) => {
      const f = cp.forecasts.mem?.[q.id];
      const y = f ? outcomeAt(q, D) : undefined;
      return f && y !== undefined ? [{ q, f, y }] : [];
    });

  // ── §7.3 step 2: reflect on bad misses and write one lesson each ──────────
  async function reflect(D: string): Promise<{ written: number; skipped: number }> {
    const done = new Set([...cp.lessons.filter((l) => l.blobId).map((l) => l.questionId), ...cp.reflectionSkips.map((s) => s.questionId)]);
    const todo = resolvedMem(D).filter(({ q, f, y }) => !done.has(q.id) && Math.abs(f.p - y) >= config.LESSON_ERROR_THRESHOLD);
    let written = 0;
    let skipped = 0;
    await mapLimit(todo, config.LLM_CONCURRENCY, async ({ q, f, y }) => {
      if (q.resolveDate > D) throw new LeakageError(`lesson for ${q.id} (resolves ${q.resolveDate}) at sim date ${D}`);
      let record: LessonRecord | undefined = cp.lessons.find((l) => l.questionId === q.id); // pending from a crash
      if (!record) {
        const prompt = renderReflectionPrompt({ question: q, candles: candlesOf(q), horizon, p: f.p, rationale: f.rationale, outcome: y });
        try {
          const r = await reflector.reflect(prompt);
          addCost("reflect", r.costUsd);
          record = {
            questionId: q.id,
            simDate: q.resolveDate,
            type: q.type,
            regime: regimeOf(q.features),
            text: lessonMemoryText({ runId: cp.runId, question: q, simDate: q.resolveDate, result: r }),
            adjustment: r.adjustment,
            magnitude: r.magnitude,
            model: r.model,
          };
        } catch (error) {
          if (!(error instanceof ReflectionSkipped)) throw error;
          log.warn("skipping lesson", { question: q.id, reason: error.message });
          cp.reflectionSkips.push({ questionId: q.id, reason: error.message });
          save();
          skipped++;
          return;
        }
        cp.lessons.push(record);
        save(); // before writing, so a resumed run writes this exact text (D32)
      }
      const { blobId } = await store.write({
        namespace: cp.namespaces.lessons,
        text: record.text,
        key: memoryKey(cp.runId, "lesson", q.id),
        kind: "lesson",
        simDate: record.simDate,
      });
      record.blobId = blobId;
      save();
      written++;
    });
    return { written, skipped };
  }

  // ── §7.3 step 3: one calibration snapshot from every resolved mem forecast ─
  async function calibrate(D: string): Promise<number | undefined> {
    const existing = cp.calibrations.find((c) => c.simDate === D);
    if (existing) return existing.n;
    const rows: CalibrationRow[] = resolvedMem(D).map(({ q, f, y }) => ({ type: q.type, trend: q.features.trend, volRegime: q.features.volRegime, p: f.p, y }));
    const snap = buildCalibrationSnapshot({ runId: cp.runId, simDate: D, rows });
    if (!snap) return undefined;
    const { blobId } = await store.write({
      namespace: cp.namespaces.calibration,
      text: snap.text,
      key: memoryKey(cp.runId, "calibration", D),
      kind: "calibration",
      simDate: D,
    });
    cp.calibrations.push({ simDate: D, n: snap.n, brier: snap.brier, text: snap.text, blobId });
    save();
    return snap.n;
  }

  /** A recalled memory is usable at D only if it is this run's, of the right kind, and already knowable. */
  const usableAt = (m: RecalledMemory, kind: RecalledMemory["kind"], D: string): boolean => {
    const h = decodeHeader(m.text);
    if (!h || h.kind !== kind || h.fields.run !== cp.runId) return false;
    const sim = h.fields.sim;
    if (!sim || sim > D) {
      log.warn("dropping a recalled memory from after the decision date", { blobId: m.blobId, sim, decisionDate: D });
      return false;
    }
    return isPromptSafe(memoryBody(m.text), config.ASSETS);
  };

  /**
   * The newest calibration snapshot knowable at D, read back from memory (D51). The checkpoint only says
   * which snapshot should come back; the prompt always uses what recall returned. A mismatch is retried
   * once, then logged and recorded in cp.calibrationMisses, never silently ignored.
   */
  async function recallCalibration(D: string): Promise<RecalledMemory | undefined> {
    const expected = cp.calibrations.filter((c) => c.simDate <= D).reduce<string | undefined>((a, c) => (a && a > c.simDate ? a : c.simDate), undefined);
    let found: RecalledMemory | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const got = await store.recall({ namespace: cp.namespaces.calibration, query: CALIBRATION_QUERY, limit: CALIBRATION_RECALL_LIMIT });
      if (got.length >= CALIBRATION_RECALL_LIMIT) log.warn("calibration recall hit its limit; older snapshots may be cut", { decisionDate: D, n: got.length });
      found = newestSnapshot(got.filter((m) => usableAt(m, "calibration", D)));
      const sim = found ? decodeHeader(found.text)?.fields.sim : undefined;
      if (sim === expected) return found;
      if (attempt === 1) await new Promise((r) => setTimeout(r, deps.calibrationRetryMs ?? 5000));
      else {
        log.warn("calibration recall did not return the newest snapshot", { decisionDate: D, expected, got: sim ?? null });
        (cp.calibrationMisses ??= []).push({ decisionDate: D, expected: expected ?? null, got: sim ?? null });
        save();
      }
    }
    return found;
  }

  async function recallLessons(q: Question, D: string): Promise<RecalledMemory[]> {
    const got = await store.recall({
      namespace: cp.namespaces.lessons,
      query: recallQuery(q),
      limit: config.RECALL_LIMIT,
      maxDistance: config.RECALL_MAX_DISTANCE,
    });
    return got.filter((m) => usableAt(m, "lesson", D)).sort((a, b) => a.distance - b.distance);
  }

  // ── §7.3 step 4: forecast every question decided on D ───────────────────
  async function forecastWeek(arm: Arm, D: string): Promise<{ n: number; meanP: number; recalled: number; cost: number }> {
    const saved = (cp.forecasts[arm] ??= {});
    const todo = (byDate.get(D) ?? []).filter((q) => !saved[q.id]);
    const calibration = arm === "mem" && todo.length > 0 ? await recallCalibration(D) : undefined;
    let recalledCount = 0;
    let cost = 0;

    await mapLimit(todo, arm === "base" ? todo.length || 1 : config.LLM_CONCURRENCY, async (q) => {
      let f: Forecast;
      if (arm === "base") {
        const past = cp.questions.filter((x) => x.symbol === q.symbol && x.type === q.type && x.resolveDate <= D);
        const ys = past.map((x) => outcomeAt(x, D)!);
        const k = ys.filter((y) => y === 1).length;
        f = {
          questionId: q.id,
          arm,
          p: laplaceRate(ys),
          rationale: `Trailing base rate (k+1)/(n+2) with k=${k} YES of n=${ys.length} resolved ${q.type} questions on this asset.`,
          citedBlobIds: [],
          recalled: [],
          model: BASE_MODEL,
          createdAt: new Date().toISOString(),
        };
      } else {
        let lessons: PromptLesson[] | undefined;
        let recalled: RecalledMemory[] = [];
        if (arm === "mem") {
          const ls = await recallLessons(q, D);
          lessons = ls.map((m) => ({ blobId: m.blobId, body: memoryBody(m.text) }));
          recalled = calibration ? [...ls, calibration] : ls;
          recalledCount += ls.length;
        }
        const prompt = renderForecastPrompt({
          question: q,
          candles: candlesOf(q),
          horizon,
          ...(lessons ? { lessons } : {}),
          ...(calibration ? { calibration: memoryBody(calibration.text) } : {}),
        });
        const out = await forecaster.forecast(prompt, lessons?.map((l) => l.blobId) ?? []);
        addCost(arm, out.costUsd);
        cost += out.costUsd ?? 0;
        f = { questionId: q.id, arm, p: out.p, rationale: out.rationale, citedBlobIds: out.cited, recalled, model: out.model, createdAt: new Date().toISOString() };
      }
      saved[q.id] = f;
      save(); // immediately (§7.3)
    });

    const ps = (byDate.get(D) ?? []).flatMap((q) => (saved[q.id] ? [saved[q.id]!.p] : []));
    return { n: ps.length, meanP: ps.reduce((a, b) => a + b, 0) / (ps.length || 1), recalled: recalledCount, cost };
  }

  const reports: WeekReport[] = [];
  for (const arm of sortArms(deps.arms)) {
    for (const D of weeks) {
      if ((cp.progress[arm] ?? "") >= D) continue;
      // Step 1: resolve everything due by D (outcomes are revealed only through outcomeAt's date gate).
      for (const q of cp.questions) outcomeAt(q, D);
      const lessons = arm === "mem" ? await reflect(D) : { written: 0, skipped: 0 };
      const calibrationN = arm === "mem" ? await calibrate(D) : undefined;
      const fw = await forecastWeek(arm, D);
      cp.progress[arm] = D;
      save();
      const report: WeekReport = {
        arm,
        decisionDate: D,
        forecasts: fw.n,
        meanP: fw.meanP,
        lessonsWritten: lessons.written,
        reflectionsSkipped: lessons.skipped,
        ...(calibrationN !== undefined ? { calibrationN } : {}),
        recalledLessons: fw.recalled,
        costUsd: fw.cost,
      };
      reports.push(report);
      log.info("week done", {
        arm,
        week: D,
        forecasts: fw.n,
        meanP: Number(fw.meanP.toFixed(3)),
        ...(arm === "mem" ? { lessons: lessons.written, skipped: lessons.skipped, calibrationN, recalledLessons: fw.recalled } : {}),
        ...(fw.cost ? { costUsd: Number(fw.cost.toFixed(4)) } : {}),
      });
    }
  }

  // Close out: resolve the questions of the last processed week (no later forecast can use them).
  const last = weeks[weeks.length - 1];
  if (last) for (const q of cp.questions) if (q.decisionDate <= last) outcomeAt(q, "9999-12-31");
  save();

  return { weeks, reports, metrics: scoreCheckpoint(cp, weeks) };
}

/** Quick per-arm metrics over resolved forecasts in the given weeks (the full scoring is `score`, §8). */
export function scoreCheckpoint(cp: Checkpoint, weeks: readonly string[]): ReplayResult["metrics"] {
  const inRun = new Set(weeks);
  const out: ReplayResult["metrics"] = {};
  for (const arm of ARM_ORDER) {
    const fs = cp.forecasts[arm];
    if (!fs) continue;
    const rows = cp.questions.flatMap((q) => {
      const f = fs[q.id];
      const y = cp.outcomes[q.id];
      return f && y !== undefined && inRun.has(q.decisionDate) ? [{ p: f.p, y, split: q.split }] : [];
    });
    if (rows.length === 0) continue;
    const dev = rows.filter((r) => r.split === "dev");
    const test = rows.filter((r) => r.split === "test");
    out[arm] = { all: armMetrics(rows), ...(dev.length ? { dev: armMetrics(dev) } : {}), ...(test.length ? { test: armMetrics(test) } : {}) };
  }
  return out;
}
