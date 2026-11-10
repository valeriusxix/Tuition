import type { LiveFile, LiveForecastRow } from "@tuition/shared";
import { BlobLink, PageTitle, Section, StackTable, Stat, Status, type Column } from "../components/ui";
import { useLive } from "../lib/data";
import { dateTime, num, shortDate } from "../lib/format";

const BASE: Column<LiveForecastRow>[] = [
  { key: "q", label: "Forecast", title: true, render: (r) => `${r.symbol} ${r.type}, ${shortDate(r.decisionDate)}` },
  { key: "p", label: "P(yes)", align: "right", render: (r) => r.p.toFixed(2) },
];
const COMMIT: Column<LiveForecastRow>[] = [
  { key: "recalled", label: "Recalled", align: "right", render: (r) => String(r.recalledBlobIds.length) },
  { key: "committed", label: "Committed", render: (r) => <span className="font-mono text-xs">{dateTime(r.committedAt)}</span> },
  { key: "blob", label: "Blob", render: (r) => <BlobLink id={r.blobId} /> },
];
const PENDING_COLUMNS: Column<LiveForecastRow>[] = [...BASE, { key: "resolves", label: "Resolves", render: (r) => shortDate(r.resolveDate) }, ...COMMIT];
const RESOLVED_COLUMNS: Column<LiveForecastRow>[] = [
  ...BASE,
  { key: "outcome", label: "Outcome", render: (r) => (r.outcome === undefined ? "–" : r.outcome === 1 ? "Yes" : "No") },
  { key: "brier", label: "Brier", align: "right", render: (r) => (r.brier === undefined ? "–" : r.brier.toFixed(3)) },
  ...COMMIT,
];

function byDecision(rows: LiveForecastRow[]): [string, LiveForecastRow[]][] {
  const groups = new Map<string, LiveForecastRow[]>();
  for (const r of rows) groups.set(r.decisionDate, [...(groups.get(r.decisionDate) ?? []), r]);
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
}

function Pending({ data }: { data: LiveFile }) {
  const [latest, ...older] = byDecision(data.pending);
  if (!latest) return <p className="text-paper-2">No forecasts are waiting on an outcome.</p>;
  return (
    <>
      <p className="mb-3 text-sm text-paper-2">
        Decision day {latest[0]}, {latest[1].length} forecasts
      </p>
      <StackTable columns={PENDING_COLUMNS} rows={latest[1]} rowKey={(r) => r.questionId} />
      {older.map(([date, rows]) => (
        <details key={date} className="mt-3 text-paper-2">
          <summary className="cursor-pointer py-2 text-sm hover:text-paper">
            Decision day {date}, {rows.length} forecasts
          </summary>
          <div className="mt-2">
            <StackTable columns={PENDING_COLUMNS} rows={rows} rowKey={(r) => r.questionId} />
          </div>
        </details>
      ))}
    </>
  );
}

/** Facts about the job's timing, read from the file rather than typed by hand. */
function timing(all: LiveForecastRow[]) {
  const hours = all.map((r) => new Date(r.committedAt).getUTCHours() + new Date(r.committedAt).getUTCMinutes() / 60);
  const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const firstRecall = all
    .filter((r) => r.recalledBlobIds.length > 0)
    .map((r) => r.decisionDate)
    .sort()[0];
  const withoutRecall = all.filter((r) => r.recalledBlobIds.length === 0).length;
  const cleanCut = firstRecall !== undefined && all.every((r) => (r.decisionDate >= firstRecall) === r.recalledBlobIds.length > 0);
  return {
    earliest: hours.length ? fmt(Math.min(...hours)) : null,
    latest: hours.length ? fmt(Math.max(...hours)) : null,
    firstRecall,
    withoutRecall,
    cleanCut,
  };
}

export default function Live() {
  const live = useLive();
  if (live.state !== "ready") return <Status results={[live]} />;
  const d = live.data;
  const all = [...d.pending, ...d.resolved];
  const t = timing(all);
  const resolved = [...d.resolved].sort((a, b) => b.decisionDate.localeCompare(a.decisionDate) || a.questionId.localeCompare(b.questionId));

  return (
    <>
      <PageTitle title="Live forecasts">
        Each day the agent writes its forecasts to Walrus Memory before their 7-day outcomes are known, so they cannot be edited afterwards. The blob is the
        commitment; the outcome arrives a week later. Updated {dateTime(d.generatedAt)}.
      </PageTitle>

      {all.length === 0 ? (
        <p className="text-paper-2">The live job has not published any forecasts yet.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-3">
          <Stat
            label="Waiting on an outcome"
            value={String(d.metrics.pending)}
            note={d.latestDecisionDate ? `Latest decision day ${shortDate(d.latestDecisionDate)}` : undefined}
          />
          <Stat label="Resolved" value={String(d.metrics.resolved)} note={`${all.length - t.withoutRecall} of ${all.length} forecasts recalled lessons`} />
          <Stat
            label="Live Brier so far"
            value={d.metrics.brier === null ? "–" : num(d.metrics.brier)}
            note={d.metrics.brier === null ? "Nothing has resolved yet" : `On ${d.metrics.resolved} resolved forecasts; a coin flip scores 0.250`}
          />
        </div>
      )}

      <Section title="Committed, outcome unknown">
        <Pending data={d} />
      </Section>

      <Section title="Resolved">
        {resolved.length > 0 ? (
          <StackTable columns={RESOLVED_COLUMNS} rows={resolved} rowKey={(r) => r.questionId} />
        ) : (
          <p className="text-paper-2">None yet. The first forecasts resolve seven days after their decision day.</p>
        )}
      </Section>

      {all.length > 0 && (
        <Section title="Read this before trusting the timing">
          <ul className="max-w-3xl list-disc space-y-2 pl-5 text-paper-2">
            <li>
              Each forecast uses the last closed daily candle, so the decision day ends at 00:00 UTC. The commitments in this file were written between{" "}
              <span className="font-mono text-paper">{t.earliest}</span> and <span className="font-mono text-paper">{t.latest}</span> UTC, some hours into the
              first of the seven days. The model does not see those hours, and the commit time is shown for every forecast.
            </li>
            {t.firstRecall && t.cleanCut ? (
              <li>
                The {t.withoutRecall} forecasts with a decision day before {shortDate(t.firstRecall)} recalled no memories at all; every forecast from that day
                onward recalled lessons from the replay. The "Recalled" column shows the count for each row.
              </li>
            ) : t.firstRecall ? (
              <li>
                {t.withoutRecall} of {all.length} forecasts recalled no memories; the rest recalled lessons from the replay. The "Recalled" column shows the count
                for each row.
              </li>
            ) : (
              <li>None of these forecasts recalled a memory, so they are plain no-memory forecasts.</li>
            )}
          </ul>
        </Section>
      )}
    </>
  );
}
