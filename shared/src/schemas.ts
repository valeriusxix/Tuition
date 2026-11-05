// zod schemas mirroring types.ts. The web data-file schemas (§12.1: summary, curve,
// reliability, questions, lessons, live, proof) are added here as `export` produces them.
import { z } from "zod";
import type {
  Candle,
  Features,
  Forecast,
  Lesson,
  MemoryLedgerEntry,
  Question,
  RecalledMemory,
} from "./types";

const isoDate = z.iso.date(); // YYYY-MM-DD
const isoDateTime = z.iso.datetime();

export const QuestionTypeSchema = z.enum(["DIRECTION", "BREAKOUT"]);
export const ArmSchema = z.enum(["base", "nomem", "nomem2", "mem"]);
export const SplitSchema = z.enum(["dev", "test", "live"]);
export const TrendSchema = z.enum(["up", "down", "flat"]);
export const VolRegimeSchema = z.enum(["low", "normal", "high"]);
export const VolTrendSchema = z.enum(["expanding", "contracting", "stable"]);

export const CandleSchema = z.object({
  t: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
}) satisfies z.ZodType<Candle>;

export const FeaturesSchema = z.object({
  ret7: z.number(),
  ret30: z.number(),
  vol7: z.number(),
  vol30: z.number(),
  volRatio: z.number(),
  smaDist20: z.number(),
  smaSlope20: z.number(),
  drawdown30: z.number().min(0),
  lastRange: z.number(),
  trend: TrendSchema,
  volRegime: VolRegimeSchema,
  volTrend: VolTrendSchema,
}) satisfies z.ZodType<Features>;

export const QuestionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  assetCode: z.string(),
  type: QuestionTypeSchema,
  decisionDate: isoDate,
  resolveDate: isoDate,
  threshold: z.number().positive().optional(),
  split: SplitSchema,
  features: FeaturesSchema,
  outcome: z.union([z.literal(0), z.literal(1)]).optional(),
  skipped: z.string().optional(),
}) satisfies z.ZodType<Question>;

export const RecalledMemorySchema = z.object({
  blobId: z.string(),
  distance: z.number(),
  text: z.string(),
  kind: z.enum(["lesson", "calibration"]),
}) satisfies z.ZodType<RecalledMemory>;

export const ForecastSchema = z.object({
  questionId: z.string(),
  arm: ArmSchema,
  p: z.number().min(0.02).max(0.98),
  rationale: z.string(),
  citedBlobIds: z.array(z.string()),
  recalled: z.array(RecalledMemorySchema),
  model: z.string(),
  createdAt: isoDateTime,
}) satisfies z.ZodType<Forecast>;

export const LessonSchema = z.object({
  blobId: z.string(),
  runId: z.string(),
  questionId: z.string(),
  type: QuestionTypeSchema,
  regime: z.string(),
  createdSimDate: isoDate,
  text: z.string().max(1000),
  adjustment: z.enum(["raise", "lower", "none"]),
  magnitude: z.number().min(0).max(0.3),
  timesCited: z.number().int().min(0),
}) satisfies z.ZodType<Lesson>;

// ── web/public/data/live.json (§12.1) ──────────────────────────────────────

export const LiveForecastRowSchema = z.object({
  questionId: z.string(),
  symbol: z.string(), // live forecasts are public commitments: the real ticker is shown (§9.5)
  assetCode: z.string(),
  type: QuestionTypeSchema,
  decisionDate: isoDate,
  resolveDate: isoDate,
  threshold: z.number().positive().optional(),
  regime: z.string(),
  p: z.number().min(0.02).max(0.98),
  rationale: z.string(),
  model: z.string(),
  citedBlobIds: z.array(z.string()),
  recalledBlobIds: z.array(z.string()),
  blobId: z.string().min(1), // the commitment memory on Walrus
  committedAt: isoDateTime, // when the write completed, before the outcome was knowable
  outcome: z.union([z.literal(0), z.literal(1)]).optional(),
  brier: z.number().min(0).max(1).optional(),
});

export const LiveFileSchema = z.object({
  generatedAt: isoDateTime,
  namespace: z.string(),
  latestDecisionDate: isoDate.nullable(),
  pending: z.array(LiveForecastRowSchema),
  resolved: z.array(LiveForecastRowSchema),
  metrics: z.object({
    pending: z.number().int().min(0),
    resolved: z.number().int().min(0),
    brier: z.number().nullable(),
  }),
});

