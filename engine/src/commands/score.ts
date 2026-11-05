// `score --run <runId> [--compare <refRunId>[,<runId>…]]` (§8, §10): the full scoring of a replay
// checkpoint, printed as tables. --compare runs the D38 tuning rule: this run's mem arm against the
// first listed run's mem arm, with the noise floor taken over every listed run's no-memory passes.
import type { Arm, ArmMetricsRow, Comparison, ScoreSplit } from "@tuition/shared";
import { UsageError } from "../errors";
import { say } from "../log";
import { checkpointPath, readCheckpoint, type Checkpoint } from "../replay/checkpoint";
import { BOOTSTRAP_RESAMPLES, buildReport, compareRuns, type RunReport } from "../score/report";

export interface ScoreArgs {
  run: string;
  compare: string[];
}

export function parseScoreArgs(args: readonly string[]): ScoreArgs {
  let run: string | undefined;
  let compare: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--run") run = value();
    else if (a === "--compare") compare = value().split(",").map((s) => s.trim()).filter(Boolean);
    else throw new UsageError(`Unknown score option "${a}"`);
  }
  if (!run) throw new UsageError("score needs --run <runId> (see engine/state/run-<runId>.json)");
  return { run, compare };
}

const f3 = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? "  -  " : x.toFixed(3));
const signed = (x: number, d = 4): string => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;

function metricsLine(arm: Arm, split: string, type: string, m: ArmMetricsRow): string {
  return (
    `${arm.padEnd(7)} ${split.padEnd(5)} ${type.padEnd(9)} ${String(m.n).padStart(4)}  ` +
    `${f3(m.brier)}  ${f3(m.logLoss)}  ${f3(m.accuracy)}  ${f3(m.ece)}  ${m.skillVsBase === null ? "   -  " : signed(m.skillVsBase, 3)}`
  );
}

function comparisonLine(c: Comparison): string {
  return (
    `${`${c.candidate} vs ${c.reference}`.padEnd(16)} ${c.split.padEnd(5)} n=${String(c.n).padStart(3)} weeks=${String(c.blocks).padStart(2)}  ` +
    `Brier ${f3(c.candidateBrier)} vs ${f3(c.referenceBrier)}  Δ=${signed(c.meanDelta)}  ` +
    `95% CI [${signed(c.ci95[0])}, ${signed(c.ci95[1])}]  P(Δ>0)=${c.shareAboveZero.toFixed(2)}`
  );
}

