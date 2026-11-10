// §12.1 web data files from a replay checkpoint: summary, curve, reliability, questions, lessons.
// buildWebData() is pure; writeWebData() validates every file against its shared schema before
// writing any of them (all or nothing), then writes each atomically (tmp + rename).
// live.json is written by `live` (§9) and proof.json by `verify` (§11).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CurveFileSchema,
  LessonsFileSchema,
  QuestionsFileSchema,
  ReliabilityFileSchema,
  SummaryFileSchema,
  type Candle,
  type CurveFile,
  type LessonsFile,
  type MemoryLedgerEntry,
  type QuestionRow,
  type QuestionsFile,
  type ReliabilityFile,
  type CalibrationUse,
  type RunRef,
  type SummaryFile,
} from "@tuition/shared";
import type { z } from "zod";
import { regimeOf } from "../features/regime";
import { decodeHeader, memoryBody } from "../memory/format";
import { CLOSE_DAYS } from "../prompt/render";
import { indexOfDate } from "../questions/generate";
import { ARM_ORDER, type Checkpoint } from "../replay/checkpoint";
import { brierOne } from "../score/metrics";
import { CURVE_WINDOW, RELIABILITY_BINS, type RunReport } from "../score/report";
import { replaceFile } from "../util/atomic";

export interface WebData {
  summary: SummaryFile;
  curve: CurveFile;
  reliability: ReliabilityFile;
  questions: QuestionsFile;
  lessons: LessonsFile;
}

export const WEB_FILES: { readonly [K in keyof WebData]: { file: string; schema: z.ZodType<WebData[K]> } } = {
  summary: { file: "summary.json", schema: SummaryFileSchema },
  curve: { file: "curve.json", schema: CurveFileSchema },
  reliability: { file: "reliability.json", schema: ReliabilityFileSchema },
  questions: { file: "questions.json", schema: QuestionsFileSchema },
  lessons: { file: "lessons.json", schema: LessonsFileSchema },
};

const r2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Rounds every non-integer number to 6 decimals, so committed files stay readable and diffable. */
export function round6<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v))) as T;
}

/** The question page's price chart: closes rebased so day 0 = 100, day −59 … +horizon, plus future highs/lows. */
export function pricePath(candles: readonly Candle[], decisionDate: string, horizon: number): QuestionRow["path"] {
  const d = indexOfDate(candles, decisionDate);
  if (d < 0) throw new Error(`no candle on ${decisionDate}`);
  const base = candles[d]!.close;
  const rb = (x: number): number => r2((100 * x) / base);
  const from = Math.max(0, d - (CLOSE_DAYS - 1));
  const to = Math.min(candles.length - 1, d + horizon);
  const future = candles.slice(d + 1, to + 1);
  return {
    dayFrom: from - d,
    closes: candles.slice(from, to + 1).map((c) => rb(c.close)),
    futureHighs: future.map((c) => rb(c.high)),
    futureLows: future.map((c) => rb(c.low)),
  };
}

/** Mainnet memory counts across every ledger, one per blob ID. */
export function ledgerCounts(entries: readonly MemoryLedgerEntry[]): SummaryFile["memories"]["mainnet"] {
  const byBlob = new Map(entries.map((e) => [e.blobId, e]));
  const byKind: Record<string, number> = {};
  const byNamespace: Record<string, number> = {};
  for (const e of byBlob.values()) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    byNamespace[e.namespace] = (byNamespace[e.namespace] ?? 0) + 1;
  }
  return { total: byBlob.size, byKind, byNamespace };
}

/**
 * D51: did each week's memory prompts get the newest calibration snapshot already written? Read from what
 * the forecasts actually recalled, compared with the snapshots the run had written by that week.
 */
