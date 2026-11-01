import { describe, expect, it } from "vitest";
import { HttpError, isRetryableError, parseRetryAfter, retry, retryAfterMsOf } from "../src/util/retry";

function recorder() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

function failing(make: () => unknown, okAfter = Infinity) {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls <= okAfter) throw make();
    return "ok";
  };
  return { fn, calls: () => calls };
}

describe("retry", () => {
  it("returns a first-try success without waiting", async () => {
    const r = recorder();
    await expect(retry(async () => 42, { sleep: r.sleep })).resolves.toBe(42);
    expect(r.waits).toEqual([]);
  });

  it("retries 5xx with 1s, 4s, 10s backoff, then rethrows the last error", async () => {
    const r = recorder();
    const f = failing(() => new HttpError(503, "down"));
    await expect(retry(f.fn, { sleep: r.sleep })).rejects.toThrow("down");
    expect(f.calls()).toBe(4);
    expect(r.waits).toEqual([1000, 4000, 10000]);
  });

  it("recovers after a 429", async () => {
    const r = recorder();
    const f = failing(() => new HttpError(429, "slow down"), 1);
    await expect(retry(f.fn, { sleep: r.sleep })).resolves.toBe("ok");
    expect(f.calls()).toBe(2);
  });

  it.each([400, 401, 403, 404, 409])("fails at once on HTTP %i", async (status) => {
    const r = recorder();
    const f = failing(() => new HttpError(status, "no"));
    await expect(retry(f.fn, { sleep: r.sleep })).rejects.toThrow("no");
    expect(f.calls()).toBe(1);
  });

  it("retries network failures from fetch", async () => {
    const r = recorder();
    const f = failing(() => new TypeError("fetch failed"), 2);
    await expect(retry(f.fn, { sleep: r.sleep })).resolves.toBe("ok");
    expect(r.waits).toEqual([1000, 4000]);
  });

  it("does not retry programming errors", async () => {
    const f = failing(() => new TypeError("x is not a function"));
    await expect(retry(f.fn, { sleep: recorder().sleep })).rejects.toThrow("not a function");
    expect(f.calls()).toBe(1);
  });

  it("waits for a server Retry-After longer than the backoff step", async () => {
    const r = recorder();
    const f = failing(() => new HttpError(429, "later", undefined, 7000), 1);
    await retry(f.fn, { sleep: r.sleep });
    expect(r.waits).toEqual([7000]);
  });

  it("rethrows instead of waiting out a Retry-After beyond the cap", async () => {
    const r = recorder();
    const f = failing(() => new HttpError(429, "come back in an hour", undefined, 3_600_000));
    await expect(retry(f.fn, { sleep: r.sleep, maxRetryAfterMs: 60_000 })).rejects.toThrow("hour");
    expect(r.waits).toEqual([]);
  });

  it("reports each retry", async () => {
    const seen: number[] = [];
    const f = failing(() => new HttpError(500, "boom"), 2);
    await retry(f.fn, { sleep: recorder().sleep, onRetry: (i) => seen.push(i.attempt) });
    expect(seen).toEqual([1, 2]);
  });
});

describe("error classification", () => {
  it("understands Walrus Memory SDK errors (status + retryAfterSeconds)", () => {
    const err = Object.assign(new Error("Walrus Memory server error (429)"), { status: 429, retryAfterSeconds: 3 });
    expect(isRetryableError(err)).toBe(true);
    expect(retryAfterMsOf(err)).toBe(3000);
    const auth = Object.assign(new Error("401 from relayer"), { status: 401, serverCode: "AUTH_REJECTED" });
    expect(isRetryableError(auth)).toBe(false);
  });

  it("retries timeouts and socket resets", () => {
    expect(isRetryableError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryableError(new Error("plain"))).toBe(false);
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("1.5")).toBe(1500);
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(parseRetryAfter("Thu, 29 Oct 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
