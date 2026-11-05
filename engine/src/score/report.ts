// §8 full scoring of a replay checkpoint (pure): per-arm metrics by split and type with skill vs
// base, paired block-bootstrap comparisons (§8.3), learning curves (§8.2), reliability (§8.1) and
// memory influence (§8.5). Plus the cross-run mem-vs-mem comparison used for dev tuning (D38).
//
// Every number is computed on the common set: questions that every arm of the run forecast and
// that have resolved. All arms are therefore always scored on exactly the same questions.
import type {
  Arm,
  ArmSlices,
  Comparison,
  CurveFile,
  InfluenceSummary,
  Question,
  QuestionType,
  ReliabilityFile,
  ScoreSplit,
  ScoreType,
} from "@tuition/shared";
import { ARM_ORDER, type Checkpoint, type LessonRecord } from "../replay/checkpoint";
import { armMetrics, blockBootstrap, brierOne, brierSkill, learningCurve, reliability, ece, type PairedDiff } from "./metrics";

export const CURVE_WINDOW = 24; // §8.2
export const RELIABILITY_BINS = 10; // §8.1
export const BOOTSTRAP_RESAMPLES = 2000; // §8.3

const SPLITS: readonly ScoreSplit[] = ["all", "dev", "test"];
const TYPES: readonly ScoreType[] = ["all", "DIRECTION", "BREAKOUT"];

/** [candidate, reference] pairs, in display order. nomem2 vs nomem is the A/A noise floor (D18). */
export const COMPARISONS: readonly (readonly [Arm, Arm])[] = [
  ["mem", "nomem"],
  ["mem", "nomem2"],
  ["nomem2", "nomem"],
  ["mem", "base"],
  ["nomem", "base"],
];

export interface ScoredRow {
  q: Question;
  y: 0 | 1;
  p: Partial<Record<Arm, number>>;
}

export interface LessonInfluence {
  timesCited: number;
  timesRecalled: number;
  citedBy: string[];
  gains: number[]; // brier_nomem − brier_mem for each scored citing forecast
  shifts: number[]; // p_mem − p_nomem for each scored citing forecast
}

export interface RunReport {
  arms: Arm[];
  weeks: string[]; // decision dates of the scored questions
  rows: ScoredRow[];
  metrics: Partial<Record<Arm, ArmSlices>>;
  comparisons: Comparison[];
  headline: Comparison | null;
  curves: CurveFile["arms"];
  reliability: ReliabilityFile["arms"];
  influence: InfluenceSummary | null;
  perQuestion: Map<string, { shift: number; brierGain: number }>;
  perLesson: Map<string, LessonInfluence>;
}

const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Arms with at least one forecast in the checkpoint, in ARM_ORDER. */
export function runArms(cp: Checkpoint): Arm[] {
  return ARM_ORDER.filter((a) => Object.keys(cp.forecasts[a] ?? {}).length > 0);
}

/** The common set: resolved questions that every arm forecast, by decision date then question order. */
export function scoredRows(cp: Checkpoint, arms: readonly Arm[] = runArms(cp)): ScoredRow[] {
  if (arms.length === 0) return [];
  return cp.questions.flatMap((q) => {
    const y = cp.outcomes[q.id];
    if (y === undefined) return [];
    const p: Partial<Record<Arm, number>> = {};
    for (const a of arms) {
      const f = cp.forecasts[a]?.[q.id];
      if (!f) return [];
      p[a] = f.p;
    }
    return [{ q, y, p }];
  });
}

const inSlice = (r: ScoredRow, split: ScoreSplit, type: ScoreType): boolean =>
  (split === "all" || r.q.split === split) && (type === "all" || r.q.type === (type as QuestionType));

function sliceMetrics(rows: readonly ScoredRow[], arms: readonly Arm[]): Partial<Record<Arm, ArmSlices>> {
  const out: Partial<Record<Arm, ArmSlices>> = {};
  for (const arm of arms) {
    const slices: ArmSlices = {};
    for (const split of SPLITS) {
      for (const type of TYPES) {
        const sub = rows.filter((r) => inSlice(r, split, type));
        if (sub.length === 0) continue;
        const m = armMetrics(sub.map((r) => ({ p: r.p[arm]!, y: r.y })));
        const base = arms.includes("base") && arm !== "base" ? armMetrics(sub.map((r) => ({ p: r.p.base!, y: r.y }))).brier : null;
        (slices[split] ??= {})[type] = { ...m, skillVsBase: base === null || base === 0 ? null : brierSkill(m.brier, base) };
      }
    }
    out[arm] = slices;
  }
  return out;
}