export function calibrationUse(cp: Checkpoint): CalibrationUse {
  const mem = cp.forecasts.mem ?? {};
  const sims = [...cp.calibrations.map((c) => c.simDate)].sort();
  const weeks = [...new Set(cp.questions.filter((q) => mem[q.id]).map((q) => q.decisionDate))].sort();
  const used = new Set<string>();
  let counted = 0;
  let stale = 0;
  let streak: { from: string; len: number } | undefined;
  let longest: { from: string; len: number } | undefined;
  for (const D of weeks) {
    const expected = sims.filter((s) => s <= D).at(-1);
    if (!expected) continue;
    counted++;
    const got = cp.questions
      .filter((q) => q.decisionDate === D && mem[q.id])
      .map((q) => mem[q.id]!.recalled.find((m) => m.kind === "calibration"))
      .map((m) => (m ? decodeHeader(m.text)?.fields.sim : undefined))[0];
    if (got) used.add(got);
    if (got === expected) {
      streak = undefined;
      continue;
    }
    stale++;
    streak = streak ? { from: streak.from, len: streak.len + 1 } : { from: D, len: 1 };
    if (!longest || streak.len > longest.len) longest = { ...streak };
  }
  return { written: cp.calibrations.length, used: used.size, weeks: counted, staleWeeks: stale, frozenFrom: longest && longest.len > 1 ? longest.from : null };
}

/** The other run of the D51 pair, summarised for the primary run's summary.json. */
export function runRef(cp: Checkpoint, report: RunReport, role: RunRef["role"]): RunRef {
  const testBrier: RunRef["testBrier"] = {};
  for (const arm of report.arms) {
    const b = report.metrics[arm]?.test?.all?.brier;
    if (b !== undefined) testBrier[arm] = b;
  }
  return {
    runId: cp.runId,
    role,
    createdAt: cp.createdAt,
    headline: report.headline,
    comparisons: report.comparisons.filter((c) => c.split === "test"),
    testBrier,
    lessons: cp.lessons.filter((l) => l.blobId).length,
    calibrationUse: calibrationUse(cp),
  };
}

export interface WebDataInput {
  cp: Checkpoint;
  report: RunReport;
  candles: ReadonlyMap<string, readonly Candle[]>;
  ledgers: readonly MemoryLedgerEntry[]; // every ledger in engine/state (run, live, smoke)
  generatedAt: string;
  otherRun?: RunRef | null; // D51: the original run when exporting its rerun
}

