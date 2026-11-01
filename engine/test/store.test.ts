import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeMemory } from "../src/memory/format";
import { readLedger } from "../src/memory/ledger";
import { InMemoryStore, WalrusMemoryStore, type MemWalClient } from "../src/memory/store";
import { memoryKey } from "../src/util/hash";
import type { Clock } from "../src/util/ratelimit";

function fakeClient() {
  const calls = { remember: 0, wait: 0, recall: 0 };
  let n = 0;
  const client: MemWalClient = {
    async remember() {
      calls.remember++;
      return { job_id: `job-${++n}` };
    },
    async waitForRememberJob(jobId) {
      calls.wait++;
      return { id: jobId, job_id: jobId, blob_id: `blob-${jobId}` };
    },
    async recall() {
      calls.recall++;
      return {
        results: [
          { blob_id: "b1", text: encodeMemory("lesson", { run: "r-1", sim: "2026-04-20" }, "LESSON one"), distance: 0.2 },
          { blob_id: "b2", text: encodeMemory("forecast", { run: "live" }, "FORECAST x"), distance: 0.1 },
          { blob_id: "b3", text: "not a tuition memory", distance: 0.05 },
        ],
      };
    },
    async health() {
      return { status: "ok" };
    },
  };
  return { client, calls };
}

const tempLedger = () => join(mkdtempSync(join(tmpdir(), "tuition-store-")), "ledger-test.jsonl");
const write = (key: string) => ({ namespace: "tuition.r-1.lessons", text: "LESSON", key, kind: "lesson" as const, simDate: "2026-04-20" });

describe("WalrusMemoryStore", () => {
  it("writes once per idempotency key: a second write never calls the client", async () => {
    const { client, calls } = fakeClient();
    const store = new WalrusMemoryStore(client, tempLedger(), { concurrency: 2, maxWritesPerHour: 120 });
    const key = memoryKey("r-1", "lesson", "Q1");
    const first = await store.write(write(key));
    const second = await store.write(write(key));
    expect(second).toEqual(first);
    expect(calls.remember).toBe(1);
    expect(calls.wait).toBe(1);
  });

  it("resumes from the ledger on disk across store instances", async () => {
    const ledger = tempLedger();
    const key = memoryKey("r-1", "lesson", "Q1");
    const a = fakeClient();
    await new WalrusMemoryStore(a.client, ledger, { concurrency: 1, maxWritesPerHour: 120 }).write(write(key));
    const b = fakeClient();
    const again = await new WalrusMemoryStore(b.client, ledger, { concurrency: 1, maxWritesPerHour: 120 }).write(write(key));
    expect(b.calls.remember).toBe(0);
    expect(again.blobId).toBe("blob-job-1");
    expect(readLedger(ledger)).toHaveLength(1);
    expect(readLedger(ledger)[0]).toMatchObject({ key, kind: "lesson", createdSimDate: "2026-04-20", blobId: "blob-job-1" });
  });

  it("concurrent writes of the same key collapse to one", async () => {
    const { client, calls } = fakeClient();
    const store = new WalrusMemoryStore(client, tempLedger(), { concurrency: 1, maxWritesPerHour: 120 });
    const key = memoryKey("r-1", "lesson", "Q1");
    const [x, y] = await Promise.all([store.write(write(key)), store.write(write(key))]);
    expect(x).toEqual(y);
    expect(calls.remember).toBe(1);
  });

  it("waits when the hourly write cap is reached", async () => {
    const { client } = fakeClient();
    const clock: Clock & { t: number; slept: number[] } = {
      t: 0,
      slept: [],
      now() {
        return this.t;
      },
      async sleep(ms: number) {
        this.slept.push(ms);
        this.t += ms;
      },
    };
    const store = new WalrusMemoryStore(client, tempLedger(), { concurrency: 1, maxWritesPerHour: 2, clock });
    await store.write(write(memoryKey("r", "lesson", "1")));
    await store.write(write(memoryKey("r", "lesson", "2")));
    await store.write(write(memoryKey("r", "lesson", "3")));
    expect(clock.slept).toEqual([3_600_000]);
  });

  it("recall keeps only lesson and calibration memories", async () => {
    const { client } = fakeClient();
    const store = new WalrusMemoryStore(client, tempLedger(), { concurrency: 1, maxWritesPerHour: 120 });
    const got = await store.recall({ namespace: "tuition.r-1.lessons", query: "q", limit: 5 });
    expect(got.map((m) => m.blobId)).toEqual(["b1"]);
    expect(got[0]).toMatchObject({ kind: "lesson", distance: 0.2 });
  });

  it("adds the troubleshooting hint to a 401", async () => {
    const { client } = fakeClient();
    client.remember = async () => {
      throw Object.assign(new Error("401 from relayer"), { status: 401 });
    };
    const store = new WalrusMemoryStore(client, tempLedger(), { concurrency: 1, maxWritesPerHour: 120 });
    await expect(store.write(write(memoryKey("r", "lesson", "x")))).rejects.toThrow(/account OBJECT ID/);
  });
});

describe("InMemoryStore", () => {
  it("ranks by token overlap, honours maxDistance and returns fake blob IDs", async () => {
    const store = new InMemoryStore();
    const lesson = (body: string) => encodeMemory("lesson", { run: "r-1" }, body);
    await store.write({ namespace: "ns", text: lesson("breakout downtrend high volatility"), key: "k1", kind: "lesson" });
    await store.write({ namespace: "ns", text: lesson("direction uptrend calm"), key: "k2", kind: "lesson" });
    await store.write({ namespace: "other", text: lesson("breakout downtrend"), key: "k3", kind: "lesson" });
    const got = await store.recall({ namespace: "ns", query: "breakout downtrend", limit: 5, maxDistance: 0.9 });
    expect(got.map((m) => m.blobId)).toEqual(["mem-1"]);
    expect((await store.write({ namespace: "ns", text: "dup", key: "k1", kind: "lesson" })).blobId).toBe("mem-1");
  });

  it("sort=recent returns the newest first", async () => {
    const store = new InMemoryStore();
    for (const k of ["a", "b", "c"]) await store.write({ namespace: "cal", text: encodeMemory("calibration", { sim: k }, "CALIBRATION SNAPSHOT"), key: k, kind: "calibration" });
    const [latest] = await store.recall({ namespace: "cal", query: "calibration snapshot", limit: 1, sort: "recent" });
    expect(latest!.blobId).toBe("mem-3");
  });
});
