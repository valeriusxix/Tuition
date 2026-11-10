import type { ProofFile } from "@tuition/shared";
import { useState } from "react";
import { BlobLink, Check, CopyButton, HexId, KV, LINK, PageTitle, Section, StackTable, Status, type Column } from "../components/ui";
import { useProof, useSummary } from "../lib/data";
import { dateTime, shortBlob } from "../lib/format";

type BlobRow = ProofFile["blobs"]["rows"][number];

const BLOB_COLUMNS: Column<BlobRow>[] = [
  { key: "blob", label: "Blob", title: true, render: (b) => <BlobLink id={b.blobId} /> },
  { key: "kind", label: "Kind", render: (b) => b.kind },
  { key: "ns", label: "Namespace", hideOnCard: true, render: (b) => <span className="font-mono text-xs text-paper-2">{b.namespace.replace(/^tuition\./, "")}</span> },
  { key: "status", label: "HTTP", align: "right", render: (b) => b.status ?? "failed" },
  { key: "bytes", label: "Bytes", align: "right", render: (b) => b.bytes?.toLocaleString("en-GB") ?? "–" },
  {
    key: "sha",
    label: "sha256",
    render: (b) => (b.sha256 ? <span className="font-mono text-xs break-all text-paper-2">{b.sha256}</span> : "–"),
  },
];

/** Namespaces grouped by what they belong to: the headline run, the first official run, live, tuning, smoke. */
function groupNamespaces(byNamespace: Record<string, number>, runId: string, otherRunId: string | null) {
  const groups: { title: string; rows: [string, number][] }[] = [
    { title: "Headline run", rows: [] },
    { title: "First official run", rows: [] },
    { title: "Live job", rows: [] },
    { title: "Tuning and dev runs", rows: [] },
    { title: "Other", rows: [] },
  ];
  for (const [ns, n] of Object.entries(byNamespace).sort(([a], [b]) => a.localeCompare(b))) {
    const g = ns.includes(runId) ? 0 : otherRunId && ns.includes(otherRunId) ? 1 : ns.startsWith("tuition.live.") ? 2 : /^tuition\.r-/.test(ns) ? 3 : 4;
    groups[g]!.rows.push([ns, n]);
  }
  return groups.filter((g) => g.rows.length > 0);
}

const Code = ({ children }: { children: string }) => (
  <div className="relative mt-2">
    <pre className="overflow-x-auto rounded-sm border border-rule bg-ink-2 p-3 pr-20 font-mono text-xs leading-relaxed text-paper">{children}</pre>
    <span className="absolute top-2 right-2">
      <CopyButton text={children} />
    </span>
  </div>
);

