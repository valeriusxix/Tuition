// §4.5 probe:aggregator — fetch the smoke blob from the Walrus aggregator. The content is
// encrypted: record status, size and hash only, and never try to decode it.
import { loadConfig } from "../config";
import { UsageError } from "../errors";
import { say } from "../log";
import { aggregatorLimiter } from "../util/ratelimit";
import { readFixture, saveFixture } from "./fixture";
import { fetchRaw } from "./http";

const PROBE = "probe:aggregator";

export async function probeAggregator(): Promise<void> {
  const config = loadConfig();
  const remembered = readFixture("memwal-remember.json")?.response as { blob_id?: unknown } | undefined;
  const blobId = typeof remembered?.blob_id === "string" ? remembered.blob_id : undefined;
  if (!blobId) throw new UsageError("No blob_id in engine/fixtures/memwal-remember.json. Run `npm run smoke:memwal` first.");

  const url = `${config.WALRUS_AGGREGATOR_URL.replace(/\/+$/, "")}/v1/blobs/${encodeURIComponent(blobId)}`;
  const res = await fetchRaw(url, {}, { limiter: aggregatorLimiter, binary: true, timeoutMs: 60_000 });
  const file = saveFixture("aggregator-blob.json", { probe: PROBE, request: { method: "GET", url, blobId }, response: res });

  say(`GET ${url}`);
  say(`HTTP ${res.status} in ${res.ms} ms (attempts: ${res.attempts}); ${res.byteLength ?? 0} bytes; sha256 ${res.sha256 ?? "-"}`);
  say(`content-type: ${res.headers["content-type"] ?? "-"}`);
  if (res.status === 404) say("A just-certified blob can briefly 404 through the aggregator's CDN; rerun in a minute.");
  say(`saved ${file}`);
}
