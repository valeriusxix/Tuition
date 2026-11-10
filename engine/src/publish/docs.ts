// README and blog numbers (§13, §14): "filled from summary.json, never typed by hand". Each generated part
// sits between <!-- GENERATED:name --> and <!-- /GENERATED:name --> markers. Everything here is pure.
import { verdict, type Comparison, type ProofFile, type SummaryFile } from "@tuition/shared";
import { z } from "zod";

/** docs/links.json: fill in each URL as it exists, then run `export --run <runId> --docs`. */
export const LinksSchema = z.object({ demo: z.url().nullable(), video: z.url().nullable(), blog: z.url().nullable() });
export type Links = z.infer<typeof LinksSchema>;

const b = (x: number): string => x.toFixed(3);
const signed = (x: number, digits = 4): string => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;

/** Replaces the text between a block's markers. A missing marker is an error, never a silent skip. */
export function fillBlock(text: string, name: string, content: string): string {
  const open = `<!-- GENERATED:${name} -->`;
  const close = `<!-- /GENERATED:${name} -->`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < start) throw new Error(`Missing block ${name}: expected ${open} … ${close}`);
  return `${text.slice(0, start + open.length)}\n${content}\n${text.slice(end)}`;
}

const comparison = (s: SummaryFile, id: string, split = "test"): Comparison | undefined => s.comparisons.find((c) => c.id === id && c.split === split);

export function headlineBlock(s: SummaryFile): string {
  const h = s.headline;
  if (!h) return "**Result:** the official run has no headline comparison yet.";
  const aa = comparison(s, "nomem2_vs_nomem");
  const base = comparison(s, "mem_vs_base");
  const lines = [
    `**Result (test split, ${h.n} questions over ${h.blocks} weeks):** Brier with memory OFF ${b(h.referenceBrier)}, ON ${b(h.candidateBrier)}. ` +
      `Change ${signed(h.meanDelta)}, 95% CI [${signed(h.ci95[0])}, ${signed(h.ci95[1])}], P(Δ>0) = ${h.shareAboveZero.toFixed(2)}. **${verdict(h).label}.**`,
    "",
    verdict(h).sentence,
  ];
  if (aa) lines.push("", `Two identical no-memory passes differ by ${signed(aa.meanDelta)} on the same questions, so a gap of this size can come from model noise alone.`);
  if (base) lines.push("", `Against a plain trailing base rate with no LLM, memory is ${signed(base.meanDelta)} (${b(base.candidateBrier)} vs ${b(base.referenceBrier)}).`);
  const pair = runPairBlock(s);
  if (pair) lines.push("", pair);
  return lines.join("\n");
}

/** D51: the two official runs side by side, with what differed. Empty for a run without a pair. */
export function runPairBlock(s: SummaryFile): string {
  const o = s.otherRun;
  if (!o || !s.headline) return "";
  const cu = s.calibrationUse;
  const ou = o.calibrationUse;
  const row = (label: string, h: Comparison | null) =>
    h ? `| ${label} | ${b(h.referenceBrier)} | ${b(h.candidateBrier)} | ${signed(h.meanDelta)} | [${signed(h.ci95[0])}, ${signed(h.ci95[1])}] | ${h.shareAboveZero.toFixed(2)} |` : `| ${label} | - | - | - | - | - |`;
  return [
    `**Two official runs.** The first official run (\`${o.runId}\`) had a bug: its memory arm asked for the newest calibration snapshot in a way that only searched the few closest matches, so ` +
      `${ou.frozenFrom ? `from ${ou.frozenFrom} on ` : ""}it kept getting an old one (${ou.staleWeeks} of ${ou.weeks} weeks stale; ${ou.used} of ${ou.written} snapshots ever reached a prompt). ` +
      `This run (\`${s.runId}\`) is the single rerun, pre-registered before it started, with only that fixed (DECISIONS D51)` +
      `${cu ? `: ${cu.weeks - cu.staleWeeks} of ${cu.weeks} weeks got the newest snapshot` : ""}. Both are published.`,
    "",
    "| Test split | Memory OFF | Memory ON | Δ | 95% CI | P(Δ>0) |",
    "|---|---:|---:|---:|---:|---:|",
    row(`Rerun, calibration fixed (\`${s.runId}\`, headline)`, s.headline),
    row(`First run, calibration frozen (\`${o.runId}\`)`, o.headline),
  ].join("\n");
}