export type LiveForecastRow = z.infer<typeof LiveForecastRowSchema>;
export type LiveFile = z.infer<typeof LiveFileSchema>;

// ── Replay results: summary, curve, reliability, questions, lessons (§12.1) ─
// Written by `export --run <runId>` from a replay checkpoint. Every metric is computed on the
// questions that every arm of the run forecast and that have resolved (the same set for all arms).

export const ScoreSplitSchema = z.enum(["all", "dev", "test"]);
export const ScoreTypeSchema = z.enum(["all", "DIRECTION", "BREAKOUT"]);

const count = z.number().int().min(0);

export const ArmMetricsSchema = z.object({
  n: z.number().int().min(1),
  brier: z.number().min(0).max(1),
  logLoss: z.number().min(0),
  accuracy: z.number().min(0).max(1),
  ece: z.number().min(0).max(1),
  skillVsBase: z.number().nullable(), // 1 − Brier/Brier(base) on the same questions; null for base itself
});

/** metrics[arm][split][type]: split all/dev/test × type all/DIRECTION/BREAKOUT; empty slices are omitted. */
export const ArmSlicesSchema = z.partialRecord(ScoreSplitSchema, z.partialRecord(ScoreTypeSchema, ArmMetricsSchema));

/** A paired block bootstrap by decision week (§8.3). Positive meanDelta = the candidate arm is better. */
export const ComparisonSchema = z.object({
  id: z.string(), // `${candidate}_vs_${reference}`, e.g. "mem_vs_nomem"
  candidate: ArmSchema,
  reference: ArmSchema,
  split: ScoreSplitSchema,
  candidateBrier: z.number(),
  referenceBrier: z.number(),
  meanDelta: z.number(), // mean of brier(reference) − brier(candidate)
  ci95: z.tuple([z.number(), z.number()]),
  shareAboveZero: z.number().min(0).max(1),
  resamples: z.number().int().min(1),
  blocks: z.number().int().min(1), // decision weeks
  n: z.number().int().min(1),
});

/** §8.5 over mem forecasts that have a nomem twin and an outcome. */
export const InfluenceSummarySchema = z.object({
  paired: count,
  citing: count, // cited at least one lesson
  meanShiftCiting: z.number().nullable(), // mean p_mem − p_nomem when citing
  meanAbsShiftCiting: z.number().nullable(),
  meanBrierGainCiting: z.number().nullable(), // mean brier_nomem − brier_mem when citing
  meanBrierGainNotCiting: z.number().nullable(),
});

export const SummaryFileSchema = z.object({
  generatedAt: isoDateTime,
  runId: z.string(),
  mode: z.enum(["official", "dev", "dry"]),
  runCreatedAt: isoDateTime,
  config: z.object({
    forecastModel: z.string(),
    reflectModel: z.string(),
    assets: z.array(z.string()),
    replayStart: isoDate,
    replayEnd: isoDate,
    devSplitEnd: isoDate,
    horizonDays: z.number().int(),
    lessonErrorThreshold: z.number(),
    recallLimit: z.number().int(),
    recallMaxDistance: z.number(),
    seed: z.number().int(),
  }),
  namespaces: z.object({ lessons: z.string(), calibration: z.string() }),
  weeks: z.object({ count, first: isoDate.nullable(), last: isoDate.nullable() }),
  counts: z.object({
    questions: count, // scored questions (the common set)
    bySplit: z.partialRecord(SplitSchema, count),
    byType: z.partialRecord(QuestionTypeSchema, count),
    lessons: count, // written to Walrus
    calibrations: count,
    reflectionSkips: count,
  }),
  arms: z.array(ArmSchema),
  metrics: z.partialRecord(ArmSchema, ArmSlicesSchema),
  comparisons: z.array(ComparisonSchema),
  headline: ComparisonSchema.nullable(), // mem vs nomem on the test split (dev for a run without test weeks)
  influence: InfluenceSummarySchema.nullable(),
  memories: z.object({
    run: z.object({ lessons: count, calibrations: count }),
    mainnet: z.object({ total: count, byKind: z.record(z.string(), count), byNamespace: z.record(z.string(), count) }),
  }),
  costUsd: z.record(z.string(), z.number()),
});

export const CurvePointSchema = z.object({
  decisionDate: isoDate,
  rolling: z.number(), // mean Brier of the last `window` scored questions
  cumulative: z.number(),
  n: z.number().int().min(1),
});

export const CurveFileSchema = z.object({
  runId: z.string(),
  window: z.number().int().min(1),
  arms: z.partialRecord(ArmSchema, z.array(CurvePointSchema)),
});

