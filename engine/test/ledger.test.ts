import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryLedgerEntry } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import { appendLedger, findByKey, ledgerPath, readLedger } from "../src/memory/ledger";
import { sha256Hex } from "../src/util/hash";

const tempLedger = () => ledgerPath("test", mkdtempSync(join(tmpdir(), "tuition-ledger-")));

const entry = (over: Partial<MemoryLedgerEntry> = {}): MemoryLedgerEntry => ({
  key: sha256Hex("k1"),
  namespace: "tuition.smoke",
  kind: "smoke",
  blobId: "blob-1",
  jobId: "job-1",
  createdAt: "2026-10-29T12:00:00.000Z",
  textSha256: sha256Hex("text"),
  ...over,
});

describe("ledger", () => {
  it("names the file ledger-{runId}.jsonl", () => {
    expect(ledgerPath("r-20261101-0930-a1b2", "/state").replaceAll("\\", "/")).toMatch(/\/state\/ledger-r-20261101-0930-a1b2\.jsonl$/);
  });

  it("returns an empty list when the ledger does not exist yet", () => {
    expect(readLedger(tempLedger())).toEqual([]);
  });

  it("round-trips entries in append order", () => {
    const path = tempLedger();
    const a = entry();
    const b = entry({ key: sha256Hex("k2"), blobId: "blob-2", kind: "lesson", createdSimDate: "2026-04-20" });
    appendLedger(path, a);
    appendLedger(path, b);
    expect(readLedger(path)).toEqual([a, b]);
  });

  it("refuses to write an invalid entry", () => {
    const path = tempLedger();
    expect(() => appendLedger(path, entry({ key: "not-a-sha" }))).toThrow();
    expect(readLedger(path)).toEqual([]);
  });

  it("reports the line number of a corrupt line", () => {
    const path = tempLedger();
    writeFileSync(path, `${JSON.stringify(entry())}\n{"key":"x"}\n`);
    expect(() => readLedger(path)).toThrow(/line 2/);
  });

  it("finds an entry by idempotency key", () => {
    const a = entry();
    expect(findByKey([a], a.key)).toBe(a);
    expect(findByKey([a], sha256Hex("other"))).toBeUndefined();
  });
});
