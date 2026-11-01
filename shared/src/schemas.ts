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
export const ArmSchema = z.enum(["base", "nomem", "mem"]);
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
