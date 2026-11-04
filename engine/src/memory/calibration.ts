// §7.8 calibration snapshot (pure). Groups resolved forecasts by type × trend × volRegime and reports,
// for each group with n ≥ 4, how far the mean forecast sat from the observed frequency. Written to
// Walrus Memory each week once at least 8 forecasts are resolved, and recalled into later prompts.
import type { QuestionType, Trend, VolRegime } from "@tuition/shared";
import { brier } from "../score/metrics";
import { encodeMemory, MAX_MEMORY_CHARS } from "./format";

export const MIN_RESOLVED = 8;
export const MIN_GROUP = 4;
export const MAX_GROUPS = 8;

export interface CalibrationRow {
  type: QuestionType;
  trend: Trend;
  volRegime: VolRegime;
  p: number;
  y: 0 | 1;
}

export interface CalibrationGroup {
  type: QuestionType;
  trend: Trend;
  volRegime: VolRegime;
  n: number;
  meanP: number;
  freqY: number;
  gap: number; // freqY − meanP: positive means my P(YES) was too low
}

export interface CalibrationSnapshot {
  text: string;
  n: number;
  brier: number;
  groups: CalibrationGroup[]; // the groups listed in the text, largest |gap| first
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Every group with at least MIN_GROUP forecasts, largest |gap| first (ties: larger n, then name). */
export function calibrationGroups(rows: readonly CalibrationRow[]): CalibrationGroup[] {
  const by = new Map<string, CalibrationRow[]>();
  for (const r of rows) {
    const k = `${r.type}|${r.trend}|${r.volRegime}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(r);
  }
  const groups: CalibrationGroup[] = [];
  for (const [k, rs] of by) {
    if (rs.length < MIN_GROUP) continue;
    const [type, trend, volRegime] = k.split("|") as [QuestionType, Trend, VolRegime];
    const meanP = mean(rs.map((r) => r.p));
    const freqY = mean(rs.map((r) => r.y));
    groups.push({ type, trend, volRegime, n: rs.length, meanP, freqY, gap: freqY - meanP });
  }
  const name = (g: CalibrationGroup) => `${g.type}|${g.trend}|${g.volRegime}`;
  return groups.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || b.n - a.n || name(a).localeCompare(name(b)));
}

function groupLine(g: CalibrationGroup): string {
  const dir = g.gap >= 0 ? "too LOW" : "too HIGH";
  return (
    `${g.type}, ${g.trend} trend, ${g.volRegime} vol: I forecast ${g.meanP.toFixed(2)} on average (n=${g.n}) ` +
    `but it happened ${g.freqY.toFixed(2)} of the time → my P(YES) was ${dir} by ${Math.abs(g.gap).toFixed(2)}.`
  );
}

/**
 * The snapshot memory text, or null with fewer than MIN_RESOLVED resolved forecasts. Lists at most
 * MAX_GROUPS groups, dropping the smallest gaps if needed to stay within the memory length cap.
 */
export function buildCalibrationSnapshot(args: { runId: string; simDate: string; rows: readonly CalibrationRow[] }): CalibrationSnapshot | null {
  const { runId, simDate, rows } = args;
  if (rows.length < MIN_RESOLVED) return null;
  const overall = brier(rows);
  const all = calibrationGroups(rows);
  for (let k = Math.min(MAX_GROUPS, all.length); k >= 0; k--) {
    const groups = all.slice(0, k);
    const body = [
      `CALIBRATION SNAPSHOT after ${rows.length} resolved forecasts.`,
      ...(groups.length > 0 ? groups.map(groupLine) : [`No regime group has ${MIN_GROUP} or more resolved forecasts yet.`]),
      `Overall Brier so far ${overall.toFixed(3)} (coin-flip is 0.250).`,
    ].join("\n");
    try {
      const text = encodeMemory("calibration", { run: runId, sim: simDate, n: rows.length }, body);
      return { text, n: rows.length, brier: overall, groups };
    } catch (error) {
      if (k === 0 || !(error instanceof Error) || !error.message.includes(`limit is ${MAX_MEMORY_CHARS}`)) throw error;
    }
  }
  return null; // unreachable
}
