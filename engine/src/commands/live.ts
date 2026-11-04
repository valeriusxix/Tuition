// `live [--dry]`: the daily live job (§9). --dry uses the in-memory store, the 0.5 stub forecaster and a
// temporary directory, so it never touches mainnet, the committed state or web/public/data.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeForecaster, StubForecaster, type Forecaster } from "../agent/forecast";
import { createClaudeReflector, StubReflector, type Reflector } from "../agent/reflect";
import { loadConfig } from "../config";
import { ensureCandles } from "../data/candles";
import { DEFAULT_LIVE_PATHS, LIVE_NAMESPACES, runLive, type LivePaths } from "../live/daily";
import { say } from "../log";
import { createWalrusStore, InMemoryStore } from "../memory/store";

export async function liveCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const dry = args.includes("--dry");
  const now = new Date();
  const paths: LivePaths = dry
    ? (() => {
        const dir = mkdtempSync(join(tmpdir(), "tuition-live-dry-"));
        return { stateFile: join(dir, "live-forecasts.json"), ledgerFile: join(dir, "live-ledger.jsonl"), liveJson: join(dir, "live.json") };
      })()
    : DEFAULT_LIVE_PATHS;
  const candles = await ensureCandles(config, { now });
  const store = dry || config.MEMORY_BACKEND === "memory" ? new InMemoryStore() : createWalrusStore(config, paths.ledgerFile);
  const forecaster: Forecaster = dry ? new StubForecaster() : createClaudeForecaster(config);
  const reflector: Reflector = dry ? new StubReflector() : createClaudeReflector(config);

  if (!dry) {
    // Preflight: prove every credential before forecasting, so a broken key fails the run at once,
    // even on a day with nothing new to commit.
    await store.health();
    await store.recall({ namespace: LIVE_NAMESPACES.lessons, query: "preflight credential check", limit: 1 }); // signed request
    const model = await forecaster.ping?.();
    const reflectModel = await reflector.ping?.();
    say(`preflight: relayer healthy, Walrus Memory credentials accepted, ${model ?? "model"} and ${reflectModel ?? "reflection model"} answering`);
  }

  const s = await runLive({ config, store, forecaster, reflector, candles, now, paths });
  say(`decision date ${s.decisionDate}${dry ? " (DRY RUN: in-memory store, stub forecaster)" : ""}`);
  say(`committed ${s.committed.length} new forecast(s); ${s.alreadyCommitted} already committed; resolved ${s.resolvedNow}`);
  say(`learning: ${s.lessonsWritten} lesson(s) written${s.calibrationN !== undefined ? `, calibration snapshot over ${s.calibrationN} resolved` : ""}`);
  for (const r of s.committed) say(`  ${r.question.id.padEnd(28)} p=${r.forecast.p.toFixed(2)}  blob ${r.blobId}`);
  if (s.skipped.length > 0) say(`skipped: ${s.skipped.map((x) => `${x.id} (${x.reason})`).join(", ")}`);
  if (s.problems.length > 0) {
    say(`PROBLEMS (forecasts were still committed; these are retried on the next run):\n  ${s.problems.join("\n  ")}`);
    process.exitCode = 1;
  }
  say(`live.json: ${s.file.metrics.pending} pending, ${s.file.metrics.resolved} resolved, Brier ${s.file.metrics.brier?.toFixed(3) ?? "-"} → ${paths.liveJson}`);
}
