import { describe, expect, it } from "vitest";
import { findDelegateKey } from "../src/verify/proof";

const key = new Uint8Array([1, 2, 171, 255]); // hex 0102abff

describe("findDelegateKey", () => {
  it("finds the key as 0x-prefixed hex, case-insensitively", () => {
    expect(findDelegateKey(JSON.stringify({ delegate_keys: ["0x0102ABFF"] }), key)).toBe("hex with 0x");
  });

  it("finds the key as bare hex", () => {
    expect(findDelegateKey(JSON.stringify({ pk: "0102abff" }), key)).toBe("hex without 0x");
  });

  it("finds the key as base64, the way Sui GraphQL renders vector<u8>", () => {
    const b64 = Buffer.from(key).toString("base64");
    expect(findDelegateKey(JSON.stringify({ delegate_keys: [{ public_key: b64, label: "Web App" }] }), key)).toBe("base64");
  });

  it("finds the key as a vector<u8> byte array", () => {
    expect(findDelegateKey(JSON.stringify({ pk: [1, 2, 171, 255] }), key)).toBe("decimal byte array");
    expect(findDelegateKey('{"pk": [1, 2, 171, 255]}', key)).toBe("decimal byte array");
  });

  it("returns null when the key is absent", () => {
    expect(findDelegateKey(JSON.stringify({ pk: [1, 2, 171, 254] }), key)).toBeNull();
  });
});
