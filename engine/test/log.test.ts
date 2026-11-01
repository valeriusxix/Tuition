import { describe, expect, it } from "vitest";
import { redact, redactSecrets, registerSecret } from "../src/log";

describe("redaction", () => {
  it("masks secret values wherever they appear", () => {
    expect(redactSecrets("key=abc123secret and again abc123secret", ["abc123secret"])).toBe("key=*** and again ***");
  });

  it("masks Anthropic keys and suiprivkey strings even when not registered", () => {
    // Built at runtime so no credential-shaped literal sits in the repo (push protection, secret scans).
    const fakeAnthropic = ["sk", "ant", "test", "x".repeat(16)].join("-");
    const fakeSui = `${"sui"}privkey1${"q".repeat(30)}`;
    expect(redactSecrets(`${fakeAnthropic} ${fakeSui}`, [])).toBe("*** ***");
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("blob_id=0xabc distance=0.31", ["unrelated-secret"])).toBe("blob_id=0xabc distance=0.31");
  });

  it("registered hex secrets are masked with and without 0x", () => {
    const hex = "c0ffee".repeat(10) + "abcd";
    registerSecret(hex);
    expect(redact(`raw ${hex} prefixed 0x${hex}`)).toBe("raw *** prefixed 0x***");
    expect(redact("nothing secret here")).toBe("nothing secret here");
  });
});
