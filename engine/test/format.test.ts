import { describe, expect, it } from "vitest";
import { decodeHeader, encodeMemory, MAX_MEMORY_CHARS, memoryBody } from "../src/memory/format";

const LESSON_FIELDS = {
  run: "r-20261101-0930-a1b2",
  q: "BREAKOUT-SOL-2026-04-13",
  type: "BREAKOUT",
  regime: "down/high/expanding",
  sim: "2026-04-20",
  adj: "raise",
  mag: 0.15,
};
const BODY = "LESSON (BREAKOUT, downtrend, high volatility, volatility expanding): I underestimated large excursions.";

describe("memory format", () => {
  it("encodes the §7.6 header line followed by the body", () => {
    expect(encodeMemory("lesson", LESSON_FIELDS, BODY)).toBe(
      "[TUITION v1|kind=lesson|run=r-20261101-0930-a1b2|q=BREAKOUT-SOL-2026-04-13|type=BREAKOUT|regime=down/high/expanding|sim=2026-04-20|adj=raise|mag=0.15]\n" +
        BODY,
    );
  });

  it("round-trips header fields", () => {
    const h = decodeHeader(encodeMemory("lesson", LESSON_FIELDS, BODY));
    expect(h).toEqual({ kind: "lesson", fields: { ...LESSON_FIELDS, mag: "0.15" } });
  });

  it("tolerates missing optional fields", () => {
    expect(decodeHeader("[TUITION v1|kind=calibration|sim=2026-05-04]\nCALIBRATION SNAPSHOT")).toEqual({
      kind: "calibration",
      fields: { sim: "2026-05-04" },
    });
  });

  it("returns null for anything that is not a Tuition memory", () => {
    expect(decodeHeader("tuition smoke test 2026-11-01T08:24:00Z")).toBeNull();
    expect(decodeHeader("[OTHER v1|kind=lesson]\nbody")).toBeNull();
    expect(decodeHeader("[TUITION v1|kind=unknown]\nbody")).toBeNull();
    expect(decodeHeader("[TUITION v1|sim=2026-01-01]\nno kind")).toBeNull();
  });

  it("strips the header to give the prompt-safe body", () => {
    expect(memoryBody(encodeMemory("lesson", LESSON_FIELDS, BODY))).toBe(BODY);
    expect(memoryBody("  plain text  ")).toBe("plain text");
  });

  it("caps the total length at 1,000 characters", () => {
    expect(() => encodeMemory("lesson", LESSON_FIELDS, "x".repeat(MAX_MEMORY_CHARS))).toThrow(/1000/);
    const fits = encodeMemory("lesson", {}, "x".repeat(MAX_MEMORY_CHARS - "[TUITION v1|kind=lesson]\n".length));
    expect(fits.length).toBe(MAX_MEMORY_CHARS);
  });

  it("refuses header values that would break the format", () => {
    expect(() => encodeMemory("lesson", { regime: "a|b" }, BODY)).toThrow(/reserved/);
    expect(() => encodeMemory("lesson", { q: "x]y" }, BODY)).toThrow(/reserved/);
    expect(() => encodeMemory("lesson", { "bad key": "v" }, BODY)).toThrow(/reserved/);
  });
});
