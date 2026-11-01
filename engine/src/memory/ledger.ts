// Local append-only ledger of successful memory writes: engine/state/ledger-{runId}.jsonl (§7.4).
// Walrus Memory is append-only and relayer dedupe is short-lived, so this file is what makes
// writes resumable and stops the same memory being written twice.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MemoryLedgerEntrySchema, type MemoryLedgerEntry } from "@tuition/shared";
import { STATE_DIR } from "../paths";

export function ledgerPath(runId: string, dir: string = STATE_DIR): string {
  return resolve(dir, `ledger-${runId}.jsonl`);
}

export function readLedger(path: string): MemoryLedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const parsed = MemoryLedgerEntrySchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`Corrupt ledger line ${i + 1} in ${path}: ${parsed.error.message}`);
      return parsed.data;
    });
}

export function appendLedger(path: string, entry: MemoryLedgerEntry): void {
  const valid = MemoryLedgerEntrySchema.parse(entry);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(valid)}\n`);
}

export function findByKey(entries: readonly MemoryLedgerEntry[], key: string): MemoryLedgerEntry | undefined {
  return entries.find((e) => e.key === key);
}