export function printReport(cp: Checkpoint, r: RunReport): void {
  const c = cp.config;
  const splits = (["dev", "test"] as const).filter((s) => r.rows.some((x) => x.q.split === s));
  say(`run      ${cp.runId}  (${cp.mode})`);
  say(`weeks    ${r.weeks.length}${r.weeks.length ? ` (${r.weeks[0]} → ${r.weeks[r.weeks.length - 1]})` : ""}; scored questions ${r.rows.length} (${splits.map((s) => `${s} ${r.rows.filter((x) => x.q.split === s).length}`).join(", ")})`);
  say(`models   forecast ${c.FORECAST_MODEL}, reflect ${c.REFLECT_MODEL}`);
  say(`tuning   LESSON_ERROR_THRESHOLD=${c.LESSON_ERROR_THRESHOLD} RECALL_LIMIT=${c.RECALL_LIMIT} RECALL_MAX_DISTANCE=${c.RECALL_MAX_DISTANCE}`);
  if (r.rows.length === 0) {
    say("\nNo scored questions yet (every arm must have forecast a question and it must have resolved).");
    return;
  }

  say("\narm     split type         n  Brier  logloss  acc    ECE    skill vs base");
  const shownSplits: ScoreSplit[] = splits.length > 1 ? ["all", ...splits] : [splits[0] ?? "all"];
  for (const arm of r.arms) for (const split of shownSplits) {
    const m = r.metrics[arm]?.[split]?.all;
    if (m) say(metricsLine(arm, split, "all", m));
  }
  const hs: ScoreSplit = r.headline?.split ?? shownSplits[shownSplits.length - 1]!;
  say(`\nby question type (${hs} split)`);
  for (const arm of r.arms) for (const type of ["DIRECTION", "BREAKOUT"] as const) {
    const m = r.metrics[arm]?.[hs]?.[type];
    if (m) say(metricsLine(arm, hs, type, m));
  }

  say(`\npaired block bootstrap by decision week (${BOOTSTRAP_RESAMPLES} resamples, seed ${c.SEED}); Δ = Brier(reference) − Brier(candidate), positive = candidate better`);
  for (const cmp of r.comparisons) if (cmp.split !== "all" || splits.length > 1) say(comparisonLine(cmp));
  if (r.headline) say(`\nHEADLINE (${r.headline.split} split): ${comparisonLine(r.headline)}`);

  const inf = r.influence;
  if (inf) {
    say(
      `\nmemory influence (§8.5): ${inf.citing} of ${inf.paired} mem forecasts cited ≥ 1 lesson; ` +
        `when citing, mean shift ${inf.meanShiftCiting === null ? "-" : signed(inf.meanShiftCiting, 3)} (|shift| ${f3(inf.meanAbsShiftCiting)}), ` +
        `mean Brier gain ${inf.meanBrierGainCiting === null ? "-" : signed(inf.meanBrierGainCiting)}; ` +
        `when not citing ${inf.meanBrierGainNotCiting === null ? "-" : signed(inf.meanBrierGainNotCiting)}`,
    );
    const top = [...r.perLesson.entries()].filter(([, l]) => l.timesCited > 0).sort((a, b) => b[1].timesCited - a[1].timesCited).slice(0, 5);
    if (top.length > 0) {
      say("most-cited lessons:");
      for (const [blobId, l] of top) {
        const g = l.gains.length ? l.gains.reduce((s, x) => s + x, 0) / l.gains.length : null;
        say(`  ${blobId}  cited ${l.timesCited}×, recalled ${l.timesRecalled}×, mean gain when cited ${g === null ? "-" : signed(g)}`);
      }
    }
  }
}

export async function scoreCommand(rawArgs: string[]): Promise<void> {
  const args = parseScoreArgs(rawArgs);
  const cp = readCheckpoint(checkpointPath(args.run));
  printReport(cp, buildReport(cp));

  if (args.compare.length > 0) {
    const [reference, ...others] = args.compare.map((id) => readCheckpoint(checkpointPath(id)));
    const cmp = compareRuns(cp, reference!, others, "dev");
    const b = cmp.bootstrap;
    say(`\ntuning comparison (DECISIONS D38), ${cmp.split} split, ${cmp.n} shared questions`);
    say(`  mem Brier: ${cmp.candidateRunId} ${f3(cmp.candidateBrier)} vs reference ${cmp.referenceRunId} ${f3(cmp.referenceBrier)}`);
    say(`  paired gain Δ = ${signed(b.meanDelta)}  95% CI [${signed(b.ci95[0])}, ${signed(b.ci95[1])}]  P(Δ>0)=${b.shareAboveZero.toFixed(2)}  (${b.blocks} weeks)`);
    say(`  no-memory passes: ${cmp.noisePasses.map((p) => `${p.runId} ${p.arm} ${f3(p.brier)}`).join(", ")}`);
    say(`  noise floor (max − min of ${cmp.noisePasses.length} passes) = ${Number.isFinite(cmp.noiseFloor) ? cmp.noiseFloor.toFixed(4) : "n/a"}`);
    say(`  verdict: ${cmp.adopt ? `ADOPT ${cmp.candidateRunId}'s settings (gain exceeds the noise floor)` : `keep ${cmp.referenceRunId}'s settings (gain does not exceed the noise floor)`}`);
  }
}
