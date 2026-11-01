// §8 scoring (pure): Brier, log loss, accuracy, ECE, reliability, skill vs base, learning curve,
// and the paired block bootstrap by decision week.
import { mulberry32, randInt } from "../util/rng";

export const P_MIN = 0.02;
export const P_MAX = 0.98;

export const clampP = (p: number): number => Math.min(P_MAX, Math.max(P_MIN, p));

export interface Scored {
  p: number;
  y: 0 | 1;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export const brierOne = (p: number, y: 0 | 1): number => (p - y) ** 2;

export function brier(rows: readonly Scored[]): number {
  return mean(rows.map((r) => brierOne(r.p, r.y)));
}

/** Log loss with p clipped to [0.02, 0.98] (§8.1). */
export function logLoss(rows: readonly Scored[]): number {
  return mean(rows.map(({ p, y }) => -Math.log(y === 1 ? clampP(p) : 1 - clampP(p))));
}

/** Accuracy at 0.5; a forecast of exactly 0.5 earns half credit. */
export function accuracy(rows: readonly Scored[]): number {
  return mean(rows.map(({ p, y }) => (p === 0.5 ? 0.5 : (p > 0.5 ? 1 : 0) === y ? 1 : 0)));
}

export interface ReliabilityBin {
  binMid: number;
  meanP: number;
  freqY: number;
  n: number;
}

/** Equal-width bins on [0, 1]; p = 1 falls in the last bin. Empty bins are omitted. */
export function reliability(rows: readonly Scored[], bins = 10): ReliabilityBin[] {
  const acc = Array.from({ length: bins }, () => ({ sumP: 0, sumY: 0, n: 0 }));
  for (const { p, y } of rows) {
    const b = acc[Math.min(bins - 1, Math.floor(p * bins))]!;
    b.sumP += p;
    b.sumY += y;
    b.n++;
  }
  return acc.flatMap((b, i) =>
    b.n === 0 ? [] : [{ binMid: Math.round(((i + 0.5) / bins) * 1000) / 1000, meanP: b.sumP / b.n, freqY: b.sumY / b.n, n: b.n }],
  );
}

/** Expected calibration error: Σ (n_b / N) · |meanP_b − freqY_b|. */
export function ece(rows: readonly Scored[], bins = 10): number {
  if (rows.length === 0) return Number.NaN;
  return reliability(rows, bins).reduce((s, b) => s + (b.n / rows.length) * Math.abs(b.meanP - b.freqY), 0);
}

/** Brier skill score against a reference arm: 1 − Brier(arm) / Brier(base). */
export const brierSkill = (armBrier: number, baseBrier: number): number => 1 - armBrier / baseBrier;

export interface ArmMetrics {
  n: number;
  brier: number;
  logLoss: number;
  accuracy: number;
  ece: number;
}

export function armMetrics(rows: readonly Scored[]): ArmMetrics {
  return { n: rows.length, brier: brier(rows), logLoss: logLoss(rows), accuracy: accuracy(rows), ece: ece(rows) };
}

export interface CurveInput {
  decisionDate: string;
  brier: number;
}

export interface CurvePoint {
  decisionDate: string;
  rolling: number; // mean Brier of the last `window` resolved questions
  cumulative: number; // mean Brier of every question so far
  n: number;
}

/** §8.2 learning curve: one point per decision date, over questions sorted by decision date. */
export function learningCurve(rows: readonly CurveInput[], window = 24): CurvePoint[] {
  const sorted = [...rows].sort((a, b) => (a.decisionDate < b.decisionDate ? -1 : a.decisionDate > b.decisionDate ? 1 : 0));
  const out: CurvePoint[] = [];
  let sum = 0;
  sorted.forEach((r, i) => {
    sum += r.brier;
    const next = sorted[i + 1];
    if (next && next.decisionDate === r.decisionDate) return; // emit once per date, after its last question
    const last = sorted.slice(Math.max(0, i + 1 - window), i + 1);
    out.push({ decisionDate: r.decisionDate, rolling: mean(last.map((x) => x.brier)), cumulative: sum / (i + 1), n: i + 1 });
  });
  return out;
}

export interface PairedDiff {
  week: string; // decision date (the block)
  d: number; // brier_nomem − brier_mem for one question (positive = memory helped)
}

export interface BootstrapResult {
  meanDelta: number;
  ci95: [number, number];
  shareAboveZero: number;
  resamples: number;
  blocks: number;
  n: number;
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** §8.3 paired block bootstrap: resample whole decision weeks with replacement (seeded). */
export function blockBootstrap(diffs: readonly PairedDiff[], resamples = 2000, seed = 42): BootstrapResult {
  const weeks = new Map<string, number[]>();
  for (const { week, d } of diffs) (weeks.get(week) ?? weeks.set(week, []).get(week)!).push(d);
  const blocks = [...weeks.keys()].sort().map((w) => weeks.get(w)!);
  if (blocks.length === 0) throw new Error("no paired differences to bootstrap");
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    let n = 0;
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[randInt(rng, blocks.length)]!;
      for (const d of block) sum += d;
      n += block.length;
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    meanDelta: mean(diffs.map((x) => x.d)),
    ci95: [quantile(means, 0.025), quantile(means, 0.975)],
    shareAboveZero: means.filter((m) => m > 0).length / resamples,
    resamples,
    blocks: blocks.length,
    n: diffs.length,
  };
}

/** Laplace-smoothed trailing base rate (k+1)/(n+2) for the base arm (DECISIONS D18). */
export function laplaceRate(outcomes: readonly (0 | 1)[]): number {
  const k = outcomes.reduce<number>((s, y) => s + y, 0);
  return (k + 1) / (outcomes.length + 2);
}
