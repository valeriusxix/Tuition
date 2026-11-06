// `export --run <runId> [--out <dir>]` (§10, §12.1): writes summary, curve, reliability, questions and
// lessons JSON for the web app, each validated against its shared schema first. Reads only local
// files (checkpoint, candle cache, ledgers): no network, no keys.
// Only the official run goes to web/public/data by default; a dev or dry run needs an explicit --out,
// so tuning numbers can never replace the published results by accident. An official export also fills
// the generated blocks of README.md and docs/BLOG_DRAFT.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProofFileSchema, type Candle, type MemoryLedgerEntry, type ProofFile, type SummaryFile } from "@tuition/shared";
import { readCache } from "../data/candles";
import { UsageError } from "../errors";
import { say } from "../log";
import { readLedger } from "../memory/ledger";
import { REPO_ROOT, STATE_DIR, WEB_DATA_DIR } from "../paths";
import { renderDocs } from "../publish/docs";
import { buildWebData, writeWebData } from "../publish/export";
import { checkpointPath, readCheckpoint } from "../replay/checkpoint";
import { buildReport } from "../score/report";

export interface ExportArgs {
  run: string;
  out?: string;
}

export function parseExportArgs(args: readonly string[]): ExportArgs {
  let run: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--run") run = value();
    else if (a === "--out") out = value();
    else throw new UsageError(`Unknown export option "${a}"`);
  }
  if (!run) throw new UsageError("export needs --run <runId> (see engine/state/run-<runId>.json)");
  return { run, ...(out !== undefined ? { out } : {}) };
}

/** Every memory ledger in the state directory: replay runs, live and smoke. */
export function allLedgers(dir: string = STATE_DIR): MemoryLedgerEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^ledger-.+\.jsonl$/.test(f) || f === "live-ledger.jsonl")
    .sort()
    .flatMap((f) => readLedger(resolve(dir, f)));
}

function readProof(dir: string): ProofFile | null {
  const path = resolve(dir, "proof.json");
  return existsSync(path) ? ProofFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
}

function writeDocs(summary: SummaryFile, proof: ProofFile | null): string[] {
  const readmePath = resolve(REPO_ROOT, "README.md");
  const blogPath = resolve(REPO_ROOT, "docs", "BLOG_DRAFT.md");
  const { readme, blog } = renderDocs({ readme: readFileSync(readmePath, "utf8"), blog: readFileSync(blogPath, "utf8"), summary, proof });
  writeFileSync(readmePath, readme);
  writeFileSync(blogPath, blog);
  return [readmePath, blogPath];
}

export async function exportCommand(rawArgs: string[]): Promise<void> {
  const args = parseExportArgs(rawArgs);
  const cp = readCheckpoint(checkpointPath(args.run));
  if (cp.mode !== "official" && args.out === undefined) {
    throw new UsageError(
      `run ${cp.runId} is a ${cp.mode} run. Only the official run is exported to web/public/data by default; ` +
        `pass --out <dir> to export this one elsewhere.`,
    );
  }
  // npm runs workspace scripts from engine/; resolve --out against the directory npm was started in.
  const out = args.out === undefined ? WEB_DATA_DIR : resolve(process.env.INIT_CWD ?? process.cwd(), args.out);

  const candles = new Map<string, Candle[]>();
  for (const symbol of cp.config.ASSETS) {
    const cache = readCache(symbol);
    if (!cache) throw new UsageError(`No cached candles for ${symbol}. Run \`npm run engine -- candles\` first.`);
    candles.set(symbol, cache.candles);
  }

  const report = buildReport(cp);
  const data = buildWebData({ cp, report, candles, ledgers: allLedgers(), generatedAt: new Date().toISOString() });
  const paths = writeWebData(out, data);
  if (cp.mode === "official" && args.out === undefined) paths.push(...writeDocs(data.summary, readProof(out)));

  say(`run ${cp.runId} (${cp.mode}): ${data.summary.counts.questions} scored questions, ${data.lessons.lessons.length} lessons, ${data.lessons.calibrations.length} calibration snapshots`);
  say(`mainnet memories across all ledgers: ${data.summary.memories.mainnet.total}`);
  const h = data.summary.headline;
  if (h) {
    say(
      `headline (${h.split}): Brier memory OFF ${h.referenceBrier.toFixed(3)} → ON ${h.candidateBrier.toFixed(3)}, ` +
        `Δ ${h.meanDelta >= 0 ? "+" : ""}${h.meanDelta.toFixed(4)} (95% CI ${h.ci95[0].toFixed(4)} … ${h.ci95[1].toFixed(4)})`,
    );
  }
  for (const p of paths) say(`wrote ${p}`);
}