function compare(rows: readonly ScoredRow[], candidate: Arm, reference: Arm, split: ScoreSplit, seed: number): Comparison | null {
  const sub = rows.filter((r) => inSlice(r, split, "all"));
  if (sub.length === 0) return null;
  const diffs: PairedDiff[] = sub.map((r) => ({ week: r.q.decisionDate, d: brierOne(r.p[reference]!, r.y) - brierOne(r.p[candidate]!, r.y) }));
  const b = blockBootstrap(diffs, BOOTSTRAP_RESAMPLES, seed);
  return {
    id: `${candidate}_vs_${reference}`,
    candidate,
    reference,
    split,
    candidateBrier: mean(sub.map((r) => brierOne(r.p[candidate]!, r.y)))!,
    referenceBrier: mean(sub.map((r) => brierOne(r.p[reference]!, r.y)))!,
    meanDelta: b.meanDelta,
    ci95: b.ci95,
    shareAboveZero: b.shareAboveZero,
    resamples: b.resamples,
    blocks: b.blocks,
    n: b.n,
  };
}

/** The headline: mem vs nomem on the test split, or on dev for a run with no test weeks (§8.4). */
export function pickHeadline(comparisons: readonly Comparison[]): Comparison | null {
  const memVsNomem = comparisons.filter((c) => c.id === "mem_vs_nomem");
  return memVsNomem.find((c) => c.split === "test") ?? memVsNomem.find((c) => c.split === "dev") ?? null;
}

function lessonBlobIds(lessons: readonly LessonRecord[]): Set<string> {
  return new Set(lessons.flatMap((l) => (l.blobId ? [l.blobId] : [])));
}

/** §8.5: per-question shift and gain, per-lesson citation stats, and the run-level summary. */
function influence(cp: Checkpoint, rows: readonly ScoredRow[]): Pick<RunReport, "influence" | "perQuestion" | "perLesson"> {
  const known = lessonBlobIds(cp.lessons);
  const perLesson = new Map<string, LessonInfluence>();
  for (const id of known) perLesson.set(id, { timesCited: 0, timesRecalled: 0, citedBy: [], gains: [], shifts: [] });

  // Citations and recalls count over every mem forecast, scored or not.
  for (const f of Object.values(cp.forecasts.mem ?? {})) {
    for (const m of f.recalled) {
      const li = m.kind === "lesson" ? perLesson.get(m.blobId) : undefined;
      if (li) li.timesRecalled++;
    }
    for (const id of new Set(f.citedBlobIds)) {
      const li = perLesson.get(id);
      if (!li) continue;
      li.timesCited++;
      li.citedBy.push(f.questionId);
    }
  }

  const perQuestion = new Map<string, { shift: number; brierGain: number }>();
  const citing: { shift: number; gain: number }[] = [];
  const notCiting: number[] = [];
  for (const r of rows) {
    const pm = r.p.mem;
    const pn = r.p.nomem;
    if (pm === undefined || pn === undefined) continue;
    const shift = pm - pn;
    const gain = brierOne(pn, r.y) - brierOne(pm, r.y);
    perQuestion.set(r.q.id, { shift, brierGain: gain });
    const cited = [...new Set(cp.forecasts.mem?.[r.q.id]?.citedBlobIds ?? [])].filter((id) => known.has(id));
    if (cited.length === 0) {
      notCiting.push(gain);
      continue;
    }
    citing.push({ shift, gain });
    for (const id of cited) {
      const li = perLesson.get(id)!;
      li.gains.push(gain);
      li.shifts.push(shift);
    }
  }

  const paired = citing.length + notCiting.length;
  return {
    perQuestion,
    perLesson,
    influence:
      paired === 0
        ? null
        : {
            paired,
            citing: citing.length,
            meanShiftCiting: mean(citing.map((c) => c.shift)),
            meanAbsShiftCiting: mean(citing.map((c) => Math.abs(c.shift))),
            meanBrierGainCiting: mean(citing.map((c) => c.gain)),
            meanBrierGainNotCiting: mean(notCiting),
          },
  };
}