export function buildWebData({ cp, report, candles, ledgers, generatedAt, otherRun }: WebDataInput): WebData {
  const c = cp.config;
  const scored = report.rows;
  const written = cp.lessons.filter((l) => l.blobId);
  const countBy = <K extends string>(key: (r: (typeof scored)[number]) => K): Partial<Record<K, number>> => {
    const out: Partial<Record<K, number>> = {};
    for (const r of scored) out[key(r)] = (out[key(r)] ?? 0) + 1;
    return out;
  };

  const summary: SummaryFile = {
    generatedAt,
    runId: cp.runId,
    mode: cp.mode,
    runCreatedAt: cp.createdAt,
    config: {
      forecastModel: c.FORECAST_MODEL,
      reflectModel: c.REFLECT_MODEL,
      assets: c.ASSETS,
      replayStart: c.REPLAY_START,
      replayEnd: c.REPLAY_END,
      devSplitEnd: c.DEV_SPLIT_END,
      horizonDays: c.HORIZON_DAYS,
      lessonErrorThreshold: c.LESSON_ERROR_THRESHOLD,
      recallLimit: c.RECALL_LIMIT,
      recallMaxDistance: c.RECALL_MAX_DISTANCE,
      seed: c.SEED,
    },
    namespaces: cp.namespaces,
    weeks: { count: report.weeks.length, first: report.weeks[0] ?? null, last: report.weeks[report.weeks.length - 1] ?? null },
    counts: {
      questions: scored.length,
      bySplit: countBy((r) => r.q.split),
      byType: countBy((r) => r.q.type),
      lessons: written.length,
      calibrations: cp.calibrations.length,
      reflectionSkips: cp.reflectionSkips.length,
    },
    arms: report.arms,
    metrics: report.metrics,
    comparisons: report.comparisons,
    headline: report.headline,
    influence: report.influence,
    memories: { run: { lessons: written.length, calibrations: cp.calibrations.length }, mainnet: ledgerCounts(ledgers) },
    costUsd: cp.costUsd,
    rerunOf: cp.rerunOf ?? null,
    calibrationUse: calibrationUse(cp),
    otherRun: otherRun ?? null,
  };

  // Every question the run forecast in any arm, resolved or not, in question order.
  const forecastIds = new Set(ARM_ORDER.flatMap((a) => Object.keys(cp.forecasts[a] ?? {})));
  const questionRows: QuestionRow[] = cp.questions
    .filter((q) => forecastIds.has(q.id))
    .map((q) => {
      const y = cp.outcomes[q.id];
      const forecasts: QuestionRow["forecasts"] = {};
      for (const arm of ARM_ORDER) {
        const f = cp.forecasts[arm]?.[q.id];
        if (!f) continue;
        forecasts[arm] = {
          p: f.p,
          rationale: f.rationale,
          model: f.model,
          citedBlobIds: f.citedBlobIds,
          recalled: f.recalled.map((m) => ({ blobId: m.blobId, distance: m.distance, kind: m.kind })),
          ...(y !== undefined ? { brier: brierOne(f.p, y) } : {}),
        };
      }
      const series = candles.get(q.symbol);
      if (!series) throw new Error(`no candles for ${q.symbol}`);
      const influence = report.perQuestion.get(q.id);
      return {
        id: q.id,
        symbol: q.symbol,
        assetCode: q.assetCode,
        type: q.type,
        decisionDate: q.decisionDate,
        resolveDate: q.resolveDate,
        ...(q.threshold !== undefined ? { threshold: q.threshold } : {}),
        split: q.split,
        regime: regimeOf(q.features),
        features: q.features,
        ...(y !== undefined ? { outcome: y } : {}),
        path: pricePath(series, q.decisionDate, c.HORIZON_DAYS),
        forecasts,
        ...(influence ? { shift: influence.shift, brierGain: influence.brierGain } : {}),
      };
    });

  const lessons: LessonsFile = {
    runId: cp.runId,
    namespaces: cp.namespaces,
    lessons: written.map((l) => {
      const li = report.perLesson.get(l.blobId!);
      return {
        blobId: l.blobId!,
        runId: cp.runId,
        questionId: l.questionId,
        type: l.type,
        regime: l.regime,
        createdSimDate: l.simDate,
        text: l.text,
        adjustment: l.adjustment,
        magnitude: l.magnitude,
        timesCited: li?.timesCited ?? 0,
        body: memoryBody(l.text),
        timesRecalled: li?.timesRecalled ?? 0,
        citedBy: li?.citedBy ?? [],
        meanBrierGainWhenCited: mean(li?.gains ?? []),
        meanShiftWhenCited: mean(li?.shifts ?? []),
      };
    }),
    calibrations: cp.calibrations.map((s) => ({ blobId: s.blobId, simDate: s.simDate, n: s.n, brier: s.brier, body: memoryBody(s.text) })),
  };

  const data: WebData = {
    summary,
    curve: { runId: cp.runId, window: CURVE_WINDOW, arms: report.curves },
    reliability: { runId: cp.runId, bins: RELIABILITY_BINS, arms: report.reliability },
    questions: { runId: cp.runId, horizonDays: c.HORIZON_DAYS, questions: questionRows },
    lessons,
  };
  // Round, then validate: what is written is exactly what was checked.
  return {
    summary: SummaryFileSchema.parse(round6(data.summary)),
    curve: CurveFileSchema.parse(round6(data.curve)),
    reliability: ReliabilityFileSchema.parse(round6(data.reliability)),
    questions: QuestionsFileSchema.parse(round6(data.questions)),
    lessons: LessonsFileSchema.parse(round6(data.lessons)),
  };
}

/** Validates every file first, then writes each atomically. Returns the written paths. */
export function writeWebData(dir: string, data: WebData): string[] {
  const keys = Object.keys(WEB_FILES) as (keyof WebData)[];
  const checked = keys.map((k) => [WEB_FILES[k].file, WEB_FILES[k].schema.parse(data[k])] as const);
  mkdirSync(dir, { recursive: true });
  return checked.map(([file, value]) => {
    const path = resolve(dir, file);
    writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 1)}\n`);
    replaceFile(`${path}.tmp`, path);
    return path;
  });
}
