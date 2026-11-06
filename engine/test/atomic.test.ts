import { describe, expect, it } from "vitest";
import { replaceFile } from "../src/util/atomic";

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("replaceFile", () => {
  it("retries a transient Windows failure, then succeeds", () => {
    let calls = 0;
    const waits: number[] = [];
    const rename = () => {
      if (++calls < 3) throw errno("EPERM");
    };
    replaceFile("a", "b", rename, (ms) => waits.push(ms));
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("throws other errors at once", () => {
    let calls = 0;
    const rename = () => {
      calls++;
      throw errno("ENOENT");
    };
    expect(() => replaceFile("a", "b", rename, () => {})).toThrow("ENOENT");
    expect(calls).toBe(1);
  });

  it("gives up on a failure that does not clear", () => {
    let calls = 0;
    const rename = () => {
      calls++;
      throw errno("EBUSY");
    };
    expect(() => replaceFile("a", "b", rename, () => {})).toThrow("EBUSY");
    expect(calls).toBe(20);
  });
});