export function buildReport(cp: Checkpoint): RunReport {
  const arms = runArms(cp);
  const rows = scoredRows(cp, arms);
  const seed = cp.config.SEED;

  const comparisons: Comparison[] = [];
  for (const [candidate, reference] of COMPARISONS) {
    if (!arms.includes(candidate) || !arms.includes(reference)) continue;
    for (const split of SPLITS) {
      const c = compare(rows, candidate, reference, split, seed);
      if (c) comparisons.push(c);
    }
  }

  const curves: CurveFile["arms"] = {};
  const rel: ReliabilityFile["arms"] = {};
  for (const arm of arms) {
    curves[arm] = learningCurve(
      rows.map((r) => ({ decisionDate: r.q.decisionDate, brier: brierOne(r.p[arm]!, r.y) })),
      CURVE_WINDOW,
    );
    for (const split of SPLITS) {
      const sub = rows.filter((r) => inSlice(r, split, "all")).map((r) => ({ p: r.p[arm]!, y: r.y }));
      if (sub.length === 0) continue;
      (rel[arm] ??= {})[split] = { n: sub.length, ece: ece(sub, RELIABILITY_BINS), bins: reliability(sub, RELIABILITY_BINS) };
    }
  }

  return {
    arms,
    weeks: [...new Set(rows.map((r) => r.q.decisionDate))].sort(),
    rows,
    metrics: sliceMetrics(rows, arms),
    comparisons,
    headline: pickHeadline(comparisons),
    curves,
    reliability: rel,
    ...influence(cp, rows),
  };
}

// ── Cross-run comparison for dev tuning (DECISIONS D38) ─────────────────────

export interface NoisePass {
  runId: string;
  arm: Arm;
  brier: number;
}

export interface RunComparison {
  candidateRunId: string;
  referenceRunId: string;
  split: ScoreSplit;
  n: number;
  candidateBrier: number; // mem arm of the candidate run
  referenceBrier: number; // mem arm of the reference run
  bootstrap: ReturnType<typeof blockBootstrap>; // d = brier(mem_reference) − brier(mem_candidate)
  noisePasses: NoisePass[]; // every no-memory pass of every run, on the same questions
  noiseFloor: number; // max − min of noisePasses
  adopt: boolean; // D38: the candidate's mean gain exceeds the noise floor
}

/**
 * D38: compare the candidate run's mem arm with the reference run's mem arm, question by question,
 * on the questions both scored. The noise floor is the Brier range of every nomem/nomem2 pass in the
 * candidate, the reference and any further runs given, all on those same questions.
 */
export function compareRuns(candidate: Checkpoint, reference: Checkpoint, others: readonly Checkpoint[] = [], split: ScoreSplit = "dev"): RunComparison {
  const runs = [reference, ...others, candidate];
  const scored = runs.map((cp) => new Map(scoredRows(cp).map((r) => [r.q.id, r])));
  const cand = scored[scored.length - 1]!;
  const ref = scored[0]!;
  const both = [...cand.values()]
    .filter((r) => inSlice(r, split, "all") && r.p.mem !== undefined && ref.get(r.q.id)?.p.mem !== undefined)
    .map((r) => r.q.id);
  if (both.length === 0) throw new Error(`runs ${candidate.runId} and ${reference.runId} share no scored ${split} questions with a mem forecast`);
  for (const id of both) {
    if (cand.get(id)!.y !== ref.get(id)!.y) throw new Error(`outcome of ${id} differs between ${candidate.runId} and ${reference.runId}`);
  }

  const diffs: PairedDiff[] = both.map((id) => {
    const c = cand.get(id)!;
    const r = ref.get(id)!;
    return { week: c.q.decisionDate, d: brierOne(r.p.mem!, r.y) - brierOne(c.p.mem!, c.y) };
  });
  const bootstrap = blockBootstrap(diffs, BOOTSTRAP_RESAMPLES, candidate.config.SEED);

  const noisePasses: NoisePass[] = [];
  runs.forEach((cp, i) => {
    for (const arm of ["nomem", "nomem2"] as const) {
      const ps = both.map((id) => scored[i]!.get(id)).filter((r): r is ScoredRow => r?.p[arm] !== undefined);
      if (ps.length !== both.length) continue; // only passes that cover every compared question
      noisePasses.push({ runId: cp.runId, arm, brier: mean(ps.map((r) => brierOne(r.p[arm]!, r.y)))! });
    }
  });
  const briers = noisePasses.map((p) => p.brier);
  const noiseFloor = briers.length < 2 ? Number.NaN : Math.max(...briers) - Math.min(...briers);

  return {
    candidateRunId: candidate.runId,
    referenceRunId: reference.runId,
    split,
    n: both.length,
    candidateBrier: mean(both.map((id) => brierOne(cand.get(id)!.p.mem!, cand.get(id)!.y)))!,
    referenceBrier: mean(both.map((id) => brierOne(ref.get(id)!.p.mem!, ref.get(id)!.y)))!,
    bootstrap,
    noisePasses,
    noiseFloor,
    adopt: Number.isFinite(noiseFloor) && bootstrap.meanDelta > noiseFloor,
  };
}
