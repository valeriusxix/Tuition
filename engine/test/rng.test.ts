import { describe, expect, it } from "vitest";
import { mulberry32, randInt, randomHex, seedFromString, shuffle } from "../src/util/rng";

describe("rng", () => {
  it("is deterministic for a seed", () => {
    expect(Array.from({ length: 5 }, mulberry32(42))).toEqual(Array.from({ length: 5 }, mulberry32(42)));
  });

  it("differs across seeds and stays in [0, 1)", () => {
    const a = Array.from({ length: 1000 }, mulberry32(1));
    const b = Array.from({ length: 1000 }, mulberry32(2));
    expect(a).not.toEqual(b);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("randInt covers [0, n) evenly", () => {
    const rng = mulberry32(7);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) counts[randInt(rng, 4)]!++;
    for (const c of counts) expect(c).toBeGreaterThan(1800);
  });

  it("shuffle returns a seed-stable permutation and leaves the input untouched", () => {
    const items = ["BTC", "ETH", "SOL", "SUI"];
    const once = shuffle(items, mulberry32(42));
    expect([...once].sort()).toEqual([...items].sort());
    expect(shuffle(items, mulberry32(42))).toEqual(once);
    expect(items).toEqual(["BTC", "ETH", "SOL", "SUI"]);
  });

  it("shuffle puts each item first about equally often", () => {
    const rng = mulberry32(3);
    const firsts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const first = shuffle(["a", "b", "c", "d"], rng)[0]!;
      firsts[first] = (firsts[first] ?? 0) + 1;
    }
    for (const k of ["a", "b", "c", "d"]) expect(firsts[k]).toBeGreaterThan(850);
  });

  it("randomHex yields lowercase hex of the requested length", () => {
    expect(randomHex(mulberry32(1), 4)).toMatch(/^[0-9a-f]{4}$/);
  });

  it("seedFromString is FNV-1a", () => {
    expect(seedFromString("a")).toBe(0xe40c292c);
    expect(seedFromString("abc")).not.toBe(seedFromString("abd"));
  });
});
