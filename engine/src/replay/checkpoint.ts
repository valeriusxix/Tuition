// §7.11 run checkpoint: engine/state/run-{runId}.json. Holds the config snapshot, the question list,
// every forecast per arm, resolved outcomes, lessons and calibration snapshots, and per-arm progress.
// Written atomically (tmp + rename) after every forecast and memory write, so `replay --resume` never
// re-calls the LLM for a saved forecast and never writes a memory twice.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ArmSchema, ForecastSchema, QuestionSchema, QuestionTypeSchema, type Arm, type Question } from "@tuition/shared";
import { z } from "zod";
import type { Config } from "../config";
import { UsageError } from "../errors";
import { STATE_DIR } from "../paths";
import { replaceFile } from "../util/atomic";
import { formatDate } from "../util/dates";
import { mulberry32, randomHex, seedFromString } from "../util/rng";

const isoDate = z.iso.date();

/** Arms always run in this order: base and the memory-OFF arms first, then mem (§7.1). */
export const ARM_ORDER: readonly Arm[] = ["base", "nomem", "nomem2", "mem"];

/** The experiment-defining settings. A resumed run uses these, not the current environment. */
export const RunConfigSchema = z.object({
  FORECAST_MODEL: z.string(),
  REFLECT_MODEL: z.string(),
  ANTHROPIC_BASE_URL: z.string(),
  MEMWAL_SERVER_URL: z.string(),
  MEMORY_BACKEND: z.enum(["walrus", "memory"]),
  ASSETS: z.array(z.string()),
  REPLAY_START: isoDate,
  REPLAY_END: isoDate,
  DEV_SPLIT_END: isoDate,
  HORIZON_DAYS: z.number().int(),
  RECALL_LIMIT: z.number().int(),
  RECALL_MAX_DISTANCE: z.number(),
  LESSON_ERROR_THRESHOLD: z.number(),
  SEED: z.number().int(),
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export function runConfigOf(c: Config): RunConfig {
  const keys = Object.keys(RunConfigSchema.shape) as (keyof RunConfig)[];
  return RunConfigSchema.parse(Object.fromEntries(keys.map((k) => [k, c[k]])));
}

/** The current config with a checkpoint's snapshot applied, and the settings that differed. */
export function applySnapshot(c: Config, snap: RunConfig): { config: Config; changed: string[] } {
  const now = runConfigOf(c);
  const changed = (Object.keys(snap) as (keyof RunConfig)[]).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(snap[k]));
  return { config: { ...c, ...snap }, changed };
}

const LessonRecordSchema = z.object({
  questionId: z.string(),
  simDate: isoDate, // the question's resolveDate: when the lesson became knowable
  type: QuestionTypeSchema,
  regime: z.string(),
  text: z.string().max(1000),
  adjustment: z.enum(["raise", "lower", "none"]),
  magnitude: z.number().min(0).max(0.3),
  model: z.string(),
  blobId: z.string().min(1).optional(), // absent while the write is pending (saved before writing, D32)
});
export type LessonRecord = z.infer<typeof LessonRecordSchema>;

const CalibrationRecordSchema = z.object({
  simDate: isoDate,
  n: z.number().int(),
  brier: z.number(),
  text: z.string().max(1000),
  blobId: z.string().min(1),
});
export type CalibrationRecord = z.infer<typeof CalibrationRecordSchema>;

export const CheckpointSchema = z.object({
  version: z.literal(1),
  runId: z.string(),
  mode: z.enum(["official", "dev", "dry"]),
  limit: z.number().int().positive().nullable().optional(), // --limit weeks; null = every week; absent in older checkpoints (D42)
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  config: RunConfigSchema,
  namespaces: z.object({ lessons: z.string(), calibration: z.string() }),
  questions: z.array(QuestionSchema), // as generated: never carries an outcome
  outcomes: z.record(z.string(), z.union([z.literal(0), z.literal(1)])),
  forecasts: z.partialRecord(ArmSchema, z.record(z.string(), ForecastSchema)),
  progress: z.partialRecord(ArmSchema, isoDate), // last completed decision date per arm
  lessons: z.array(LessonRecordSchema),
  reflectionSkips: z.array(z.object({ questionId: z.string(), reason: z.string() })),
  calibrations: z.array(CalibrationRecordSchema),
  // Weeks where recall did not return the newest snapshot the run had written (D51). Absent before D51.
  calibrationMisses: z.array(z.object({ decisionDate: isoDate, expected: isoDate.nullable(), got: isoDate.nullable() })).optional(),
  // The run this one re-runs with one pre-registered change (D51). Absent or null for a first run.
  rerunOf: z.string().nullable().optional(),
  costUsd: z.record(z.string(), z.number()), // per arm, plus "reflect" (when the gateway reports cost)
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export function checkpointPath(runId: string, dir: string = STATE_DIR): string {
  return resolve(dir, `run-${runId}.json`);
}

/** §7.2: "r-" + YYYYMMDD-HHmm (UTC) + "-" + 4 hex, seeded from SEED and the timestamp. */
export function makeRunId(now: Date, seed: number): string {
  const stamp = `${formatDate(now.getTime()).replaceAll("-", "")}-${now.toISOString().slice(11, 16).replace(":", "")}`;
  return `r-${stamp}-${randomHex(mulberry32(seedFromString(`${seed}:${now.toISOString()}`)), 4)}`;
}

export function runNamespaces(runId: string): Checkpoint["namespaces"] {
  return { lessons: `tuition.${runId}.lessons`, calibration: `tuition.${runId}.calibration` };
}

export function newCheckpoint(args: { runId: string; mode: Checkpoint["mode"]; config: Config; questions: readonly Question[]; now: Date; limit?: number | null }): Checkpoint {
  if (args.questions.some((q) => q.outcome !== undefined)) throw new Error("checkpoint questions must not carry outcomes");
  const at = args.now.toISOString();
  return {
    version: 1,
    runId: args.runId,
    mode: args.mode,
    limit: args.limit ?? null,
    createdAt: at,
    updatedAt: at,
    config: runConfigOf(args.config),
    namespaces: runNamespaces(args.runId),
    questions: [...args.questions],
    outcomes: {},
    forecasts: {},
    progress: {},
    lessons: [],
    reflectionSkips: [],
    calibrations: [],
    costUsd: {},
  };
}

export function readCheckpoint(path: string): Checkpoint {
  if (!existsSync(path)) throw new UsageError(`No checkpoint at ${path}. Check the run ID (engine/state/run-<runId>.json).`);
  return CheckpointSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Atomic write: *.tmp, then rename. */
export function writeCheckpoint(path: string, cp: Checkpoint): void {
  cp.updatedAt = new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(cp, null, 1)}\n`);
  replaceFile(`${path}.tmp`, path);
}
