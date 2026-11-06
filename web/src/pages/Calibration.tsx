import type { ArmMetricsRow, ReliabilityFile, SummaryFile } from "@tuition/shared";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { PageTitle, Section, Status, TableWrap, TD, TDN, TH, THN } from "../components/ui";
import { AXIS_TICK, INK, Legend, SERIES, TooltipBox } from "../lib/charts";
import { useReliability, useSummary } from "../lib/data";
import { ARM_LABEL, num, signed } from "../lib/format";

type Row = { meanP: number; freqY: number; n: number; arm: string };

function Diagram({ data }: { data: ReliabilityFile }) {
  const rows = (arm: "mem" | "nomem", label: string): Row[] => (data.arms[arm]?.test?.bins ?? []).map((b) => ({ ...b, arm: label }));
  const on = rows("mem", "Memory ON");
  const off = rows("nomem", "Memory OFF");
  const tick = [0, 0.25, 0.5, 0.75, 1];
  return (
    <figure>
      <div className="mb-3">
        <Legend
          items={[
            { label: "Memory ON", color: SERIES.on },
            { label: "Memory OFF", color: SERIES.off },
            { label: "Perfect calibration", color: SERIES.neutral, dashed: true },
          ]}
        />
      </div>
      <div className="mx-auto aspect-square max-w-md">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis type="number" dataKey="meanP" domain={[0, 1]} ticks={tick} tick={AXIS_TICK} stroke={INK.grid} label={{ value: "Forecast probability", position: "bottom", fill: INK.axis, fontSize: 12 }} />
            <YAxis type="number" dataKey="freqY" domain={[0, 1]} ticks={tick} tick={AXIS_TICK} width={44} stroke={INK.grid} label={{ value: "How often it happened", angle: -90, position: "insideLeft", fill: INK.axis, fontSize: 12, style: { textAnchor: "middle" } }} />
            <ZAxis type="number" dataKey="n" range={[50, 260]} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={SERIES.neutral} strokeDasharray="4 4" />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as Row | undefined;
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
            <Scatter name="Memory OFF" data={off} fill={SERIES.off} line={{ stroke: SERIES.off, strokeWidth: 2 }} isAnimationActive={false} />
            <Scatter name="Memory ON" data={on} fill={SERIES.on} line={{ stroke: SERIES.on, strokeWidth: 2 }} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-neutral-400">
        Test split. Points on the diagonal are perfectly calibrated. Larger dots hold more questions; small bins are noisy.
      </figcaption>
      <details className="mt-2 text-sm text-neutral-300">
        <summary className="cursor-pointer text-neutral-400">Show as a table</summary>
        <table className="mt-2 font-mono text-xs">
          <thead>
            <tr>
              <th className="pr-4 text-left font-normal">Arm</th>
              <th className="pr-4 text-right font-normal">Forecast</th>
              <th className="pr-4 text-right font-normal">Happened</th>
              <th className="text-right font-normal">n</th>
            </tr>
          </thead>
          <tbody>
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

function MetricsTable({ s }: { s: SummaryFile }) {
  const rows: { arm: (typeof s.arms)[number]; type: string; m: ArmMetricsRow }[] = s.arms.flatMap((arm) =>
    (["all", "DIRECTION", "BREAKOUT"] as const).flatMap((type) => {
      const m = s.metrics[arm]?.test?.[type];
      return m ? [{ arm, type, m }] : [];
    }),
  );
  return (
    <TableWrap>
      <table className="w-full text-sm">
        <thead className="bg-neutral-900">
          <tr>
            <th className={TH}>Arm</th>
            <th className={TH}>Type</th>
            <th className={THN}>n</th>
            <th className={THN}>Brier</th>
            <th className={THN}>Log loss</th>
            <th className={THN}>Accuracy</th>
            <th className={THN}>ECE</th>
            <th className={THN}>Skill vs base</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ arm, type, m }) => (
            <tr key={`${arm}-${type}`} className="border-t border-neutral-800">
              <td className={TD}>{ARM_LABEL[arm]}</td>
              <td className={TD}>{type === "all" ? "All" : type}</td>
              <td className={TDN}>{m.n}</td>
              <td className={TDN}>{num(m.brier)}</td>
              <td className={TDN}>{num(m.logLoss)}</td>
              <td className={TDN}>{num(m.accuracy)}</td>
              <td className={TDN}>{num(m.ece)}</td>
              <td className={TDN}>{m.skillVsBase === null ? "-" : signed(m.skillVsBase, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export default function Calibration() {
  const summary = useSummary();
  const reliability = useReliability();
  if (summary.state !== "ready" || reliability.state !== "ready") return <Status results={[summary, reliability]} />;
  return (
    <>
      <PageTitle title="Calibration">When the agent says 70%, does it happen 70% of the time?</PageTitle>
      <Diagram data={reliability.data} />
      <Section title="Scores on the test split">
        <MetricsTable s={summary.data} />
        <p className="mt-2 text-sm text-neutral-400">ECE is expected calibration error over 10 equal bins. Lower is better for Brier, log loss and ECE.</p>
      </Section>
    </>
  );
}
