// `verify --run <runId>` (§11): proves a run on mainnet and writes web/public/data/proof.json. Reads the
// account object through Tatum's Sui gateway, fetches every blob from the Walrus aggregator (the content
// is encrypted and is never decoded), and recalls three lessons by their own text.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { delegateKeyToPublicKey } from "@mysten-incubation/memwal";
import { LessonsFileSchema, type BlobCheck, type MemoryLedgerEntry, type RecallCheck } from "@tuition/shared";
import { loadConfig, requireEnv } from "../config";
import { UsageError } from "../errors";
import { say } from "../log";
import { ledgerPath, readLedger } from "../memory/ledger";
import { createWalrusStore } from "../memory/store";
import { STATE_DIR, WEB_DATA_DIR } from "../paths";
import { fetchRaw } from "../probes/http";
import { ledgerCounts } from "../publish/export";
import { checkpointPath, readCheckpoint } from "../replay/checkpoint";
import { readAccountObject } from "../tatum/sui";
import { aggregatorLimiter, mapLimit } from "../util/ratelimit";
import { retry } from "../util/retry";
import { assertNoSecrets, blobUrl, buildProof, proofProblems, sampleLessons, uniqueBlobs } from "../verify/proof";
import { allLedgers } from "./export";

const RECALL_SAMPLE = 3;
const RECHECK_DELAY_MS = 30_000;

export function parseVerifyArgs(args: readonly string[]): { run: string } {
  if (args[0] !== "--run" || !args[1] || args[1].startsWith("--") || args.length > 2) {
    throw new UsageError("verify needs --run <runId> (see engine/state/run-<runId>.json)");
  }
  return { run: args[1] };
}

async function checkBlob(aggregator: string, entry: MemoryLedgerEntry): Promise<BlobCheck> {
  const url = blobUrl(aggregator, entry.blobId);
  const row = { blobId: entry.blobId, kind: entry.kind, namespace: entry.namespace, url };
  try {
    const res = await fetchRaw(url, {}, { limiter: aggregatorLimiter, binary: true, timeoutMs: 60_000 });
    return { ...row, status: res.status, bytes: res.byteLength ?? null, sha256: res.sha256 ?? null };
  } catch {
    return { ...row, status: null, bytes: null, sha256: null };
  }
}

export async function verifyCommand(rawArgs: string[]): Promise<void> {
  const { run } = parseVerifyArgs(rawArgs);
  const config = loadConfig();
  const env = requireEnv(config, ["TATUM_API_KEY", "MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"]);
  const cp = readCheckpoint(checkpointPath(run));
  if (cp.mode !== "official") throw new UsageError(`run ${run} is a ${cp.mode} run; proof.json is for the official run`);

  const lessons = LessonsFileSchema.parse(JSON.parse(readFileSync(resolve(WEB_DATA_DIR, "lessons.json"), "utf8")));
  if (lessons.runId !== run) throw new UsageError(`web/public/data/lessons.json is for ${lessons.runId}; run \`export --run ${run}\` first`);

  const store = createWalrusStore(config, ledgerPath(run));

  const checkedAt = new Date().toISOString();
  const health = (await retry(() => store.health())) as Record<string, unknown>;
  say(`relayer: ${String(health.status)} (${config.MEMWAL_SERVER_URL})`);

  const account = await readAccountObject(config.TATUM_SUI_RPC_URL, env.TATUM_API_KEY, env.MEMWAL_ACCOUNT_ID);
  say(`account: ${account.objectId} v${account.version}, ${account.type}`);

  const entries = uniqueBlobs([...readLedger(ledgerPath(run)), ...readLedger(resolve(STATE_DIR, "live-ledger.jsonl"))]);
  say(`aggregator: checking ${entries.length} blobs`);
  const aggregator = config.WALRUS_AGGREGATOR_URL;
  let blobs = await mapLimit(entries, 3, (e) => checkBlob(aggregator, e));
  const failedIds = new Set(blobs.filter((b) => b.status !== 200).map((b) => b.blobId));
  if (failedIds.size > 0) {
    say(`  ${failedIds.size} not 200; rechecking once in ${RECHECK_DELAY_MS / 1000}s (a recent blob can briefly 404, DECISIONS D10)`);
    await new Promise((r) => setTimeout(r, RECHECK_DELAY_MS));
    const again = await mapLimit(
      entries.filter((e) => failedIds.has(e.blobId)),
      3,
      (e) => checkBlob(aggregator, e),
    );
    const byId = new Map(again.map((b) => [b.blobId, b]));
    blobs = blobs.map((b) => byId.get(b.blobId) ?? b);
  }

  const recall: RecallCheck[] = [];
  for (const lesson of sampleLessons(lessons.lessons, RECALL_SAMPLE, run)) {
    const hits = await retry(() => store.recall({ namespace: cp.namespaces.lessons, query: lesson.body, limit: 1 }));
    const top = hits[0];
    recall.push({
      blobId: lesson.blobId,
      questionId: lesson.questionId,
      topBlobId: top?.blobId ?? null,
      distance: top?.distance ?? null,
      matched: top?.blobId === lesson.blobId,
    });
  }

  const proof = buildProof({
    generatedAt: new Date().toISOString(),
    runId: run,
    publicKey: await delegateKeyToPublicKey(env.MEMWAL_PRIVATE_KEY),
    accountId: env.MEMWAL_ACCOUNT_ID,
    relayer: { url: config.MEMWAL_SERVER_URL, checkedAt, health },
    account,
    accountEndpoint: `${config.TATUM_SUI_RPC_URL.replace(/\/+$/, "")}/graphql`,
    aggregator,
    blobs,
    recall,
    counts: ledgerCounts(allLedgers()),
  });

  const text = `${JSON.stringify(proof, null, 1)}\n`;
  assertNoSecrets(text, [config.ANTHROPIC_API_KEY, config.TATUM_API_KEY, config.MEMWAL_PRIVATE_KEY]);
  mkdirSync(WEB_DATA_DIR, { recursive: true });
  const path = resolve(WEB_DATA_DIR, "proof.json");
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);

  say(`delegate key on the account object: ${proof.account.delegateKeyFound ? `yes (${proof.account.delegateKeyEncoding})` : "NO"}`);
  say(`blobs: ${proof.blobs.ok}/${proof.blobs.checked} HTTP 200, ${proof.blobs.totalBytes} bytes`);
  say(`recall round-trip: ${proof.recall.matched}/${proof.recall.checked} returned the same blob first`);
  say(`MEMWAL_AGENT_ID ${proof.agentId}`);
  say(`MEMWAL_ACCOUNT_ID ${proof.accountId}`);
  say(`wrote ${path}`);
  const problems = proofProblems(proof);
  if (problems.length > 0) {
    say(`PROBLEMS (recorded in proof.json):\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  }
}