export default function Verify() {
  const proof = useProof();
  const summary = useSummary();
  const [showAll, setShowAll] = useState(false);
  if (proof.state !== "ready") return <Status results={[proof]} />;
  const p = proof.data;
  const otherRunId = summary.state === "ready" ? (summary.data.otherRun?.runId ?? null) : null;
  const groups = groupNamespaces(p.counts.byNamespace, p.runId, otherRunId);
  const graphql = `curl -s ${p.account.endpoint} \\
  -H 'x-api-key: <your Tatum API key>' -H 'content-type: application/json' \\
  -d '{"query":"query($id:SuiAddress!){object(address:$id){version digest asMoveObject{contents{type{repr} json}}}}","variables":{"id":"${p.accountId}"}}'`;
  const sample = p.blobs.rows[0];
  const shown = showAll ? p.blobs.rows : p.blobs.rows.slice(0, 12);
  const allOk = p.account.delegateKeyFound && p.blobs.failed === 0 && p.recall.matched === p.recall.checked;

  return (
    <>
      <PageTitle title="Verify it yourself">
        These checks ran against mainnet on {dateTime(p.generatedAt)}. Nothing here relies on our servers, because there are none: the account object is on Sui, read
        through Tatum, and the memories are blobs on Walrus.
      </PageTitle>

      <section aria-labelledby="checks">
        <h2 id="checks" className="display text-2xl">
          {allOk ? "Three checks, all passing" : "Three checks"}
        </h2>
        <ul className="mt-3 max-w-2xl">
          <Check ok={p.account.delegateKeyFound}>
            The agent's public key is registered on the Walrus Memory account object, read through Tatum's Sui gateway
            {p.account.delegateKeyEncoding ? ` (stored as ${p.account.delegateKeyEncoding})` : ""}.
          </Check>
          <Check ok={p.blobs.failed === 0}>
            {p.blobs.ok} of {p.blobs.checked} blobs from the headline run and the live job returned HTTP 200 from the Walrus aggregator, {p.blobs.totalBytes.toLocaleString("en-GB")} bytes in
            all.
          </Check>
          <Check ok={p.recall.matched === p.recall.checked}>
            {p.recall.matched} of {p.recall.checked} random lessons came back first when recalled from the relayer by their own text.
          </Check>
        </ul>
      </section>

      <Section title="Account object, via Tatum">
        <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
          <div>
            <p className="text-sm text-paper-2">Account object ID</p>
            <p className="mt-1">
              <HexId id={p.accountId} href={p.account.explorerUrl} />
            </p>
            <p className="mt-1 text-sm text-paper-2">
              Opens on Suiscan. This is the account the engine is configured to write to; the ID is on the submission form.
            </p>
            <p className="mt-5 text-sm text-paper-2">Agent ID (delegate public key)</p>
            <p className="mt-1">
              <HexId id={p.agentId} />
            </p>
            <p className="mt-1 text-sm text-paper-2">
              The agent ID on the submission form. {p.account.delegateKeyFound ? "Found on the object above." : "Not found on the object."}
            </p>
          </div>
          <dl>
            <KV label="Type" mono={false}>
              <span className="font-mono text-xs">{p.account.type.replace(/^0x[0-9a-f]+::/, "…::")}</span>
            </KV>
            <KV label="Version">{p.account.version}</KV>
            <KV label="Digest">{p.account.digest}</KV>
            <KV label="Ownership" mono={false}>
              {p.account.owner}
            </KV>
            {p.account.accountOwner && <KV label="Account owner">{shortBlob(p.account.accountOwner)}</KV>}
            <KV label="Read through" mono={false}>
              {p.account.source}
            </KV>
            <KV label="Relayer health" mono={false}>
              {String(p.relayer.health.status)}, {dateTime(p.relayer.checkedAt)}
            </KV>
          </dl>
        </div>
      </Section>

      <Section title="Memories on mainnet" aside={`${p.counts.total.toLocaleString("en-GB")} in all, from the committed ledgers`}>
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="mb-1 text-paper">{g.title}</h3>
              <dl>
                {g.rows.map(([ns, n]) => (
                  <KV key={ns} label={ns.replace(/^tuition\./, "")}>
                    {n.toLocaleString("en-GB")}
                  </KV>
                ))}
              </dl>
            </div>
          ))}
          <div>
            <h3 className="mb-1 text-paper">By kind</h3>
            <dl>
              {Object.entries(p.counts.byKind)
                .sort(([, a], [, b]) => b - a)
                .map(([k, n]) => (
                  <KV key={k} label={k}>
                    {n.toLocaleString("en-GB")}
                  </KV>
                ))}
            </dl>
          </div>
        </div>
        <p className="mt-6 text-sm text-paper-2">Namespaces are shown without the shared "tuition." prefix. Tuning and dev runs are included in the total: nothing written to mainnet is left out.</p>
      </Section>

      <Section title="Recall round-trip">
        <p className="mb-3 max-w-2xl text-paper-2">Each lesson below was recalled from the relayer using its own body as the query. A pass means the same blob came back first.</p>
        <ul>
          {p.recall.rows.map((r) => (
            <Check key={r.blobId} ok={r.matched}>
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                <BlobLink id={r.blobId} />
                <span className="text-sm text-paper-2">
                  {r.questionId}, distance <span className="font-mono">{r.distance?.toFixed(3) ?? "–"}</span>
                </span>
              </span>
            </Check>
          ))}
        </ul>
      </Section>

      <Section title="Do it yourself">
        <ol className="max-w-3xl space-y-6 text-paper-2">
          <li className="flex gap-4">
            <span className="display shrink-0 text-2xl text-pen">1</span>
            <div className="min-w-0 flex-1">
              Read the account object with a free Tatum key and find the agent key in its <code className="font-mono text-paper">delegate_keys</code>:
              <Code>{graphql}</Code>
            </div>
          </li>
          {sample && (
            <li className="flex gap-4">
              <span className="display shrink-0 text-2xl text-pen">2</span>
              <div className="min-w-0 flex-1">
                Fetch any blob and compare its hash with the table below. The content is encrypted, so you will see bytes, not text:
                <Code>{`curl -s ${sample.url} | sha256sum`}</Code>
                <p className="mt-2 text-sm">
                  Expected: <span className="font-mono text-xs break-all text-paper">{sample.sha256 ?? "–"}</span>
                </p>
              </div>
            </li>
          )}
          <li className="flex gap-4">
            <span className="display shrink-0 text-2xl text-pen">3</span>
            <div className="min-w-0 flex-1">
              Repeat every check from the repository: <code className="font-mono text-paper">engine/state</code> holds each forecast and ledger, and{" "}
              <code className="font-mono text-paper">npm run engine -- verify --run {p.runId}</code> regenerates this page's data.
            </div>
          </li>
        </ol>
      </Section>

      <Section title={`${p.blobs.checked} checked blobs`} aside={<a className={LINK} href={p.blobs.aggregator}>{p.blobs.aggregator.replace(/^https?:\/\//, "")}</a>}>
        <StackTable columns={BLOB_COLUMNS} rows={shown} rowKey={(b) => b.blobId} />
        {p.blobs.rows.length > shown.length && (
          <button type="button" onClick={() => setShowAll(true)} className="mt-4 h-11 rounded-sm border border-rule-2 px-4 text-sm text-paper hover:border-paper-2">
            Show all {p.blobs.rows.length} blobs
          </button>
        )}
      </Section>
    </>
  );
}
