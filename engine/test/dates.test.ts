import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatDate,
  isMonday,
  isValidDate,
  mondaysBetween,
  parseDate,
  toIsoSeconds,
  yesterdayUtc,
} from "../src/util/dates";

describe("dates", () => {
  it("round-trips YYYY-MM-DD and epoch ms at 00:00Z", () => {
    expect(parseDate("2026-03-01")).toBe(Date.UTC(2026, 2, 1));
    expect(formatDate(Date.UTC(2026, 2, 1, 23, 59))).toBe("2026-03-01");
  });

  it("rejects impossible or malformed dates", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-2-3")).toBe(false);
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(() => parseDate("2026-13-01")).toThrow(/Invalid date/);
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-02", -200)).toBe("2025-08-14"); // candle history start (§6.1)
  });

  it("counts whole days between dates", () => {
    expect(diffDays("2026-03-02", "2026-10-12")).toBe(224);
    expect(diffDays("2026-10-12", "2026-03-02")).toBe(-224);
  });

  it("confirms the configured replay dates are Mondays", () => {
    expect(isMonday("2026-03-02")).toBe(true);
    expect(isMonday("2026-10-12")).toBe(true);
    expect(isMonday("2026-05-25")).toBe(true);
    expect(isMonday("2026-03-01")).toBe(false);
  });

  it("lists the 33 replay Mondays, 13 of them in the dev split", () => {
    const mondays = mondaysBetween("2026-03-02", "2026-10-12");
    expect(mondays).toHaveLength(33);
    expect(mondays[0]).toBe("2026-03-02");
    expect(mondays.at(-1)).toBe("2026-10-12");
    expect(mondays.filter((d) => d <= "2026-05-25")).toHaveLength(13);
  });

  it("starts from the first Monday on or after the start date", () => {
    expect(mondaysBetween("2026-03-03", "2026-03-20")).toEqual(["2026-03-09", "2026-03-16"]);
    expect(mondaysBetween("2026-03-03", "2026-03-04")).toEqual([]);
  });

  it("formats Tatum query times without milliseconds", () => {
    expect(toIsoSeconds(Date.UTC(2026, 2, 1))).toBe("2026-03-01T00:00:00Z");
  });

  it("takes yesterday from the UTC calendar day", () => {
    expect(yesterdayUtc(new Date("2026-11-01T00:17:00Z"))).toBe("2026-10-31");
    expect(yesterdayUtc(new Date("2026-11-01T23:59:59Z"))).toBe("2026-10-31");
  });
});