export function resultsTable(s: SummaryFile): string {
  const rows = s.arms.flatMap((arm) => {
    const m = s.metrics[arm]?.test?.all;
    if (!m) return [];
    const label = { base: "Base rate (no LLM)", nomem: "Memory OFF", nomem2: "Memory OFF, second pass", mem: "Memory ON" }[arm];
    return [`| ${label} | ${m.n} | ${b(m.brier)} | ${b(m.logLoss)} | ${b(m.accuracy)} | ${b(m.ece)} | ${m.skillVsBase === null ? "-" : signed(m.skillVsBase, 3)} |`];
  });
  const h = s.headline;
  return [
    "| Arm | n | Brier | Log loss | Accuracy | ECE | Skill vs base |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...rows,
    "",
    h ? `Memory ON vs OFF: ${signed(h.meanDelta)}, 95% CI [${signed(h.ci95[0])}, ${signed(h.ci95[1])}], ${h.resamples} block-bootstrap resamples. ${verdict(h).label}.` : "",
    ...(s.otherRun ? ["", runPairBlock(s)] : []),
  ].join("\n");
}

export function linksBlock(links: Links): string {
  const line = (label: string, url: string | null): string => `- ${label}: ${url ?? "_to be added_"}`;
  return [line("Demo", links.demo), line("Video", links.video), line("Blog post", links.blog)].join("\n");
}

export function requirementsBlock(s: SummaryFile, proof: ProofFile | null, links: Links): string {
  const m = s.memories.mainnet;
  const tick = (ok: boolean): string => (ok ? "x" : " ");
  return [
    `- [${tick(m.total > 0)}] Walrus Memory writes on mainnet: **${m.total}** memories across all runs (${s.counts.lessons} lessons and ${s.counts.calibrations} calibration snapshots in the official run)`,
    `- [${tick(m.total >= 10)}] At least 10 memories: **${m.total}**`,
    `- [${tick(proof?.account.delegateKeyFound === true)}] Tatum RPC: the account object is read through Tatum's Sui gateway (\`verify\`, see \`/verify\`)`,
    `- [x] Tatum Data API: daily OHLCV candles for ${s.config.assets.join(", ")}`,
    links.blog ? `- [x] Blog post: ${links.blog}` : "- [ ] Blog post: link to be added on publication",
  ].join("\n");
}

export function evidenceBlock(s: SummaryFile, proof: ProofFile | null): string {
  if (!proof) return "Run `npm run engine -- verify --run <runId>` to fill this table.";
  const samples = proof.blobs.rows.filter((r) => r.kind === "lesson" && r.status === 200).slice(0, 5);
  return [
    "| Item | Value |",
    "|---|---|",
    `| Agent ID (\`MEMWAL_AGENT_ID\`) | \`${proof.agentId}\` |`,
    `| Account ID (\`MEMWAL_ACCOUNT_ID\`) | [\`${proof.accountId}\`](${proof.account.explorerUrl}) |`,
    `| Official run | \`${s.runId}\` |`,
    `| Lesson namespace | \`${s.namespaces.lessons}\` (${s.counts.lessons}) |`,
    `| Calibration namespace | \`${s.namespaces.calibration}\` (${s.counts.calibrations}) |`,
    `| Live namespaces | \`tuition.live.forecasts\`, \`tuition.live.lessons\`, \`tuition.live.calibration\` |`,
    `| Memories by kind, all runs | ${Object.entries(proof.counts.byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")} (total ${proof.counts.total}) |`,
    `| Blob check (${proof.generatedAt.slice(0, 10)}) | ${proof.blobs.ok} of ${proof.blobs.checked} blobs HTTP 200 from the aggregator |`,
    `| Recall round-trip | ${proof.recall.matched} of ${proof.recall.checked} lessons came back first by their own text |`,
    "",
    "Sample lesson blobs (the content is encrypted):",
    "",
    ...samples.map((r) => `- [\`${r.blobId}\`](${r.url})`),
  ].join("\n");
}

export interface DocsInput {
  readme: string;
  blog: string;
  summary: SummaryFile;
  proof: ProofFile | null;
  links: Links;
}

export function renderDocs({ readme, blog, summary, proof, links }: DocsInput): { readme: string; blog: string } {
  let r = fillBlock(readme, "headline", headlineBlock(summary));
  r = fillBlock(r, "links", linksBlock(links));
  r = fillBlock(r, "requirements", requirementsBlock(summary, proof, links));
  r = fillBlock(r, "evidence", evidenceBlock(summary, proof));
  return { readme: r, blog: fillBlock(blog, "results", resultsTable(summary)) };
}
