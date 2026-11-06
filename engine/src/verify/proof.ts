// §11 verification. Builds web/public/data/proof.json. Everything here is pure; the network calls are
// in commands/verify.ts.
import {
  ProofFileSchema,
  type BlobCheck,
  type LessonRow,
  type MemoryLedgerEntry,
  type ProofFile,
  type RecallCheck,
} from "@tuition/shared";
import type { AccountObject } from "../tatum/sui";
import { mulberry32, seedFromString, shuffle } from "../util/rng";

export const SUI_OBJECT_EXPLORER = "https://suiscan.xyz/mainnet/object";

/** Blob links use the aggregator: no explorer URL pattern could be confirmed (DECISIONS D47). */
export const blobUrl = (aggregator: string, blobId: string): string =>
  `${aggregator.replace(/\/+$/, "")}/v1/blobs/${encodeURIComponent(blobId)}`;

/**
 * Where the delegate public key appears in the account object's JSON (§11.2), or null.
 * Case-insensitive for hex; also tries base64 (how Sui GraphQL renders vector<u8>) and the
 * decimal byte-array form.
 */
export function findDelegateKey(objectJson: string, publicKey: Uint8Array): string | null {
  const haystack = objectJson.toLowerCase();
  const hex = Buffer.from(publicKey).toString("hex");
  if (haystack.includes(`0x${hex}`)) return "hex with 0x";
  if (haystack.includes(hex)) return "hex without 0x";
  if (objectJson.includes(Buffer.from(publicKey).toString("base64"))) return "base64";
  if (haystack.replace(/\s+/g, "").includes(`[${Array.from(publicKey).join(",")}]`)) return "decimal byte array";
  return null;
}

/** One entry per blob, in ledger order: what the aggregator check covers (§11.3). */
export function uniqueBlobs(entries: readonly MemoryLedgerEntry[]): MemoryLedgerEntry[] {
  return [...new Map(entries.map((e) => [e.blobId, e])).values()];
}

/** A repeatable random sample of lessons for the recall round-trip (§11.4). */
export function sampleLessons<T extends Pick<LessonRow, "blobId">>(lessons: readonly T[], n: number, runId: string): T[] {
  return shuffle(lessons, mulberry32(seedFromString(runId))).slice(0, n);
}

/** Throws without naming the value if a secret is anywhere in the text. */
export function assertNoSecrets(text: string, secrets: readonly (string | undefined)[]): void {
  const found = secrets.filter((s): s is string => !!s).some((s) => text.includes(s));
  if (found) throw new Error("Refusing to write proof.json: it contains a configured secret");
}

export interface ProofInput {
  generatedAt: string;
  runId: string;
  publicKey: Uint8Array;
  accountId: string;
  relayer: { url: string; checkedAt: string; health: Record<string, unknown> };
  account: AccountObject;
  accountEndpoint: string;
  aggregator: string;
  blobs: readonly BlobCheck[];
  recall: readonly RecallCheck[];
  counts: ProofFile["counts"];
}

export function buildProof(input: ProofInput): ProofFile {
  const { account: a, blobs, recall } = input;
  const encoding = findDelegateKey(a.contentJson, input.publicKey);
  const ok = blobs.filter((b) => b.status === 200);
  return ProofFileSchema.parse({
    generatedAt: input.generatedAt,
    runId: input.runId,
    agentId: Buffer.from(input.publicKey).toString("hex"),
    accountId: input.accountId,
    relayer: input.relayer,
    account: {
      source: "Tatum Sui gateway (GraphQL)",
      endpoint: input.accountEndpoint,
      objectId: a.objectId,
      version: a.version,
      digest: a.digest,
      type: a.type,
      owner: a.owner,
      accountOwner: a.accountOwner,
      delegateKeyFound: encoding !== null,
      delegateKeyEncoding: encoding,
      explorerUrl: `${SUI_OBJECT_EXPLORER}/${input.accountId}`,
    },
    blobs: {
      aggregator: input.aggregator,
      checked: blobs.length,
      ok: ok.length,
      failed: blobs.length - ok.length,
      totalBytes: ok.reduce((s, b) => s + (b.bytes ?? 0), 0),
      rows: blobs,
    },
    recall: { checked: recall.length, matched: recall.filter((r) => r.matched).length, rows: recall },
    counts: input.counts,
  });
}

/** Everything that must hold for the proof to pass; empty means it passed. */
export function proofProblems(proof: ProofFile): string[] {
  const out: string[] = [];
  if (!proof.account.delegateKeyFound) out.push("the delegate key is not on the account object");
  if (proof.blobs.failed > 0) out.push(`${proof.blobs.failed} of ${proof.blobs.checked} blobs did not return HTTP 200`);
  if (proof.recall.matched < proof.recall.checked) {
    out.push(`${proof.recall.checked - proof.recall.matched} recall round-trip(s) did not return the same blob first`);
  }
  return out;
}
