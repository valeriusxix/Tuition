// §9 live mode: forecasts committed to Walrus Memory before their outcome is knowable.
// Daily: resolve due forecasts → write a lesson for each bad miss (tuition.live.lessons) → one calibration
// snapshot (tuition.live.calibration, once ≥ 8 are resolved) → create today's questions → recall lessons and
// the latest snapshot → forecast → commit each forecast to tuition.live.forecasts BEFORE exporting live.json.
// A failure while learning (reflect/calibrate) is reported but never blocks the day's commitments.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ForecastSchema,
  LiveFileSchema,
  QuestionSchema,
  type Candle,
  type Forecast,
  type LiveFile,
  type LiveForecastRow,
  type Question,
  type RecalledMemory,
} from "@tuition/shared";
import { z } from "zod";
import type { Forecaster } from "../agent/forecast";
import { lessonMemoryText, ReflectionSkipped, type Reflector } from "../agent/reflect";
import type { Config } from "../config";
import { regimeOf } from "../features/regime";
import { log } from "../log";
import { buildCalibrationSnapshot } from "../memory/calibration";
import { decodeHeader, encodeMemory, memoryBody } from "../memory/format";
import type { MemoryStore } from "../memory/store";
import { STATE_DIR, WEB_DATA_DIR } from "../paths";
import { isPromptSafe, recallQuery, renderForecastPrompt, renderReflectionPrompt, type PromptLesson } from "../prompt/render";
import { assetCodeMap, questionsFor, type Skipped } from "../questions/generate";
import { resolveOutcome } from "../questions/resolve";
import { brierOne } from "../score/metrics";
import { replaceFile } from "../util/atomic";
import { yesterdayUtc } from "../util/dates";
import { memoryKey } from "../util/hash";
import { mapLimit } from "../util/ratelimit";

export const LIVE_RUN = "live";
export const LIVE_NAMESPACES = {
  forecasts: "tuition.live.forecasts",
  lessons: "tuition.live.lessons",
  calibration: "tuition.live.calibration",
} as const;

export interface LivePaths {
  stateFile: string;
  ledgerFile: string;
  liveJson: string;
}

export const DEFAULT_LIVE_PATHS: LivePaths = {
  stateFile: resolve(STATE_DIR, "live-forecasts.json"),
  ledgerFile: resolve(STATE_DIR, "live-ledger.jsonl"), // committed by the live job (D18)
  liveJson: resolve(WEB_DATA_DIR, "live.json"),
};

const LiveLessonSchema = z.object({
  text: z.string().max(1000),
  adjustment: z.enum(["raise", "lower", "none"]),
  magnitude: z.number().min(0).max(0.3),
  model: z.string(),
  blobId: z.string().min(1).optional(), // absent while the write is pending (saved before writing, D32)
});
const LiveRecordSchema = z.object({
  question: QuestionSchema,
  forecast: ForecastSchema,
  blobId: z.string().min(1),
  committedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
  lesson: LiveLessonSchema.optional(),
  reflectionSkipped: z.string().optional(),
});
const LiveCalibrationSchema = z.object({ simDate: z.iso.date(), n: z.number().int(), blobId: z.string().min(1) });
const LiveStateSchema = z.object({
  version: z.literal(1),
  records: z.array(LiveRecordSchema),
  calibrations: z.array(LiveCalibrationSchema).default([]),
});
export type LiveRecord = z.infer<typeof LiveRecordSchema>;
export type LiveState = z.infer<typeof LiveStateSchema>;

