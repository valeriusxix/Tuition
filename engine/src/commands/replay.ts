// `replay --arms base,nomem,nomem2,mem [--limit N] [--dry] [--official] [--resume runId]` (§7, §10).
// --dry: in-memory store, 0.5 stub forecaster and stub reflector, checkpoint in a temp directory; it
// never touches mainnet, the LLM or engine/state. --official: the headline run; Walrus only, all weeks.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Arm } from "@tuition/shared";
import { createClaudeForecaster, StubForecaster, type Forecaster } from "../agent/forecast";
import { createClaudeReflector, StubReflector, type Reflector } from "../agent/reflect";
import { loadConfig, type Config } from "../config";
import { ensureCandles } from "../data/candles";
import { UsageError } from "../errors";
import { say } from "../log";
import { ledgerPath } from "../memory/ledger";
import { createWalrusStore, InMemoryStore, type MemoryStore } from "../memory/store";
import { generateQuestions } from "../questions/generate";
import {
  applySnapshot,
  ARM_ORDER,
  checkpointPath,
  makeRunId,
  newCheckpoint,
  readCheckpoint,
  writeCheckpoint,
  type Checkpoint,
} from "../replay/checkpoint";
import { decisionWeeks, runReplay, sortArms } from "../replay/run";
import { addDays, parseDate } from "../util/dates";

export const DEFAULT_ARMS: readonly Arm[] = ["base", "nomem", "nomem2", "mem"];

export interface ReplayArgs {
  arms?: Arm[];
  limit?: number;
  dry: boolean;
  official: boolean;
  resume?: string;
}

export function parseReplayArgs(args: readonly string[]): ReplayArgs {
  const out: ReplayArgs = { dry: false, official: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--dry") out.dry = true;
    else if (a === "--official") out.official = true;
    else if (a === "--resume") out.resume = value();
    else if (a === "--limit") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new UsageError("--limit must be a positive whole number of weeks");
      out.limit = n;
    } else if (a === "--arms") {
      const arms = value()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = arms.filter((x) => !ARM_ORDER.includes(x as Arm));
      if (bad.length > 0 || arms.length === 0) {
        throw new UsageError(`--arms takes a comma list of ${ARM_ORDER.join(", ")} (got ${bad.join(", ") || "nothing"})`);
      }
      out.arms = sortArms(arms as Arm[]);
    } else throw new UsageError(`Unknown replay option "${a}"`);
  }
  if (out.official) {
    if (out.dry) throw new UsageError("--official and --dry cannot be combined");
    if (out.limit !== undefined) throw new UsageError("--official runs every week; drop --limit");
  }
  return out;
}

