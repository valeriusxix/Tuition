// Tatum Data API OHLCV (§6.1). Shape from engine/fixtures/ohlcv-batch-BTC-1d.json: an ascending array of
// { symbol, openTime (epoch ms), closeTime, open/high/low/close (decimal strings), volume, ... } that
// starts at openTime = timeFrom. A batch call returns up to 50 candles for about 500 credits.
import type { Candle } from "@tuition/shared";
import { z } from "zod";
import { log } from "../log";
import { toIsoSeconds } from "../util/dates";
import { tatumLimiter } from "../util/ratelimit";
import { HttpError, parseRetryAfter, retry } from "../util/retry";

export const MAX_BATCH = 50;

const decimal = z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number()]).transform(Number);

export const TatumCandleSchema = z.object({
  symbol: z.string(),
  openTime: z.number().int(),
  closeTime: z.number().int(),
  open: decimal,
  high: decimal,
  low: decimal,
  close: decimal,
});

/** Pure: validate a batch response body and normalise it to Candles. */
export function parseCandleBatch(body: unknown): Candle[] {
  return z
    .array(TatumCandleSchema)
    .parse(body)
    .map((r) => ({ t: r.openTime, open: r.open, high: r.high, low: r.low, close: r.close }));
}

export class SymbolNotSupportedError extends Error {
  override name = "SymbolNotSupportedError";
  constructor(readonly symbol: string, detail: string) {
    super(`Tatum has no OHLCV data for ${symbol} (HTTP 404): ${detail}`);
  }
}

export interface BatchRequest {
  url: string; // TATUM_OHLCV_BATCH_URL
  apiKey: string;
  symbol: string;
  from: number; // epoch ms of the first candle's open
  count: number; // 1..50
  interval?: string;
}

export async function fetchCandleBatch(req: BatchRequest): Promise<Candle[]> {
  if (req.count < 1 || req.count > MAX_BATCH) throw new Error(`count must be 1..${MAX_BATCH}, got ${req.count}`);
  const params = new URLSearchParams({
    symbol: req.symbol,
    timeFrom: toIsoSeconds(req.from),
    numberOfCandles: String(req.count),
    interval: req.interval ?? "1d",
  });
  const url = `${req.url}?${params.toString()}`;
  return retry(
    async () => {
      await tatumLimiter.take();
      const res = await fetch(url, {
        headers: { accept: "application/json", "x-api-key": req.apiKey },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      if (res.status === 404) throw new SymbolNotSupportedError(req.symbol, text.slice(0, 200));
      if (!res.ok) {
        throw new HttpError(
          res.status,
          `Tatum OHLCV ${req.symbol}: HTTP ${res.status} ${text.slice(0, 200)}`,
          text,
          parseRetryAfter(res.headers.get("retry-after")),
        );
      }
      return parseCandleBatch(JSON.parse(text));
    },
    { onRetry: ({ attempt, delayMs, error }) => log.warn("Tatum OHLCV retry", { symbol: req.symbol, attempt, delayMs, error }) },
  );
}
