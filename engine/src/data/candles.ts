// Daily candles (§6.1): fetch from Tatum, cache in engine/data/candles/{SYMBOL}-1d.json (committed so
// replays are reproducible and never pay twice), and check integrity. The cache records the date range
// already requested, so only days outside it are ever fetched: the free Tatum plan has a lifetime budget.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CandleSchema, type Candle } from "@tuition/shared";
import { z } from "zod";
import { requireEnv, type Config } from "../config";
import { UsageError } from "../errors";
import { log } from "../log";
import { CANDLES_DIR } from "../paths";
import { fetchCandleBatch, MAX_BATCH, SymbolNotSupportedError } from "../tatum/ohlcv";
import { addDays, DAY_MS, formatDate, parseDate, yesterdayUtc } from "../util/dates";

export const MIN_SYMBOLS = 3;
const SOURCE = "tatum:/v4/data/rate/symbol/OHLCV/batch interval=1d";

const CacheSchema = z.object({
  symbol: z.string(),
  interval: z.literal("1d"),
  source: z.string(),
  requestedFrom: z.iso.date(),
  requestedTo: z.iso.date(),
  updatedAt: z.string(),
  candles: z.array(CandleSchema),
});
export type CandleCache = z.infer<typeof CacheSchema>;

export function cachePath(symbol: string, dir: string = CANDLES_DIR): string {
  return resolve(dir, `${symbol}-1d.json`);
}

