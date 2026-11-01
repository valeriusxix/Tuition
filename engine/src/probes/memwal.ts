// §4.2 smoke:memwal — health, one real mainnet write, recall it back, print the agent public key.
import { MemWal } from "@mysten-incubation/memwal";
import { loadConfig, requireEnv } from "../config";
import { say } from "../log";
import { appendLedger, ledgerPath } from "../memory/ledger";
import { memoryKey, sha256Hex } from "../util/hash";
import { retry, statusOf } from "../util/retry";
import { saveFixture } from "./fixture";

const NAMESPACE = "tuition.smoke";
const PROBE = "smoke:memwal";

export const AUTH_HINT =
  "HTTP 401 from the relayer. Check: (1) MEMWAL_PRIVATE_KEY is the delegate key from memory.walrus.xyz → SDK credentials; " +
  "(2) that key is registered on this account; (3) MEMWAL_ACCOUNT_ID is the account OBJECT ID, not a wallet address; " +
  "(4) MEMWAL_SERVER_URL is the mainnet relayer and the credentials are mainnet credentials.";

export async function smokeMemwal(): Promise<void> {
  const config = loadConfig();
  const env = requireEnv(config, ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"]);
  const memwal = MemWal.create({
    key: env.MEMWAL_PRIVATE_KEY,
    accountId: env.MEMWAL_ACCOUNT_ID,
    serverUrl: config.MEMWAL_SERVER_URL,
    namespace: NAMESPACE,
  });

  try {
    say(`relayer      ${config.MEMWAL_SERVER_URL}`);

    const health = await retry(() => memwal.health());
    say(`health       ${JSON.stringify(health)}`);
    say(`  saved ${saveFixture("memwal-health.json", { probe: PROBE, request: "memwal.health()", response: health })}`);

    const compatibility = await retry(() => memwal.compatibility()).catch((e: unknown) => ({ error: String(e) }));
    saveFixture("memwal-compatibility.json", { probe: PROBE, request: "memwal.compatibility()", response: compatibility });

    const createdAt = new Date().toISOString();
    const text = `tuition smoke test ${createdAt}`;
    // An explicit idempotency key makes a retry collapse onto the same job instead of writing twice.
    const key = memoryKey("smoke", "smoke", createdAt);
    const started = Date.now();
    const remembered = await retry(() => memwal.rememberAndWait(text, NAMESPACE, { timeoutMs: 60_000, idempotencyKey: key }));
    const writeMs = Date.now() - started;
    say(`remember     blob_id=${remembered.blob_id} (${(writeMs / 1000).toFixed(1)}s)`);
    say(
      `  saved ${saveFixture("memwal-remember.json", {
        probe: PROBE,
        request: { call: "rememberAndWait(text, namespace, { timeoutMs: 60000, idempotencyKey })", text, namespace: NAMESPACE, idempotencyKey: key },
        response: remembered,
        notes: [`wall time ${writeMs} ms`],
      })}`,
    );
    appendLedger(ledgerPath("smoke"), {
      key,
      namespace: NAMESPACE,
      kind: "smoke",
      blobId: remembered.blob_id,
      jobId: remembered.job_id ?? remembered.id,
      createdAt,
      textSha256: sha256Hex(text),
    });

    const query = { query: "tuition smoke test", namespace: NAMESPACE, limit: 3 };
    const recalled = await retry(() => memwal.recall(query));
    const rank = recalled.results.findIndex((r) => r.blob_id === remembered.blob_id);
    say(`recall       ${recalled.results.length} result(s), total=${recalled.total}; new blob ${rank >= 0 ? `found at rank ${rank + 1}` : "NOT in the top 3"}`);
    say(`  saved ${saveFixture("memwal-recall.json", { probe: PROBE, request: { call: "recall(params)", ...query }, response: recalled })}`);

    const agentId = await memwal.getPublicKeyHex();
    say();
    say(`MEMWAL_AGENT_ID (paste into the submission form): ${agentId}`);
    say(`MEMWAL_ACCOUNT_ID:                                ${env.MEMWAL_ACCOUNT_ID}`);
  } catch (error) {
    if (statusOf(error) === 401) say(AUTH_HINT);
    throw error;
  } finally {
    memwal.destroy();
  }
}
