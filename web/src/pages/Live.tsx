import type { LiveFile, LiveForecastRow } from "@tuition/shared";
import { BlobLink, PageTitle, Section, Stat, Status, TableWrap, TD, TDN, TH, THN } from "../components/ui";
import { useLive } from "../lib/data";
import { dateTime, num } from "../lib/format";

function Rows({ rows }: { rows: LiveForecastRow[] }) {
  return (
    <TableWrap>
      <table className="w-full text-sm">
        <thead className="bg-neutral-900">
          <tr>
            <th className={TH}>Asset</th>
            <th className={TH}>Type</th>
            <th className={THN}>P(yes)</th>
            <th className={TH}>Resolves</th>
            <th className={TH}>Outcome</th>
            <th className={THN}>Brier</th>
            <th className={TH}>Committed</th>
            <th className={TH}>Blob</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.questionId} className="border-t border-neutral-800">
              <td className={TD}>{r.symbol}</td>
              <td className={TD}>{r.type}</td>
              <td className={TDN}>{r.p.toFixed(2)}</td>
              <td className={`${TD} font-mono`}>{r.resolveDate}</td>
              <td className={TD}>{r.outcome === undefined ? "Pending" : r.outcome === 1 ? "Yes" : "No"}</td>
              <td className={TDN}>{r.brier === undefined ? "-" : r.brier.toFixed(3)}</td>
              <td className={TD}>{dateTime(r.committedAt)}</td>
              <td className={TD}>
                <BlobLink id={r.blobId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function byDecision(rows: LiveForecastRow[]): [string, LiveForecastRow[]][] {
  const groups = new Map<string, LiveForecastRow[]>();
  for (const r of rows) groups.set(r.decisionDate, [...(groups.get(r.decisionDate) ?? []), r]);
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
}

function Pending({ data }: { data: LiveFile }) {
  const [latest, ...older] = byDecision(data.pending);
  if (!latest) return <p className="text-neutral-300">No forecasts are waiting on an outcome.</p>;
  return (
    <>
      <p className="mb-2 text-sm text-neutral-400">Decision day {latest[0]}</p>
      <Rows rows={latest[1]} />
      {older.map(([date, rows]) => (
        <details key={date} className="mt-3">
          <summary className="cursor-pointer text-sm text-neutral-300">
            Decision day {date} ({rows.length} forecasts)
          </summary>
          <div className="mt-2">
            <Rows rows={rows} />
          </div>
        </details>
      ))}
    </>
  );
}

export default function Live() {
  const live = useLive();
  if (live.state !== "ready") return <Status results={[live]} />;
  const d = live.data;
  return (
    <>
      <PageTitle title="Live forecasts">
        Each day the agent writes its forecasts to Walrus Memory before their 7-day outcomes are known, so they cannot be edited afterwards. Updated{" "}
        {dateTime(d.generatedAt)}.
      </PageTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Waiting on an outcome" value={String(d.metrics.pending)} />
        <Stat label="Resolved" value={String(d.metrics.resolved)} />
        <Stat label="Live Brier so far" value={d.metrics.brier === null ? "-" : num(d.metrics.brier)} note={d.metrics.brier === null ? "The first forecasts resolve on 8 Nov" : undefined} />
      </div>
      <Section title="Committed, outcome unknown">
        <Pending data={d} />
      </Section>
      <Section title="Resolved">{d.resolved.length > 0 ? <Rows rows={d.resolved} /> : <p className="text-neutral-300">None yet.</p>}</Section>
      <Section title="Read this before trusting the timing">
        <ul className="list-disc space-y-1 pl-5 text-neutral-300">
          <li>
            Each forecast uses the last closed daily candle. The scheduled job usually runs around 06:00 to 07:00 UTC, not just after midnight, so a commitment lands
            some hours into the first of its 7 days. The model does not see those hours, and the commit time is shown for every forecast.
          </li>
          <li>Forecasts with a decision day before 6 Nov did not recall the replay's lessons. Those from 6 Nov onward do.</li>
        </ul>
      </Section>
    </>
  );
}
