import { describe, expect, it } from "vitest";
import { checkNodeVersion, parseNodeVersion } from "../src/util/node";

describe("checkNodeVersion", () => {
  it.each([
    ["v24.22.1", true],
    ["v24.22.2", true],
    ["v24.23.0", true],
    ["v24.22.0", false],
    ["v24.15.0", false],
    ["v22.23.4", true],
    ["v22.24.0", true],
    ["v22.23.3", false],
    ["v26.12.1", true],
    ["v26.12.0", false],
    ["v27.0.0", true],
    ["v23.11.0", false],
    ["v25.9.0", false],
    ["v20.19.0", false],
  ])("%s → ok=%s", (version, ok) => {
    expect(checkNodeVersion(version).ok).toBe(ok);
  });

  it("names the minimum and how to upgrade when too old", () => {
    const { message } = checkNodeVersion("v24.15.0");
    expect(message).toContain("24.22.1");
    expect(message).toContain("winget");
  });

  it("rejects an unparseable version", () => {
    expect(checkNodeVersion("banana").ok).toBe(false);
  });

  it("parses vX.Y.Z", () => {
    expect(parseNodeVersion("v24.22.1")).toEqual([24, 22, 1]);
    expect(parseNodeVersion("24.22.1")).toEqual([24, 22, 1]);
    expect(parseNodeVersion("x")).toBeNull();
  });
});
