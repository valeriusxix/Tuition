import type { Comparison, SummaryFile } from "@tuition/shared";
import { num, signed } from "../lib/format";

/** D51: the corrected rerun and the first official run, side by side. Renders nothing without a pair. */
export function RunPair({ summary: s }: { summary: SummaryFile }) {
  const o = s.otherRun;
  if (!o || !s.headline) return null;
  const cu = s.calibrationUse;
  const ou = o.calibrationUse;
  const rows: { label: string; note: string; runId: string; h: Comparison | null }[] = [
    { label: "Rerun, calibration fixed", note: "headline", runId: s.runId, h: s.headline },
    { label: "First run, calibration frozen", note: "kept for the record", runId: o.runId, h: o.headline },
  ];
  return (
    <div className="max-w-3xl rounded border border-neutral-800 p-4 text-neutral-200">
      <p className="font-medium text-neutral-100">Two official runs</p>
      <p className="mt-2 text-sm text-neutral-300">
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
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="text-neutral-400">
            <tr>
              <th className="py-1 pr-3 text-left font-normal">Test split</th>
              <th className="py-1 pr-3 text-right font-normal">OFF</th>
              <th className="py-1 pr-3 text-right font-normal">ON</th>
              <th className="py-1 pr-3 text-right font-normal">Change</th>
              <th className="py-1 text-right font-normal">95% CI</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => (
              <tr key={r.runId} className="border-t border-neutral-800">
                <td className="py-1 pr-3 font-sans">
                  {r.label} <span className="text-neutral-400">({r.note})</span>
                  <br />
                  <span className="font-mono text-xs text-neutral-400">{r.runId}</span>
                </td>
                <td className="py-1 pr-3 text-right">{r.h ? num(r.h.referenceBrier) : "-"}</td>
                <td className="py-1 pr-3 text-right">{r.h ? num(r.h.candidateBrier) : "-"}</td>
                <td className="py-1 pr-3 text-right">{r.h ? signed(r.h.meanDelta) : "-"}</td>
                <td className="py-1 text-right whitespace-nowrap">{r.h ? `${signed(r.h.ci95[0])} to ${signed(r.h.ci95[1])}` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-400">Change is Brier OFF minus ON: positive means memory scored better. The rerun also redrew the model's noise in every arm.</p>
    </div>
  );
}
