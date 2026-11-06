import type { Comparison, ProofFile, SummaryFile } from "@tuition/shared";
import { describe, expect, it } from "vitest";
import { evidenceBlock, fillBlock, headlineBlock, linksBlock, LinksSchema, renderDocs, requirementsBlock, resultsTable } from "../src/publish/docs";

const compare = (over: Partial<Comparison> = {}): Comparison => ({
  id: "mem_vs_nomem",
  candidate: "mem",
  reference: "nomem",
  split: "test",
  candidateBrier: 0.258,
  referenceBrier: 0.267,
  meanDelta: 0.0089,
  ci95: [-0.0134, 0.0325],
  shareAboveZero: 0.77,
  resamples: 2000,
  blocks: 20,
  n: 160,
  ...over,
});

const metric = (brier: number, skillVsBase: number | null) => ({ n: 160, brier, logLoss: 0.7, accuracy: 0.5, ece: 0.1, skillVsBase });

const summary = (headline: Comparison | null = compare()): SummaryFile =>
  ({
    runId: "r-1",
    arms: ["base", "nomem", "mem"],
    config: { assets: ["BTC", "ETH"] },
    namespaces: { lessons: "tuition.r-1.lessons", calibration: "tuition.r-1.calibration" },
    counts: { lessons: 181, calibrations: 32 },
    metrics: {
      base: { test: { all: metric(0.259, null) } },
      nomem: { test: { all: metric(0.267, -0.031) } },
      mem: { test: { all: metric(0.258, 0.004) } },
    },
    comparisons: [
      compare({ id: "nomem2_vs_nomem", meanDelta: 0.0052 }),
      compare({ id: "mem_vs_base", meanDelta: 0.001, candidateBrier: 0.258, referenceBrier: 0.259 }),
    ],
    headline,
    memories: { mainnet: { total: 485, byKind: {}, byNamespace: {} } },
  }) as unknown as SummaryFile;

const proof = {
  agentId: "ab".repeat(32),
  accountId: `0x${"a".repeat(64)}`,
  generatedAt: "2026-11-06T16:14:00.000Z",
  account: { explorerUrl: "https://suiscan.xyz/mainnet/object/0xa", delegateKeyFound: true },
  blobs: { ok: 2, checked: 2, rows: [{ blobId: "b1", kind: "lesson", status: 200, url: "https://a.example/v1/blobs/b1" }] },
  recall: { matched: 3, checked: 3 },
  counts: { total: 485, byKind: { lesson: 364 }, byNamespace: {} },
} as unknown as ProofFile;

const noLinks = { demo: null, video: null, blog: null };

const block = (name: string) => `<!-- GENERATED:${name} -->\nold\n<!-- /GENERATED:${name} -->`;

describe("fillBlock", () => {
  it("replaces only the text between the markers, repeatably", () => {
    const once = fillBlock(`before\n${block("x")}\nafter`, "x", "new");
    expect(once).toBe("before\n<!-- GENERATED:x -->\nnew\n<!-- /GENERATED:x -->\nafter");
    expect(fillBlock(once, "x", "new")).toBe(once);
  });

  it("fails on a missing marker instead of leaving stale numbers", () => {
    expect(() => fillBlock("no markers", "x", "new")).toThrow(/Missing block x/);
  });
});

describe("published wording", () => {
  it("never claims an improvement when the interval spans zero", () => {
    const text = headlineBlock(summary());
    expect(text).toContain("Not statistically significant");
    expect(text).toContain("does not show a reliable improvement");
    expect(text).not.toMatch(/Reliable improvement/);
    expect(text).toContain("0.267");
    expect(text).toContain("[−0.0134, +0.0325]");
  });

  it("names a real improvement or a real loss by the interval alone", () => {
    expect(headlineBlock(summary(compare({ ci95: [0.001, 0.03] })))).toContain("Reliable improvement");
    expect(headlineBlock(summary(compare({ meanDelta: -0.02, ci95: [-0.03, -0.01] })))).toContain("Reliably worse");
  });

  it("states the noise and base-rate context beside the headline", () => {
    const text = headlineBlock(summary());
    expect(text).toContain("+0.0052");
    expect(text).toContain("0.258 vs 0.259");
  });

  it("copes with a run that has no headline", () => {
    expect(headlineBlock(summary(null))).toMatch(/no headline/);
  });
});

describe("tables and checklists", () => {
  it("lists every arm's test scores", () => {
    const t = resultsTable(summary());
    expect(t).toContain("| Memory OFF | 160 | 0.267 |");
    expect(t).toContain("| Base rate (no LLM) | 160 | 0.259 | 0.700 | 0.500 | 0.100 | - |");
    expect(t).toContain("+0.004");
  });

  it("ticks the Tatum item only when the proof found the key", () => {
    expect(requirementsBlock(summary(), proof, noLinks)).toContain("[x] Tatum RPC");
    expect(requirementsBlock(summary(), null, noLinks)).toContain("[ ] Tatum RPC");
  });

  it("ticks the blog item only when its link exists", () => {
    expect(requirementsBlock(summary(), proof, noLinks)).toContain("[ ] Blog post");
    expect(requirementsBlock(summary(), proof, { ...noLinks, blog: "https://blog.example/post" })).toContain("[x] Blog post: https://blog.example/post");
  });

  it("lists each link, or says it is still to come", () => {
    const text = linksBlock({ ...noLinks, demo: "https://demo.example/" });
    expect(text).toContain("- Demo: https://demo.example/");
    expect(text).toContain("- Video: _to be added_");
    expect(LinksSchema.safeParse({ ...noLinks, demo: "not a url" }).success).toBe(false);
  });

  it("the evidence table carries both IDs and blob links", () => {
    const e = evidenceBlock(summary(), proof);
    expect(e).toContain(proof.agentId);
    expect(e).toContain(proof.accountId);
    expect(e).toContain("[`b1`](https://a.example/v1/blobs/b1)");
    expect(evidenceBlock(summary(), null)).toMatch(/verify/);
  });

  it("renderDocs fills all five blocks", () => {
    const readme = ["headline", "links", "requirements", "evidence"].map(block).join("\n");
    const out = renderDocs({ readme, blog: block("results"), summary: summary(), proof, links: noLinks });
    expect(out.readme).not.toContain("old");
    expect(out.blog).not.toContain("old");
  });
});