export function readCache(symbol: string, dir: string = CANDLES_DIR): CandleCache | undefined {
  const path = cachePath(symbol, dir);
  if (!existsSync(path)) return undefined;
  return CacheSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeCache(cache: CandleCache, dir: string = CANDLES_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(cachePath(cache.symbol, dir), `${JSON.stringify(CacheSchema.parse(cache), null, 1)}\n`);
}

/** Pure: union by open time (later input wins), sorted ascending. */
export function mergeCandles(a: readonly Candle[], b: readonly Candle[]): Candle[] {
  const byT = new Map<number, Candle>();
  for (const c of a) byT.set(c.t, c);
  for (const c of b) byT.set(c.t, c);
  return [...byT.values()].sort((x, y) => x.t - y.t);
}

export interface IntegrityReport {
  gaps: { after: string; before: string; missingDays: number }[];
  bad: { date: string; reason: string }[];
}

/** Pure: daily continuity (§6.1: no gaps of more than 1 day) and low ≤ open,close ≤ high. */
export function checkIntegrity(candles: readonly Candle[]): IntegrityReport {
  const report: IntegrityReport = { gaps: [], bad: [] };
  candles.forEach((c, i) => {
    if (c.t % DAY_MS !== 0) report.bad.push({ date: formatDate(c.t), reason: "open time is not 00:00:00Z" });
    if (!(c.low <= Math.min(c.open, c.close) && Math.max(c.open, c.close) <= c.high)) {
      report.bad.push({ date: formatDate(c.t), reason: "OHLC out of order (need low ≤ open,close ≤ high)" });
    }
    if (![c.open, c.high, c.low, c.close].every((x) => Number.isFinite(x) && x > 0)) {
      report.bad.push({ date: formatDate(c.t), reason: "non-positive or non-finite price" });
    }
    const prev = candles[i - 1];
    if (prev && c.t - prev.t !== DAY_MS) {
      report.gaps.push({ after: formatDate(prev.t), before: formatDate(c.t), missingDays: Math.round((c.t - prev.t) / DAY_MS) - 1 });
    }
  });
  return report;
}

/** Pure: day ranges in [start, end] not yet requested, given what the cache already covers. */
export function missingRanges(cache: Pick<CandleCache, "requestedFrom" | "requestedTo"> | undefined, start: string, end: string): [string, string][] {
  if (start > end) return [];
  if (!cache) return [[start, end]];
  const out: [string, string][] = [];
  if (start < cache.requestedFrom) out.push([start, addDays(cache.requestedFrom, -1) < end ? addDays(cache.requestedFrom, -1) : end]);
  if (end > cache.requestedTo) out.push([cache.requestedTo >= start ? addDays(cache.requestedTo, 1) : start, end]);
  return out.filter(([a, b]) => a <= b);
}

/** Pure: split [from, to] (inclusive dates) into batch pages of at most `size` days. */
export function pages(from: string, to: string, size = MAX_BATCH): { from: number; count: number }[] {
  const out: { from: number; count: number }[] = [];
  const end = parseDate(to);
  for (let t = parseDate(from); t <= end; t += size * DAY_MS) {
    out.push({ from: t, count: Math.min(size, Math.round((end - t) / DAY_MS) + 1) });
  }
  return out;
}

/** History needed by replay and live: 200 days before REPLAY_START through the last closed candle. */
export function historyWindow(config: Config, now: Date = new Date()): { start: string; end: string } {
  const replayEnd = addDays(config.REPLAY_END, config.HORIZON_DAYS + 1);
  const yesterday = yesterdayUtc(now);
  return { start: addDays(config.REPLAY_START, -200), end: replayEnd > yesterday ? replayEnd : yesterday };
}

export interface EnsureOptions {
  refresh?: boolean;
  now?: Date;
  dir?: string;
}

/** Load cached candles, fetching only missing days. Drops symbols Tatum does not support (404). */
export async function ensureCandles(config: Config, opts: EnsureOptions = {}): Promise<Map<string, Candle[]>> {
  const { start, end } = historyWindow(config, opts.now);
  const lastClosed = yesterdayUtc(opts.now);
  const out = new Map<string, Candle[]>();
  let apiKey: string | undefined;

  for (const symbol of config.ASSETS) {
    let cache = opts.refresh ? undefined : readCache(symbol, opts.dir);
    const ranges = missingRanges(cache, start, end);
    if (ranges.length > 0) {
      apiKey ??= requireEnv(config, ["TATUM_API_KEY"]).TATUM_API_KEY;
      try {
        let candles = cache?.candles ?? [];
        let requestedFrom = cache?.requestedFrom ?? start;
        let requestedTo = cache?.requestedTo ?? addDays(start, -1);
        for (const [from, to] of ranges) {
          let lastReceived: string | undefined;
          for (const page of pages(from, to)) {
            const batch = await fetchCandleBatch({ url: config.TATUM_OHLCV_BATCH_URL, apiKey, symbol, ...page });
            const closed = batch.filter((c) => formatDate(c.t) <= lastClosed); // never cache an in-progress day
            candles = mergeCandles(candles, closed);
            if (closed.length > 0) lastReceived = formatDate(closed[closed.length - 1]!.t);
            log.info("fetched candles", { symbol, from: formatDate(page.from), requested: page.count, received: closed.length });
          }
          if (from < requestedFrom) requestedFrom = from; // early days that do not exist are not retried
          // Extend coverage only as far as data actually arrived, so a not-yet-published day is retried next run.
          if (to > requestedTo && lastReceived && lastReceived > requestedTo) requestedTo = lastReceived < to ? lastReceived : to;
        }
        cache = { symbol, interval: "1d", source: SOURCE, requestedFrom, requestedTo, updatedAt: new Date().toISOString(), candles };
        writeCache(cache, opts.dir);
      } catch (error) {
        if (error instanceof SymbolNotSupportedError) {
          log.warn("dropping symbol: not supported by Tatum OHLCV", { symbol });
          continue;
        }
        throw error;
      }
    }
    if (!cache || cache.candles.length === 0) {
      log.warn("dropping symbol: no candles", { symbol });
      continue;
    }
    const report = checkIntegrity(cache.candles);
    for (const g of report.gaps) log.warn("candle gap", { symbol, ...g });
    for (const b of report.bad) log.warn("bad candle", { symbol, ...b });
    out.set(symbol, cache.candles);
  }

  if (out.size < MIN_SYMBOLS) {
    throw new UsageError(`Only ${out.size} symbol(s) have candles (${[...out.keys()].join(", ") || "none"}); at least ${MIN_SYMBOLS} are required.`);
  }
  return out;
}
