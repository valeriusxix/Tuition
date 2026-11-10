import type { Arm, ArmMetricsRow, ReliabilityFile, SummaryFile } from "@tuition/shared";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { PageTitle, Section, StackTable, Stat, Status, type Column } from "../components/ui";
import { AXIS_TICK, INK, LABEL, Legend, SERIES, TooltipBox, useMedia } from "../lib/charts";
import { useReliability, useSummary } from "../lib/data";
import { ARM_LABEL, num, signed } from "../lib/format";

type Bin = { meanP: number; freqY: number; n: number; arm: string };

function Diagram({ data }: { data: ReliabilityFile }) {
  const phone = useMedia("(max-width: 639px)");
  const rows = (arm: "mem" | "nomem", label: string): Bin[] => (data.arms[arm]?.test?.bins ?? []).map((b) => ({ ...b, arm: label }));
  const on = rows("mem", ARM_LABEL.mem);
  const off = rows("nomem", ARM_LABEL.nomem);
  if (on.length === 0 && off.length === 0) return <p className="text-paper-2">The reliability file has no test-split bins to draw.</p>;
  const tick = phone ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  return (
    <figure>
      <div className="mb-3">
        <Legend
          items={[
            { label: "Memory ON", color: SERIES.on },
            { label: "Memory OFF", color: SERIES.off },
            { label: "Perfect calibration", color: SERIES.neutral, dotted: true },
          ]}
        />
      </div>
      <div className="aspect-square max-w-md">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis
              type="number"
              dataKey="meanP"
              domain={[0, 1]}
              ticks={tick}
              tick={AXIS_TICK}
              tickLine={false}
              stroke={INK.grid}
              label={{ value: "Forecast probability", position: "bottom", offset: 4, ...LABEL }}
            />
            <YAxis
              type="number"
              dataKey="freqY"
              domain={[0, 1]}
              ticks={tick}
              tick={AXIS_TICK}
              tickLine={false}
              width={44}
              stroke={INK.grid}
              label={{ value: "How often it happened", angle: -90, position: "insideLeft", offset: 12, ...LABEL, style: { textAnchor: "middle" } }}
            />
            <ZAxis type="number" dataKey="n" range={[40, 240]} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={SERIES.neutral} strokeDasharray="2 4" />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as Bin | undefined;
                return active && r ? (
                  <TooltipBox
                    title={r.arm}
                    rows={[
                      { label: "Forecast", value: r.meanP.toFixed(2) },
                      { label: "Happened", value: r.freqY.toFixed(2) },
                      { label: "Questions", value: String(r.n) },
                    ]}
                  />
                ) : null;
              }}
            />
            <Scatter name={ARM_LABEL.nomem} data={off} fill={SERIES.off} line={{ stroke: SERIES.off, strokeWidth: 2 }} isAnimationActive={false} />
            <Scatter name={ARM_LABEL.mem} data={on} fill={SERIES.on} line={{ stroke: SERIES.on, strokeWidth: 2.5 }} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 max-w-md text-sm text-paper-2">
        Test split, ten equal bins. A point on the dotted diagonal is perfectly calibrated. Larger dots hold more questions; small bins are noisy.
      </figcaption>
      <details className="mt-2 text-sm text-paper-2">
        <summary className="cursor-pointer py-2 hover:text-paper">Show as a table</summary>
        <table className="mt-2 font-mono text-xs">
          <thead>
            <tr className="text-paper-2">
              <th className="pr-4 text-left font-normal">Arm</th>
              <th className="pr-4 text-right font-normal">Forecast</th>
              <th className="pr-4 text-right font-normal">Happened</th>
              <th className="text-right font-normal">n</th>
            </tr>
          </thead>
          <tbody className="text-paper">
            {[...on, ...off].map((r) => (
              <tr key={`${r.arm}-${r.meanP}`}>
                <td className="pr-4">{r.arm}</td>
                <td className="pr-4 text-right">{r.meanP.toFixed(2)}</td>
                <td className="pr-4 text-right">{r.freqY.toFixed(2)}</td>
                <td className="text-right">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

type MetricRow = { arm: Arm; type: string; m: ArmMetricsRow };

const METRIC_COLUMNS: Column<MetricRow>[] = [
  { key: "arm", label: "Arm", title: true, render: (r) => `${ARM_LABEL[r.arm]}, ${r.type === "all" ? "all questions" : r.type}` },
  { key: "n", label: "n", align: "right", render: (r) => r.m.n },
  { key: "brier", label: "Brier", align: "right", render: (r) => num(r.m.brier) },
  { key: "ll", label: "Log loss", align: "right", render: (r) => num(r.m.logLoss) },
  { key: "acc", label: "Accuracy", align: "right", render: (r) => num(r.m.accuracy, 2) },
  { key: "ece", label: "ECE", align: "right", render: (r) => num(r.m.ece) },
  { key: "skill", label: "Skill vs base", align: "right", render: (r) => (r.m.skillVsBase === null ? "–" : signed(r.m.skillVsBase, 3)) },
];

function metricRows(s: SummaryFile): MetricRow[] {
  return s.arms.flatMap((arm) =>
    (["all", "DIRECTION", "BREAKOUT"] as const).flatMap((type) => {
      const m = s.metrics[arm]?.test?.[type];
      return m ? [{ arm, type, m }] : [];
    }),
  );
}

export default function Calibration() {
  const summary = useSummary();
  const reliability = useReliability();
  if (summary.state !== "ready" || reliability.state !== "ready") return <Status results={[summary, reliability]} />;
  const s = summary.data;
  const rel = reliability.data;
  const eceOn = rel.arms.mem?.test?.ece;
  const eceOff = rel.arms.nomem?.test?.ece;
  const nTest = rel.arms.mem?.test?.n ?? rel.arms.nomem?.test?.n;
  const rows = metricRows(s);
  const eceNote =
    eceOn === undefined || eceOff === undefined
      ? undefined
      : eceOn < eceOff
        ? `${num(eceOff - eceOn)} lower than OFF: better calibrated`
        : eceOn > eceOff
          ? `${num(eceOn - eceOff)} higher than OFF: worse calibrated`
          : "Same as OFF";

  return (
    <>
      <PageTitle title="Calibration">
        When the agent says 70%, does it happen 70% of the time? Brier rewards being right; calibration asks whether the confidence was honest.
      </PageTitle>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <Diagram data={rel} />
        <div className="grid content-start gap-6 sm:grid-cols-2 lg:grid-cols-1">
          {eceOff !== undefined && (
            <Stat label="Calibration error, memory OFF" value={num(eceOff)} note={nTest ? `Expected calibration error on ${nTest} test questions` : undefined} />
          )}
          {eceOn !== undefined && <Stat label="Calibration error, memory ON" value={num(eceOn)} note={eceNote} />}
          {eceOn === undefined && eceOff === undefined && <p className="text-paper-2">No calibration error is published for the test split.</p>}
        </div>
      </div>

      <Section title="Scores on the test split">
        {rows.length === 0 ? (
          <p className="text-paper-2">The summary has no test-split metrics to show.</p>
        ) : (
          <StackTable columns={METRIC_COLUMNS} rows={rows} rowKey={(r) => `${r.arm}-${r.type}`} />
        )}
        <p className="mt-4 max-w-2xl text-sm text-paper-2">
          Lower is better for Brier, log loss and ECE; higher for accuracy at 0.5 and for skill, which is 1 − Brier(arm)/Brier(base rate). ECE is the expected
          calibration error over ten equal-width bins.
        </p>
      </Section>
    </>
  );
}
