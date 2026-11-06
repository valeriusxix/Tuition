// `memories --run <runId>` (§10): ledger counts per namespace and kind, plus the agent public key.
import { delegateKeyToPublicKey } from "@mysten-incubation/memwal";
import { loadConfig } from "../config";
import { UsageError } from "../errors";
import { say } from "../log";
import { ledgerPath, readLedger } from "../memory/ledger";
import { allLedgers } from "./export";

export async function memoriesCommand(args: string[]): Promise<void> {
  if (args[0] !== "--run" || !args[1] || args[1].startsWith("--") || args.length > 2) {
    throw new UsageError("memories needs --run <runId> (see engine/state/ledger-<runId>.jsonl)");
  }
  const run = args[1];
  const config = loadConfig();
  const entries = readLedger(ledgerPath(run));
  const counts = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.namespace}  ${e.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  say(`run ${run}: ${entries.length} memories`);
  for (const [key, n] of [...counts].sort()) say(`  ${String(n).padStart(4)}  ${key}`);
  say(`all ledgers: ${new Set(allLedgers().map((e) => e.blobId)).size} memories on mainnet`);
  const agent = config.MEMWAL_PRIVATE_KEY
    ? Buffer.from(await delegateKeyToPublicKey(config.MEMWAL_PRIVATE_KEY)).toString("hex")
    : "(set MEMWAL_PRIVATE_KEY to print it)";
  say(`MEMWAL_AGENT_ID   ${agent}`);
  say(`MEMWAL_ACCOUNT_ID ${config.MEMWAL_ACCOUNT_ID ?? "(not set)"}`);
}
