import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BlobCheck, MemoryLedgerEntry } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../src/paths";
import { parseAccountReply, type AccountObject } from "../src/tatum/sui";
import {
  assertNoSecrets,
  blobUrl,
  buildProof,
  findDelegateKey,
  proofProblems,
  sampleLessons,
  uniqueBlobs,
  type ProofInput,
} from "../src/verify/proof";

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

const publicKey = new Uint8Array(32).fill(7);

const account: AccountObject = {
  objectId: `0x${"a".repeat(64)}`,
  version: "12",
  digest: "dig",
  type: "0xe7::account::MemWalAccount",
  owner: "Shared",
  accountOwner: "0xowner",
  contentJson: JSON.stringify({ delegate_keys: [{ public_key: Buffer.from(publicKey).toString("base64") }] }),
};

const blob = (blobId: string, status: number | null): BlobCheck => ({
  blobId,
  kind: "lesson",
  namespace: "tuition.r.lessons",
  status,
  bytes: status === 200 ? 100 : null,
  sha256: status === 200 ? "0".repeat(64) : null,
  url: `https://aggregator.example/v1/blobs/${blobId}`,
});

const input = (over: Partial<ProofInput> = {}): ProofInput => ({
  generatedAt: "2026-11-06T12:00:00.000Z",
  runId: "r-1",
  publicKey,
  accountId: `0x${"a".repeat(64)}`,
  relayer: { url: "https://relayer.example/", checkedAt: "2026-11-06T12:00:00.000Z", health: { status: "ok" } },
  account,
  accountEndpoint: "https://sui.example/graphql",
  aggregator: "https://aggregator.example",
  blobs: [blob("a", 200), blob("b", 200)],
  recall: [{ blobId: "a", questionId: "q", topBlobId: "a", distance: 0.1, matched: true }],
  counts: { total: 2, byKind: { lesson: 2 }, byNamespace: { "tuition.r.lessons": 2 } },
  ...over,
});

describe("parseAccountReply", () => {
  it("reads the real shape saved by probe:sui", () => {
    const fixture = JSON.parse(readFileSync(resolve(FIXTURES_DIR, "sui-graphql-account.json"), "utf8")) as { response: { body: unknown } };
    const a = parseAccountReply(fixture.response.body);
    expect(a.type).toContain("MemWalAccount");
    expect(a.owner).toBe("Shared");
    expect(a.contentJson).toContain("delegate_keys");
  });

  it("reads the fields of a reply", () => {
    const body = {
      data: {
        object: {
          address: "0xabc",
          version: 7,
          digest: "dig",
          owner: { __typename: "Shared" },
          asMoveObject: { contents: { type: { repr: "0x1::a::B" }, json: { owner: "0xme", delegate_keys: [] } } },
        },
      },
    };
    expect(parseAccountReply(body)).toMatchObject({ objectId: "0xabc", version: "7", owner: "Shared", accountOwner: "0xme" });
  });

  it("throws when there is no object or the reply has errors", () => {
    expect(() => parseAccountReply({ data: { object: null } })).toThrow(/wallet address/);
    expect(() => parseAccountReply({ errors: [{ message: "bad" }] })).toThrow(/bad/);
  });
});

describe("buildProof", () => {
  it("counts blobs and recall, finds the key and validates", () => {
    const p = buildProof(input());
    expect(p.agentId).toBe("07".repeat(32));
    expect(p.account.delegateKeyFound).toBe(true);
    expect(p.account.explorerUrl).toBe(`https://suiscan.xyz/mainnet/object/0x${"a".repeat(64)}`);
    expect(p.blobs).toMatchObject({ checked: 2, ok: 2, failed: 0, totalBytes: 200 });
    expect(p.recall).toMatchObject({ checked: 1, matched: 1 });
    expect(proofProblems(p)).toEqual([]);
  });

  it("reports every failure instead of hiding it", () => {
    const p = buildProof(
      input({
        blobs: [blob("a", 200), blob("b", 404), blob("c", null)],
        recall: [{ blobId: "a", questionId: "q", topBlobId: "z", distance: 0.2, matched: false }],
        account: { ...account, contentJson: "{}" },
      }),
    );
    expect(p.blobs).toMatchObject({ ok: 1, failed: 2, totalBytes: 100 });
    expect(proofProblems(p)).toHaveLength(3);
  });
});

describe("the proof helpers", () => {
  it("assertNoSecrets refuses a secret without naming it", () => {
    const secret = "sk-super-secret-value";
    let message = "";
    try {
      assertNoSecrets(`{"x":"${secret}"}`, [undefined, secret]);
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/contains a configured secret/);
    expect(message).not.toContain(secret);
  });

  it("a built proof holds none of the input secrets", () => {
    expect(() => assertNoSecrets(JSON.stringify(buildProof(input())), ["sk-super-secret-value", undefined])).not.toThrow();
  });

  it("uniqueBlobs keeps one entry per blob", () => {
    const e = (blobId: string): MemoryLedgerEntry => ({
      key: "0".repeat(64),
      namespace: "n",
      kind: "lesson",
      blobId,
      jobId: "j",
      createdAt: "2026-11-06T12:00:00.000Z",
      textSha256: "0".repeat(64),
    });
    expect(uniqueBlobs([e("a"), e("b"), e("a")]).map((x) => x.blobId)).toEqual(["a", "b"]);
  });

  it("sampleLessons is repeatable and takes each lesson at most once", () => {
    const lessons = ["a", "b", "c", "d", "e"].map((blobId) => ({ blobId }));
    const one = sampleLessons(lessons, 3, "r-1");
    expect(one).toEqual(sampleLessons(lessons, 3, "r-1"));
    expect(new Set(one.map((l) => l.blobId)).size).toBe(3);
    expect(sampleLessons(lessons, 9, "r-1")).toHaveLength(5);
  });

  it("blobUrl trims the trailing slash", () => {
    expect(blobUrl("https://a.example/", "x_y-z")).toBe("https://a.example/v1/blobs/x_y-z");
  });
});
