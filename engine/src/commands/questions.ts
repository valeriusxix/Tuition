// `questions`: print question counts per split and type, and the base rates (§10). Day 2 exit check:
// the BREAKOUT base rate should land in 0.4–0.6.
import type { Question } from "@tuition/shared";
import { loadConfig } from "../config";
import { ensureCandles } from "../data/candles";
import { say } from "../log";
import { assetCodeMap, generateQuestions } from "../questions/generate";
import { resolveAll } from "../questions/resolve";

function rate(qs: readonly Question[]): string {
  const resolved = qs.filter((q) => q.outcome !== undefined);
  if (resolved.length === 0) return "  -  ";
  return (resolved.reduce((s, q) => s + (q.outcome ?? 0), 0) / resolved.length).toFixed(3);
}

export async function questionsCommand(): Promise<void> {
  const config = loadConfig();
  const candles = await ensureCandles(config);
  const { questions, skipped } = generateQuestions({
    candles,
    symbols: config.ASSETS,
    start: config.REPLAY_START,
    end: config.REPLAY_END,
    devSplitEnd: config.DEV_SPLIT_END,
    horizon: config.HORIZON_DAYS,
    seed: config.SEED,
  });
  const resolved = resolveAll(questions, candles, config.HORIZON_DAYS);
  const dates = new Set(resolved.map((q) => q.decisionDate));

  const codes = assetCodeMap(config.ASSETS, config.SEED);
  say(`assets   ${[...codes].map(([s, c]) => `${s}→${c}`).join("  ")}`);
  say(`dates    ${dates.size} decision Mondays, ${config.REPLAY_START} → ${config.REPLAY_END} (dev ≤ ${config.DEV_SPLIT_END})`);
  say();
  say("split  type        questions  resolved  base rate");
  for (const split of ["dev", "test"] as const) {
    for (const type of ["DIRECTION", "BREAKOUT"] as const) {
      const qs = resolved.filter((q) => q.split === split && q.type === type);
      const n = qs.filter((q) => q.outcome !== undefined).length;
      say(`${split.padEnd(6)} ${type.padEnd(11)} ${String(qs.length).padStart(9)} ${String(n).padStart(9)}  ${rate(qs).padStart(9)}`);
    }
  }
  say(`all    ${"".padEnd(11)} ${String(resolved.length).padStart(9)} ${String(resolved.filter((q) => q.outcome !== undefined).length).padStart(9)}`);
  say();

  const thresholds = resolved.flatMap((q) => (q.threshold === undefined ? [] : [q.threshold])).sort((a, b) => a - b);
  if (thresholds.length > 0) {
    say(`BREAKOUT thresholds: min ${thresholds[0]}, median ${thresholds[thresholds.length >> 1]}, max ${thresholds[thresholds.length - 1]}`);
  }
  const breakout = rate(resolved.filter((q) => q.type === "BREAKOUT"));
  const ok = Number(breakout) >= 0.4 && Number(breakout) <= 0.6;
  say(`BREAKOUT base rate: ${breakout} (target 0.4–0.6) ${ok ? "OK" : "OUT OF RANGE"}`);
  say(`DIRECTION base rate: ${rate(resolved.filter((q) => q.type === "DIRECTION"))}`);
  if (skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const s of skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    say(`skipped: ${skipped.length} (${[...reasons].map(([r, n]) => `${n}× ${r}`).join("; ")})`);
  } else {
    say("skipped: none");
  }
}