export const ReliabilityBinSchema = z.object({
  binMid: z.number(),
  meanP: z.number(),
  freqY: z.number(),
  n: z.number().int().min(1),
});

export const ReliabilityFileSchema = z.object({
  runId: z.string(),
  bins: z.number().int().min(1),
  arms: z.partialRecord(
    ArmSchema,
    z.partialRecord(ScoreSplitSchema, z.object({ n: z.number().int().min(1), ece: z.number(), bins: z.array(ReliabilityBinSchema) })),
  ),
});

export const QuestionForecastSchema = z.object({
  p: z.number().min(0).max(1),
  rationale: z.string(),
  model: z.string(),
  citedBlobIds: z.array(z.string()),
  recalled: z.array(z.object({ blobId: z.string(), distance: z.number(), kind: z.enum(["lesson", "calibration"]) })),
  brier: z.number().min(0).max(1).optional(),
});

export const QuestionRowSchema = z.object({
  id: z.string(),
  symbol: z.string(), // shown after the fact; the model only ever saw assetCode
  assetCode: z.string(),
  type: QuestionTypeSchema,
  decisionDate: isoDate,
  resolveDate: isoDate,
  threshold: z.number().positive().optional(),
  split: SplitSchema,
  regime: z.string(),
  features: FeaturesSchema,
  outcome: z.union([z.literal(0), z.literal(1)]).optional(),
  /** Closes rebased so day 0 = 100, from day `dayFrom` (normally −59) to day +HORIZON; future highs/lows for days +1..+HORIZON. */
  path: z.object({
    dayFrom: z.number().int().max(0),
    closes: z.array(z.number()),
    futureHighs: z.array(z.number()),
    futureLows: z.array(z.number()),
  }),
  forecasts: z.partialRecord(ArmSchema, QuestionForecastSchema),
  shift: z.number().optional(), // p_mem − p_nomem
  brierGain: z.number().optional(), // brier_nomem − brier_mem (positive = memory helped)
});

export const QuestionsFileSchema = z.object({
  runId: z.string(),
  horizonDays: z.number().int().min(1),
  questions: z.array(QuestionRowSchema),
});

export const LessonRowSchema = LessonSchema.extend({
  body: z.string(), // the memory text without its machine header
  timesRecalled: count,
  citedBy: z.array(z.string()), // question IDs whose mem forecast cited it
  meanBrierGainWhenCited: z.number().nullable(),
  meanShiftWhenCited: z.number().nullable(),
});

export const CalibrationRowSchema = z.object({
  blobId: z.string().min(1),
  simDate: isoDate,
  n: count,
  brier: z.number(),
  body: z.string(),
});

export const LessonsFileSchema = z.object({
  runId: z.string(),
  namespaces: z.object({ lessons: z.string(), calibration: z.string() }),
  lessons: z.array(LessonRowSchema),
  calibrations: z.array(CalibrationRowSchema),
});

export type ScoreSplit = z.infer<typeof ScoreSplitSchema>;
export type ScoreType = z.infer<typeof ScoreTypeSchema>;
export type ArmMetricsRow = z.infer<typeof ArmMetricsSchema>;
export type ArmSlices = z.infer<typeof ArmSlicesSchema>;
export type Comparison = z.infer<typeof ComparisonSchema>;
export type InfluenceSummary = z.infer<typeof InfluenceSummarySchema>;
export type SummaryFile = z.infer<typeof SummaryFileSchema>;
export type CurveFile = z.infer<typeof CurveFileSchema>;
export type ReliabilityFile = z.infer<typeof ReliabilityFileSchema>;
export type QuestionRow = z.infer<typeof QuestionRowSchema>;
export type QuestionsFile = z.infer<typeof QuestionsFileSchema>;
export type LessonRow = z.infer<typeof LessonRowSchema>;
export type CalibrationRow = z.infer<typeof CalibrationRowSchema>;
export type LessonsFile = z.infer<typeof LessonsFileSchema>;

export const MemoryLedgerEntrySchema = z.object({
  key: z.string().regex(/^[0-9a-f]{64}$/),
  namespace: z.string().min(1),
  kind: z.enum(["lesson", "calibration", "forecast", "smoke"]),
  blobId: z.string().min(1),
  jobId: z.string().min(1),
  createdAt: isoDateTime,
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdSimDate: isoDate.optional(),
}) satisfies z.ZodType<MemoryLedgerEntry>;
