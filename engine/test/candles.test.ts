import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { checkIntegrity, historyWindow, mergeCandles, missingRanges, pages } from "../src/data/candles";
import { ENGINE_ROOT } from "../src/paths";
import { parseCandleBatch } from "../src/tatum/ohlcv";
import { candlesFromCloses } from "./helpers";

const fixture = JSON.parse(readFileSync(resolve(ENGINE_ROOT, "fixtures/ohlcv-batch-BTC-1d.json"), "utf8"));

describe("Tatum OHLCV parser (from the recorded fixture)", () => {
  it("turns decimal strings into numbers keyed by open time", () => {
    const c = parseCandleBatch(fixture.response.body);
    expect(c).toHaveLength(5);
    expect(c[0]).toEqual({ t: Date.UTC(2026, 2, 1), open: 66973.26, high: 68199.99, low: 65056, close: 65776.47 });
    expect(c.every((x, i) => i === 0 || x.t - c[i - 1]!.t === 86_400_000)).toBe(true);
  });

  it("rejects a response without prices", () => {
    expect(() => parseCandleBatch([{ symbol: "BTC", openTime: 1, closeTime: 2, open: "1" }])).toThrow();
    expect(() => parseCandleBatch({ error: "x" })).toThrow();
  });
});

describe("candle cache helpers", () => {
  it("merges by open time, later input wins, sorted", () => {
    const a = candlesFromCloses([1, 2, 3]);
    const b = [{ ...a[1]!, close: 20 }, ...candlesFromCloses([4], "2025-01-04")];
    const m = mergeCandles(a, b);
    expect(m.map((x) => x.close)).toEqual([1, 20, 3, 4]);
  });

  it("finds gaps and malformed candles", () => {
    const c = candlesFromCloses([1, 2, 3, 4, 5]);
    const gapped = [c[0]!, c[1]!, c[4]!];
    expect(checkIntegrity(gapped).gaps).toEqual([{ after: "2025-01-02", before: "2025-01-05", missingDays: 2 }]);
    expect(checkIntegrity([{ ...c[0]!, low: 10 }]).bad[0]!.reason).toMatch(/OHLC/);
    expect(checkIntegrity(c)).toEqual({ gaps: [], bad: [] });
  });

  it("fetches only ranges the cache has not requested", () => {
    expect(missingRanges(undefined, "2025-08-14", "2026-10-31")).toEqual([["2025-08-14", "2026-10-31"]]);
    const cache = { requestedFrom: "2025-08-14", requestedTo: "2026-10-31" };
    expect(missingRanges(cache, "2025-08-14", "2026-10-31")).toEqual([]);
    expect(missingRanges(cache, "2025-08-14", "2026-11-02")).toEqual([["2026-11-01", "2026-11-02"]]);
    expect(missingRanges(cache, "2025-08-01", "2026-10-31")).toEqual([["2025-08-01", "2025-08-13"]]);
  });

  it("pages 444 days into nine batch calls of at most 50", () => {
    const p = pages("2025-08-14", "2026-10-31");
    expect(p).toHaveLength(9);
    expect(p[0]).toEqual({ from: Date.UTC(2025, 7, 14), count: 50 });
    expect(p[8]!.count).toBe(44);
    expect(p.reduce((s, x) => s + x.count, 0)).toBe(444);
  });

  it("covers 200 days before the replay through the last closed candle", () => {
    const config = parseConfig({});
    expect(historyWindow(config, new Date("2026-11-01T08:00:00Z"))).toEqual({ start: "2025-08-14", end: "2026-10-31" });
    expect(historyWindow(config, new Date("2026-10-15T08:00:00Z"))).toEqual({ start: "2025-08-14", end: "2026-10-20" });
  });
});
