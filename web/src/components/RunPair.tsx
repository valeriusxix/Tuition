import type { Comparison, SummaryFile } from "@tuition/shared";
import { num, signed } from "../lib/format";
import { StackTable, type Column } from "./ui";

interface Row {
  label: string;
  note: string;
  runId: string;
  h: Comparison | null;
}

const COLUMNS: Column<Row>[] = [
  {
    key: "run",
    label: "Test split",
    title: true,
    render: (r) => (
      <>
        {r.label} <span className="text-paper-2">({r.note})</span>
        <br />
        <span className="font-mono text-xs text-paper-2">{r.runId}</span>
      </>
    ),
  },
  { key: "off", label: "OFF", align: "right", render: (r) => (r.h ? num(r.h.referenceBrier) : "–") },
  { key: "on", label: "ON", align: "right", render: (r) => (r.h ? num(r.h.candidateBrier) : "–") },
  { key: "d", label: "Change", align: "right", render: (r) => (r.h ? signed(r.h.meanDelta) : "–") },
  { key: "ci", label: "95% CI", align: "right", render: (r) => (r.h ? `${signed(r.h.ci95[0])} to ${signed(r.h.ci95[1])}` : "–") },
];

/** D51: the corrected rerun and the first official run, side by side. Renders nothing without a pair. */
export function RunPair({ summary: s }: { summary: SummaryFile }) {
  const o = s.otherRun;
  if (!o || !s.headline) return null;
  const cu = s.calibrationUse;
  const ou = o.calibrationUse;
  const rows: Row[] = [
    { label: "Rerun, calibration fixed", note: "headline", runId: s.runId, h: s.headline },
    { label: "First run, calibration frozen", note: "kept for the record", runId: o.runId, h: o.headline },
  ];
  return (
    <div className="max-w-3xl">
      <p className="text-paper-2">
        The first official run had a bug. Its memory arm asked for the newest calibration snapshot in a way that only searched the few closest matches,
        so {ou.frozenFrom ? <>from {ou.frozenFrom} on </> : null}it kept getting an old one: {ou.staleWeeks} of {ou.weeks} weeks were stale, and only {ou.used} of{" "}
        {ou.written} snapshots ever reached a prompt. The rerun fixes only that, and was pre-registered before it started (DECISIONS D51)
        {cu ? (
          <>
            : {cu.weeks - cu.staleWeeks} of {cu.weeks} weeks got the newest snapshot
          </>
        ) : null}
        . Both runs are published, whichever way they landed.
      </p>
      <div className="mt-4">
        <StackTable columns={COLUMNS} rows={rows} rowKey={(r) => r.runId} />
      </div>
      <p className="mt-3 text-sm text-paper-2">Change is Brier OFF minus ON: positive means memory scored better. The rerun also redrew the model's noise in every arm.</p>
    </div>
  );
}
