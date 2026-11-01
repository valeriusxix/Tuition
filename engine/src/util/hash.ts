import { createHash } from "node:crypto";
import type { MemoryLedgerEntry } from "@tuition/shared";

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic idempotency key for a memory write (§7.7): sha256(runId:kind:ref). */
export function memoryKey(runId: string, kind: MemoryLedgerEntry["kind"], ref: string): string {
  return sha256Hex(`${runId}:${kind}:${ref}`);
}