export async function replayCommand(rawArgs: string[]): Promise<void> {
  const args = parseReplayArgs(rawArgs);
  const envConfig = loadConfig();
  const now = new Date();

  // A resumed run uses its saved config snapshot, not the current environment.
  let resumed: Checkpoint | undefined;
  let config: Config;
  let dir: string | undefined; // undefined → engine/state
  if (args.resume) {
    if (args.dry) throw new UsageError("--dry runs keep memory in-process and cannot be resumed; start a new dry run");
    const path = checkpointPath(args.resume);
    resumed = readCheckpoint(path);
    if (resumed.mode === "dry" || resumed.config.MEMORY_BACKEND === "memory") {
      throw new UsageError(`run ${resumed.runId} used the in-memory store; its memories are gone, so it cannot be resumed`);
    }
    if (args.official && resumed.mode !== "official") {
      throw new UsageError(`run ${resumed.runId} was started as a ${resumed.mode} run; it cannot become the official run`);
    }
    const applied = applySnapshot(envConfig, resumed.config);
    config = applied.config;
    if (applied.changed.length > 0) {
      say(`note: using run ${resumed.runId}'s saved settings for ${applied.changed.join(", ")} (they differ from the current environment)`);
    }
    dir = dirname(path);
  } else {
    config = args.dry ? { ...envConfig, MEMORY_BACKEND: "memory" } : envConfig;
    if (args.official && config.MEMORY_BACKEND !== "walrus") throw new UsageError("replay --official requires MEMORY_BACKEND=walrus (§7.7)");
    if (config.MEMORY_BACKEND === "memory") dir = mkdtempSync(join(tmpdir(), "tuition-replay-"));
  }
  const arms = args.arms ?? [...DEFAULT_ARMS];
  if (args.official && !(["base", "nomem", "mem"] as const).every((a) => arms.includes(a))) {
    throw new UsageError("the official run needs at least the base, nomem and mem arms");
  }

  // Candles for the replay window only, so a replay never spends Tatum credits on recent days.
  const candles = await ensureCandles(config, { now: new Date(parseDate(addDays(config.REPLAY_END, config.HORIZON_DAYS + 2))) });

  let cp: Checkpoint;
  if (resumed) {
    cp = resumed;
  } else {
    const { questions, skipped } = generateQuestions({
      candles,
      symbols: config.ASSETS,
      start: config.REPLAY_START,
      end: config.REPLAY_END,
      devSplitEnd: config.DEV_SPLIT_END,
      horizon: config.HORIZON_DAYS,
      seed: config.SEED,
    });
    if (skipped.length > 0) say(`skipped ${skipped.length} question(s): ${skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}`);
    const mode = args.dry ? "dry" : args.official ? "official" : "dev";
    cp = newCheckpoint({ runId: makeRunId(now, config.SEED), mode, config, questions, now });
  }
  const file = checkpointPath(cp.runId, dir);

  const store: MemoryStore = config.MEMORY_BACKEND === "memory" ? new InMemoryStore() : createWalrusStore(config, ledgerPath(cp.runId));
  const forecaster: Forecaster = args.dry ? new StubForecaster() : createClaudeForecaster(config);
  const reflector: Reflector = args.dry ? new StubReflector() : createClaudeReflector(config);

  const weeks = decisionWeeks(cp.questions, args.limit);
  const nQuestions = cp.questions.filter((q) => weeks.includes(q.decisionDate)).length;
  say(`run      ${cp.runId}  (${cp.mode}${resumed ? ", resumed" : ""}${args.dry ? ": in-memory store, stub LLM" : ""})`);
  say(`arms     ${arms.join(", ")}`);
  say(`weeks    ${weeks.length} (${weeks[0]} → ${weeks[weeks.length - 1]})${args.limit ? `, --limit ${args.limit}` : ""}; ${nQuestions} questions`);
  say(`models   forecast ${config.FORECAST_MODEL}, reflect ${config.REFLECT_MODEL}`);
  say(`memory   ${config.MEMORY_BACKEND}: ${cp.namespaces.lessons}, ${cp.namespaces.calibration}`);
  say(`tuning   LESSON_ERROR_THRESHOLD=${config.LESSON_ERROR_THRESHOLD} RECALL_LIMIT=${config.RECALL_LIMIT} RECALL_MAX_DISTANCE=${config.RECALL_MAX_DISTANCE}`);
  say(`state    ${file}`);
  writeCheckpoint(file, cp); // resumable from here on

  if (!args.dry) {
    // Preflight: prove every credential before the first paid call.
    if (config.MEMORY_BACKEND === "walrus") {
      await store.health();
      await store.recall({ namespace: cp.namespaces.lessons, query: "preflight credential check", limit: 1 });
    }
    const fm = arms.some((a) => a !== "base") ? await forecaster.ping?.() : undefined;
    const rm = arms.includes("mem") ? await reflector.ping?.() : undefined;
    const parts = [config.MEMORY_BACKEND === "walrus" ? "relayer healthy, credentials accepted" : "", fm ?? "", rm ?? ""].filter(Boolean);
    say(`preflight ok${parts.length ? `: ${parts.join("; ")}` : ""}`);
  }
  say();

  const result = await runReplay(cp, {
    config,
    store,
    forecaster,
    reflector,
    candles,
    checkpointFile: file,
    arms,
    ...(args.limit ? { limit: args.limit } : {}),
  });

  say();
  say("arm     split      n   Brier  logloss    acc    ECE");
  for (const arm of ARM_ORDER) {
    const m = result.metrics[arm];
    if (!m) continue;
    for (const split of ["all", "dev", "test"] as const) {
      const s = m[split];
      if (!s) continue;
      say(
        `${arm.padEnd(7)} ${split.padEnd(5)} ${String(s.n).padStart(6)}  ${s.brier.toFixed(3)}   ${s.logLoss.toFixed(3)}  ${s.accuracy.toFixed(3)}  ${s.ece.toFixed(3)}`,
      );
    }
  }
  say();
  say(
    `memories: ${cp.lessons.filter((l) => l.blobId).length} lesson(s), ${cp.calibrations.length} calibration snapshot(s); ` +
      `${cp.reflectionSkips.length} reflection(s) skipped`,
  );
  const cost = Object.entries(cp.costUsd);
  if (cost.length > 0) {
    say(`LLM cost so far: ${cost.map(([k, v]) => `${k} $${v.toFixed(4)}`).join(", ")}, total $${cost.reduce((s, [, v]) => s + v, 0).toFixed(4)}`);
  }
  say(`checkpoint: ${file}`);
  if (!args.dry && config.MEMORY_BACKEND === "walrus") say(`resume with: npm run engine -- replay --resume ${cp.runId}`);
}
