import type { ReactNode } from "react";
import { BlobLink, PageTitle, Section, Status, TableWrap, TD, TDN, TH, THN } from "../components/ui";
import { useProof } from "../lib/data";
import { dateTime } from "../lib/format";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-neutral-800 py-2 first:border-t-0 sm:grid sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-sm text-neutral-400">{label}</dt>
      <dd className="font-mono text-sm break-all text-neutral-200">{children}</dd>
    </div>
  );
}

const Check = ({ ok, children }: { ok: boolean; children: ReactNode }) => (
  <li className="flex gap-2">
    <span className={`font-mono ${ok ? "text-accent" : "text-red-300"}`}>{ok ? "PASS" : "FAIL"}</span>
    <span className="text-neutral-200">{children}</span>
  </li>
);

export default function Verify() {
  const proof = useProof();
  if (proof.state !== "ready") return <Status results={[proof]} />;
  const p = proof.data;
  const graphql = `curl -s ${p.account.endpoint} \\
  -H 'x-api-key: YOUR_API_KEY' -H 'content-type: application/json' \\
  -d '{"query":"query($id:SuiAddress!){object(address:$id){version digest asMoveObject{contents{type{repr} json}}}}","variables":{"id":"${p.accountId}"}}'`;
  const sample = p.blobs.rows[0];
  return (
    <>
      <PageTitle title="Verify it yourself">
        These checks ran against mainnet on {dateTime(p.generatedAt)}. Nothing here relies on our servers, because there are none: the account is on Sui and the blobs are on Walrus.
      </PageTitle>

      <ul className="space-y-1">
        <Check ok={p.account.delegateKeyFound}>The agent's key is registered on the account object, read through Tatum's Sui gateway.</Check>
        <Check ok={p.blobs.failed === 0}>
          {p.blobs.ok} of {p.blobs.checked} blobs returned HTTP 200 from the Walrus aggregator.
        </Check>
        <Check ok={p.recall.matched === p.recall.checked}>
          {p.recall.matched} of {p.recall.checked} random lessons came back first when recalled by their own text.
        </Check>
      </ul>

      <Section title="Account object, via Tatum">
        <dl>
          <Row label="Agent ID (public key)">{p.agentId}</Row>
          <Row label="Account object ID">
            <a className="text-accent underline-offset-2 hover:underline" href={p.account.explorerUrl}>
              {p.accountId}
            </a>
          </Row>
          <Row label="Type">{p.account.type}</Row>
          <Row label="Version">{p.account.version}</Row>
          <Row label="Digest">{p.account.digest}</Row>
          <Row label="Object ownership">{p.account.owner}</Row>
          <Row label="Account owner">{p.account.accountOwner ?? "-"}</Row>
          <Row label="Delegate key on object">{p.account.delegateKeyFound ? `Yes (${p.account.delegateKeyEncoding})` : "No"}</Row>
          <Row label="Read through">
            {p.account.source}, {p.account.endpoint}
          </Row>
        </dl>
      </Section>

      <Section title="Relayer">
        <dl>
          <Row label="URL">{p.relayer.url}</Row>
          <Row label="Health">{String(p.relayer.health.status)}</Row>
          <Row label="Checked">{dateTime(p.relayer.checkedAt)}</Row>
        </dl>
      </Section>

      <Section title="Memories on mainnet">
        <p className="mb-3 text-neutral-300">
          {p.counts.total} memories across every run, from the committed ledgers. This includes tuning, smoke-test and live memories.
        </p>
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="bg-neutral-900">
              <tr>
                <th className={TH}>Namespace</th>
                <th className={THN}>Memories</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(p.counts.byNamespace)
                .sort(([, a], [, b]) => b - a)
                .map(([ns, n]) => (
                  <tr key={ns} className="border-t border-neutral-800">
                    <td className={`${TD} font-mono`}>{ns}</td>
                    <td className={TDN}>{n}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Recall round-trip">
        <ul className="space-y-1 text-sm">
          {p.recall.rows.map((r) => (
            <li key={r.blobId} className="flex flex-wrap items-center gap-2 text-neutral-300">
              <span className="font-mono">{r.matched ? "same blob" : "different blob"}</span>
              <BlobLink id={r.blobId} />
              <span className="font-mono">distance {r.distance?.toFixed(3) ?? "-"}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Do it yourself">
        <ol className="list-decimal space-y-4 pl-5 text-neutral-300">
          <li>
            Read the account object with a free Tatum key, then find the delegate key in its <code className="font-mono">delegate_keys</code>:
            <pre className="mt-2 overflow-x-auto rounded border border-neutral-800 p-3 font-mono text-xs text-neutral-200">{graphql}</pre>
          </li>
          {sample && (
            <li>
              Fetch any blob and compare its hash with the table below. The content is encrypted, so you will see bytes, not text:
              <pre className="mt-2 overflow-x-auto rounded border border-neutral-800 p-3 font-mono text-xs text-neutral-200">{`curl -s ${sample.url} | sha256sum`}</pre>
            </li>
          )}
          <li>
            The run itself is reproducible from the repository: <code className="font-mono">engine/state</code> holds every forecast and ledger, and{" "}
            <code className="font-mono">npm run engine -- verify --run {p.runId}</code> repeats these checks.
          </li>
        </ol>
      </Section>

      <Section title={`All ${p.blobs.checked} checked blobs`}>
        <details>
          <summary className="cursor-pointer text-sm text-neutral-300">Show the official run's and live blobs, with hashes</summary>
          <div className="mt-3">
            <TableWrap>
              <table className="w-full text-sm">
                <thead className="bg-neutral-900">
                  <tr>
                    <th className={TH}>Kind</th>
                    <th className={TH}>Blob</th>
                    <th className={THN}>Status</th>
                    <th className={THN}>Bytes</th>
                    <th className={TH}>sha256</th>
                  </tr>
                </thead>
                <tbody>
                  {p.blobs.rows.map((b) => (
                    <tr key={b.blobId} className="border-t border-neutral-800">
                      <td className={TD}>{b.kind}</td>
                      <td className={TD}>
                        <BlobLink id={b.blobId} />
                      </td>
                      <td className={TDN}>{b.status ?? "failed"}</td>
                      <td className={TDN}>{b.bytes ?? "-"}</td>
                      <td className={`${TD} font-mono text-xs`}>{b.sha256 ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        </details>
      </Section>
    </>
  );
}
