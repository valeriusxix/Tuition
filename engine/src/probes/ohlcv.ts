// §4.3 probe:ohlcv — one Tatum OHLCV batch call, saved raw. Falls back to interval=1h if 1d is rejected.
import { loadConfig, requireEnv } from "../config";
import { say } from "../log";
import { tatumLimiter } from "../util/ratelimit";
import { saveFixture } from "./fixture";
import { describeShape, fetchRaw, type RawResponse } from "./http";

const PROBE = "probe:ohlcv";

async function call(baseUrl: string, apiKey: string, params: Record<string, string>) {
  const url = `${baseUrl}?${new URLSearchParams(params).toString()}`;
  const res = await fetchRaw(url, { headers: { accept: "application/json", "x-api-key": apiKey } }, { limiter: tatumLimiter });
  return { url, res };
}

function report(interval: string, url: string, res: RawResponse): void {
  const file = saveFixture(`ohlcv-batch-BTC-${interval}.json`, {
    probe: PROBE,
    request: { method: "GET", url, headers: { accept: "application/json", "x-api-key": "<TATUM_API_KEY>" } },
    response: res,
  });
  say(`interval=${interval}: HTTP ${res.status} in ${res.ms} ms (attempts: ${res.attempts})`);
  const usage = Object.entries(res.headers).filter(([k]) => /credit|rate|limit|usage/i.test(k));
  if (usage.length > 0) say(`  usage headers: ${usage.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const body = res.body;
  if (Array.isArray(body)) {
    say(`  body: array of ${body.length}`);
    if (body.length > 0) say(`  first element: ${JSON.stringify(describeShape(body[0]))}`);
  } else {
    say(`  body: ${JSON.stringify(typeof body === "object" ? describeShape(body) : body).slice(0, 400)}`);
  }
  say(`  saved ${file}`);
}

export async function probeOhlcv(): Promise<void> {
  const config = loadConfig();
  const { TATUM_API_KEY } = requireEnv(config, ["TATUM_API_KEY"]);
  const params = { symbol: "BTC", timeFrom: "2026-03-01T00:00:00Z", numberOfCandles: "5", interval: "1d" };

  const daily = await call(config.TATUM_OHLCV_BATCH_URL, TATUM_API_KEY, params);
  report("1d", daily.url, daily.res);

  if (daily.res.status === 400 && /interval/i.test(JSON.stringify(daily.res.body))) {
    say("interval=1d was rejected; trying interval=1h (daily candles would then be aggregated in data/candles.ts)");
    const hourly = await call(config.TATUM_OHLCV_BATCH_URL, TATUM_API_KEY, { ...params, interval: "1h" });
    report("1h", hourly.url, hourly.res);
  }
}
