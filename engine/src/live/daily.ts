// §9 live mode: forecasts committed to Walrus Memory before their outcome is knowable.
// v1 (2026-11-01): resolve due forecasts, create today's questions, recall lessons, forecast, commit each
// forecast to tuition.live.forecasts BEFORE exporting, export live.json. Lesson writing and calibration
// snapshots for resolved live forecasts arrive with reflect.ts before the first resolution (2026-11-08).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
import type { Config } from "../config";
import { regimeOf } from "../features/regime";
import { log } from "../log";
import { decodeHeader, encodeMemory, memoryBody } from "../memory/format";
import type { MemoryStore } from "../memory/store";
import { STATE_DIR, WEB_DATA_DIR } from "../paths";
import { isPromptSafe, recallQuery, renderForecastPrompt, type PromptLesson } from "../prompt/render";
import { assetCodeMap, questionsFor, type Skipped } from "../questions/generate";
import { resolveOutcome } from "../questions/resolve";
import { brierOne } from "../score/metrics";
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

const LiveRecordSchema = z.object({
  question: QuestionSchema,
  forecast: ForecastSchema,
  blobId: z.string().min(1),
  committedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
});
const LiveStateSchema = z.object({ version: z.literal(1), records: z.array(LiveRecordSchema) });
export type LiveRecord = z.infer<typeof LiveRecordSchema>;
export type LiveState = z.infer<typeof LiveStateSchema>;

export function readState(path: string): LiveState {
  if (!existsSync(path)) return { version: 1, records: [] };
  return LiveStateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Atomic write (tmp + rename), records in a stable order for readable diffs. */
export function writeState(path: string, state: LiveState): void {
  const records = [...state.records].sort((a, b) =>
    a.question.decisionDate === b.question.decisionDate ? a.question.id.localeCompare(b.question.id) : a.question.decisionDate.localeCompare(b.question.decisionDate),
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(LiveStateSchema.parse({ version: 1, records }), null, 1)}\n`);
  renameSync(`${path}.tmp`, path);
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
  candles: ReadonlyMap<string, readonly Candle[]>;
  now: Date;
  paths: LivePaths;
}

export interface LiveSummary {
  decisionDate: string;
  committed: LiveRecord[];
  alreadyCommitted: number;
  resolvedNow: number;
  skipped: Skipped[];
  file: LiveFile;
}

export async function runLive(deps: LiveDeps): Promise<LiveSummary> {
  const { config, store, forecaster, candles, now, paths } = deps;
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
  await mapLimit(todo, config.LLM_CONCURRENCY, async (q) => {
    const { recalled, lessons } = await recallLiveLessons(store, config, q);
    const prompt = renderForecastPrompt({ question: q, candles: candles.get(q.symbol)!, horizon: config.HORIZON_DAYS, lessons });
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
  return { decisionDate, committed, alreadyCommitted: fresh.length - todo.length, resolvedNow, skipped, file };
}