export function readState(path: string): LiveState {
  if (!existsSync(path)) return { version: 1, records: [], calibrations: [] };
  return LiveStateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Atomic write (tmp + rename), records in a stable order for readable diffs. */
export function writeState(path: string, state: LiveState): void {
  const records = [...state.records].sort((a, b) =>
    a.question.decisionDate === b.question.decisionDate ? a.question.id.localeCompare(b.question.id) : a.question.decisionDate.localeCompare(b.question.decisionDate),
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(LiveStateSchema.parse({ ...state, records }), null, 1)}\n`);
  replaceFile(`${path}.tmp`, path);
}

/** §9.5 commitment text: the real symbol appears in the header only; the body names the asset code. */
export function forecastMemoryText(q: Question, f: Pick<Forecast, "p" | "rationale">): string {
  const what = q.type === "BREAKOUT" && q.threshold !== undefined ? `BREAKOUT ±${(q.threshold * 100).toFixed(1)}%` : q.type;
  const body = `FORECAST (${what}, ${q.assetCode}, made on sim day ${q.decisionDate}, resolves ${q.resolveDate}): P(YES)=${f.p.toFixed(2)}. Rationale: ${f.rationale}`;
  return encodeMemory(
    "forecast",
    { run: LIVE_RUN, q: q.id, sym: q.symbol, type: q.type, sim: q.decisionDate, resolves: q.resolveDate, p: f.p.toFixed(2) },
    body,
  );
}

/** Runs whose lessons live mode may use: its own, plus the official replay run(s) named in config. */
export function allowedRuns(namespaces: readonly string[]): Set<string> {
  const runs = new Set([LIVE_RUN]);
  for (const ns of namespaces) {
    const m = /^tuition\.(.+)\.lessons$/.exec(ns);
    if (m) runs.add(m[1]!);
  }
  return runs;
}

/** §9.4 / D18: recall lessons from every live namespace, merge by distance, keep only safe and past ones. */
export async function recallLiveLessons(
  store: MemoryStore,
  config: Config,
  q: Question,
): Promise<{ recalled: RecalledMemory[]; lessons: PromptLesson[] }> {
  const namespaces = [...new Set([...config.LIVE_LESSON_NAMESPACES, LIVE_NAMESPACES.lessons])];
  const runs = allowedRuns(namespaces);
  const query = recallQuery(q);
  const all: RecalledMemory[] = [];
  for (const namespace of namespaces) {
    try {
      all.push(...(await store.recall({ namespace, query, limit: config.RECALL_LIMIT, maxDistance: config.RECALL_MAX_DISTANCE })));
    } catch (error) {
      log.warn("lesson recall failed; forecasting without this namespace", { namespace, error });
    }
  }
  const tickers = config.ASSETS;
  const usable = all
    .filter((m) => {
      const h = decodeHeader(m.text);
      return h?.kind === "lesson" && runs.has(h.fields.run ?? "") && (h.fields.sim ?? "9999") <= q.decisionDate;
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, config.RECALL_LIMIT);
  const lessons = usable.map((m) => ({ blobId: m.blobId, body: memoryBody(m.text) })).filter((l) => isPromptSafe(l.body, tickers));
  return { recalled: usable, lessons };
}

/** The latest live calibration snapshot knowable at the decision date, as a prompt-safe body. */
export async function recallLiveCalibration(store: MemoryStore, config: Config, decisionDate: string): Promise<RecalledMemory | undefined> {
  try {
    const got = await store.recall({ namespace: LIVE_NAMESPACES.calibration, query: "calibration snapshot", limit: 1, sort: "recent" });
    return got.find((m) => {
      const h = decodeHeader(m.text);
      return h?.kind === "calibration" && h.fields.run === LIVE_RUN && (h.fields.sim ?? "9999") <= decisionDate && isPromptSafe(memoryBody(m.text), config.ASSETS);
    });
  } catch (error) {
    log.warn("calibration recall failed; forecasting without it", { error });
    return undefined;
  }
}

function row(r: LiveRecord): LiveForecastRow {
  const q = r.question;
  return {
    questionId: q.id,
    symbol: q.symbol,
    assetCode: q.assetCode,
    type: q.type,
    decisionDate: q.decisionDate,
    resolveDate: q.resolveDate,
    ...(q.threshold !== undefined ? { threshold: q.threshold } : {}),
    regime: regimeOf(q.features),
    p: r.forecast.p,
    rationale: r.forecast.rationale,
    model: r.forecast.model,
    citedBlobIds: r.forecast.citedBlobIds,
    recalledBlobIds: r.forecast.recalled.map((m) => m.blobId),
    blobId: r.blobId,
    committedAt: r.committedAt,
    ...(q.outcome !== undefined ? { outcome: q.outcome, brier: brierOne(r.forecast.p, q.outcome) } : {}),
  };
}

export function buildLiveFile(state: LiveState, now: Date): LiveFile {
  const rows = state.records.map(row);
  const resolved = rows.filter((r) => r.outcome !== undefined);
  const latest = rows.reduce<string | null>((m, r) => (m === null || r.decisionDate > m ? r.decisionDate : m), null);
  return LiveFileSchema.parse({
    generatedAt: now.toISOString(),
    namespace: LIVE_NAMESPACES.forecasts,
    latestDecisionDate: latest,
    pending: rows.filter((r) => r.outcome === undefined),
    resolved,
    metrics: {
      pending: rows.length - resolved.length,
      resolved: resolved.length,
      brier: resolved.length ? resolved.reduce((s, r) => s + (r.brier ?? 0), 0) / resolved.length : null,
    },
  });
}

export interface LiveDeps {
  config: Config;
  store: MemoryStore;
  forecaster: Forecaster;
  reflector: Reflector;
  candles: ReadonlyMap<string, readonly Candle[]>;
  now: Date;
  paths: LivePaths;
}

export interface LiveSummary {
  decisionDate: string;
  committed: LiveRecord[];
  alreadyCommitted: number;
  resolvedNow: number;
  lessonsWritten: number;
  calibrationN?: number;
  /** Learning steps that failed (logged); the commitments still went ahead. The CLI exits non-zero. */
  problems: string[];
  skipped: Skipped[];
  file: LiveFile;
}

export async function runLive(deps: LiveDeps): Promise<LiveSummary> {
  const { config, store, forecaster, reflector, candles, now, paths } = deps;
  const state = readState(paths.stateFile);
  const lastClosed = yesterdayUtc(now);

  // Step 2 (v1: outcomes only): resolve commitments whose window has closed.
  let resolvedNow = 0;
  for (const r of state.records) {
    if (r.question.outcome !== undefined || r.question.resolveDate > lastClosed) continue;
    const c = candles.get(r.question.symbol);
    const outcome = c ? resolveOutcome(r.question, c, config.HORIZON_DAYS) : undefined;
    if (outcome === undefined) continue; // candle not available yet; retried tomorrow
    r.question = { ...r.question, outcome };
    r.resolvedAt = now.toISOString();
    resolvedNow++;
  }
  if (resolvedNow > 0) writeState(paths.stateFile, state);

  // Step 2 (learning): a lesson for every bad miss not yet written, then one calibration snapshot per day.
  const problems: string[] = [];
  let lessonsWritten = 0;
  const misses = state.records.filter(
    (r) =>
      r.question.outcome !== undefined &&
      !r.lesson?.blobId &&
      r.reflectionSkipped === undefined &&
      Math.abs(r.forecast.p - r.question.outcome) >= config.LESSON_ERROR_THRESHOLD,
  );
  await mapLimit(misses, config.LLM_CONCURRENCY, async (r) => {
    const q = r.question;
    try {
      if (!r.lesson) {
        const c = candles.get(q.symbol)!;
        const prompt = renderReflectionPrompt({ question: q, candles: c, horizon: config.HORIZON_DAYS, p: r.forecast.p, rationale: r.forecast.rationale, outcome: q.outcome! });
        const out = await reflector.reflect(prompt);
        r.lesson = {
          text: lessonMemoryText({ runId: LIVE_RUN, question: q, simDate: q.resolveDate, result: out }),
          adjustment: out.adjustment,
          magnitude: out.magnitude,
          model: out.model,
        };
        writeState(paths.stateFile, state); // before writing, so a retry writes this exact text
      }
      const { blobId } = await store.write({
        namespace: LIVE_NAMESPACES.lessons,
        text: r.lesson.text,
        key: memoryKey(LIVE_RUN, "lesson", q.id),
        kind: "lesson",
        simDate: q.resolveDate,
      });
      r.lesson.blobId = blobId;
      writeState(paths.stateFile, state);
      lessonsWritten++;
      log.info("wrote live lesson", { id: q.id, blobId });
    } catch (error) {
      if (error instanceof ReflectionSkipped) {
        r.reflectionSkipped = error.message;
        writeState(paths.stateFile, state);
        log.warn("skipping live lesson", { id: q.id, reason: error.message });
        return;
      }
      problems.push(`lesson for ${q.id}: ${error instanceof Error ? error.message : String(error)}`);
      log.error("live lesson failed; retried on the next run", { id: q.id, error });
    }
  });

  let calibrationN: number | undefined;
  const resolved = state.records.filter((r) => r.question.outcome !== undefined);
  if (!state.calibrations.some((c) => c.simDate === lastClosed)) {
    const snap = buildCalibrationSnapshot({
      runId: LIVE_RUN,
      simDate: lastClosed,
      rows: resolved.map((r) => ({ type: r.question.type, trend: r.question.features.trend, volRegime: r.question.features.volRegime, p: r.forecast.p, y: r.question.outcome! })),
    });
    if (snap) {
      try {
        const { blobId } = await store.write({
          namespace: LIVE_NAMESPACES.calibration,
          text: snap.text,
          key: memoryKey(LIVE_RUN, "calibration", lastClosed),
          kind: "calibration",
          simDate: lastClosed,
        });
        state.calibrations.push({ simDate: lastClosed, n: snap.n, blobId });
        writeState(paths.stateFile, state);
        calibrationN = snap.n;
        log.info("wrote live calibration snapshot", { n: snap.n, blobId });
      } catch (error) {
        problems.push(`calibration snapshot: ${error instanceof Error ? error.message : String(error)}`);
        log.error("live calibration snapshot failed; retried on the next run", { error });
      }
    }
  }

  // Step 3: today's questions; the decision uses the last closed daily candle.
  const decisionDate = lastClosed;
  const codes = assetCodeMap(config.ASSETS, config.SEED);
  const fresh: Question[] = [];
  const skipped: Skipped[] = [];
  for (const symbol of config.ASSETS) {
    const c = candles.get(symbol);
    if (!c) continue;
    const r = questionsFor({ symbol, assetCode: codes.get(symbol)!, candles: c, decisionDate, split: "live", horizon: config.HORIZON_DAYS, needFuture: false });
    fresh.push(...r.questions);
    skipped.push(...r.skipped);
  }
  if (fresh.length === 0) {
    throw new Error(`No live questions for ${decisionDate}: ${skipped.map((s) => `${s.id} (${s.reason})`).join(", ") || "no candles"}`);
  }

  // Steps 4–5: recall, forecast, and commit each forecast to Walrus before it is exported.
  const known = new Set(state.records.map((r) => r.question.id));
  const todo = fresh.filter((q) => !known.has(q.id));
  const committed: LiveRecord[] = [];
  const calibration = todo.length > 0 ? await recallLiveCalibration(store, config, decisionDate) : undefined;
  await mapLimit(todo, config.LLM_CONCURRENCY, async (q) => {
    const { recalled: lessonMems, lessons } = await recallLiveLessons(store, config, q);
    const recalled = calibration ? [...lessonMems, calibration] : lessonMems;
    const prompt = renderForecastPrompt({
      question: q,
      candles: candles.get(q.symbol)!,
      horizon: config.HORIZON_DAYS,
      lessons,
      ...(calibration ? { calibration: memoryBody(calibration.text) } : {}),
    });
    const out = await forecaster.forecast(prompt, lessons.map((l) => l.blobId));
    const forecast: Forecast = {
      questionId: q.id,
      arm: "mem",
      p: out.p,
      rationale: out.rationale,
      citedBlobIds: out.cited,
      recalled,
      model: out.model,
      createdAt: new Date().toISOString(),
    };
    const { blobId } = await store.write({
      namespace: LIVE_NAMESPACES.forecasts,
      text: forecastMemoryText(q, forecast),
      key: memoryKey(LIVE_RUN, "forecast", q.id),
      kind: "forecast",
      simDate: q.decisionDate,
    });
    const record: LiveRecord = { question: q, forecast, blobId, committedAt: new Date().toISOString() };
    state.records.push(record);
    committed.push(record);
    writeState(paths.stateFile, state); // after every commitment, so a crash never loses a written memory
    log.info("committed live forecast", { id: q.id, p: forecast.p, blobId, costUsd: out.costUsd });
  });

  // Step 6: export.
  const file = buildLiveFile(state, now);
  mkdirSync(dirname(paths.liveJson), { recursive: true });
  writeFileSync(paths.liveJson, `${JSON.stringify(file, null, 1)}\n`);
  return {
    decisionDate,
    committed,
    alreadyCommitted: fresh.length - todo.length,
    resolvedNow,
    lessonsWritten,
    ...(calibrationN !== undefined ? { calibrationN } : {}),
    problems,
    skipped,
    file,
  };
}
