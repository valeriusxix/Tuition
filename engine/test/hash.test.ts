import { describe, expect, it } from "vitest";
import { memoryKey, sha256Hex } from "../src/util/hash";

describe("hash", () => {
  it("computes SHA-256 hex", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });

  it("builds the §7.7 idempotency key as sha256(runId:kind:ref)", () => {
    const key = memoryKey("r-20261101-0930-a1b2", "lesson", "BREAKOUT-SOL-2026-04-13");
    expect(key).toBe(sha256Hex("r-20261101-0930-a1b2:lesson:BREAKOUT-SOL-2026-04-13"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(memoryKey("r-1", "calibration", "2026-05-04")).not.toBe(memoryKey("r-1", "lesson", "2026-05-04"));
  });
});
