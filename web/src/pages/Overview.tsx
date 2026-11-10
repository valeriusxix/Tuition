import { verdict, type Comparison, type CurveFile, type SummaryFile } from "@tuition/shared";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RunPair } from "../components/RunPair";
import { Section, SELECT, Stat, Status } from "../components/ui";
import { AXIS_TICK, INK, Legend, SERIES, TooltipBox } from "../lib/charts";
import { useCurve, useSummary } from "../lib/data";
import { num, percent, shortDate, signed } from "../lib/format";

const find = (s: SummaryFile, id: string, split = "test"): Comparison | undefined => s.comparisons.find((c) => c.id === id && c.split === split);

type Mode = "rolling" | "cumulative";

function LearningCurve({ curve, summary }: { curve: CurveFile; summary: SummaryFile }) {
  const [mode, setMode] = useState<Mode>("rolling");
  const rows = useMemo(() => {
    const on = curve.arms.mem ?? [];
    const off = new Map((curve.arms.nomem ?? []).map((p) => [p.decisionDate, p]));
    const off2 = new Map((curve.arms.nomem2 ?? []).map((p) => [p.decisionDate, p]));
    return on.map((p) => ({ date: p.decisionDate, on: p[mode], off: off.get(p.decisionDate)?.[mode], off2: off2.get(p.decisionDate)?.[mode] }));
  }, [curve, mode]);
  const firstTest = rows.find((r) => r.date > summary.config.devSplitEnd)?.date;
  const values = rows.flatMap((r) => [r.on, r.off ?? r.on, r.off2 ?? r.on]);
  const low = Math.floor(Math.min(...values, 0.25) * 20);
  const high = Math.ceil(Math.max(...values, 0.25) * 20);
  const ticks = Array.from({ length: high - low + 1 }, (_, i) => (low + i) / 20);

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Legend
          items={[
            { label: "Memory ON", color: SERIES.on },
            { label: "Memory OFF", color: SERIES.off },
            { label: "OFF, second pass", color: SERIES.neutral, dashed: true },
          ]}
        />
        <label className="text-sm text-neutral-300">
          <span className="sr-only">Curve type</span>
          <select className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="rolling">Last {curve.window} questions</option>
            <option value="cumulative">All questions so far</option>
          </select>
        </label>
      </div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={shortDate} minTickGap={48} stroke={INK.grid} />
            <YAxis domain={[low / 20, high / 20]} ticks={ticks} tick={AXIS_TICK} width={48} stroke={INK.grid} tickFormatter={(v: number) => v.toFixed(2)} />
            <ReferenceLine y={0.25} stroke={INK.axis} strokeDasharray="2 4" label={{ value: "coin flip", position: "insideBottomRight", fill: INK.axis, fontSize: 12 }} />
            {firstTest && <ReferenceLine x={firstTest} stroke={INK.axis} label={{ value: "test split", position: "insideTopRight", fill: INK.axis, fontSize: 12 }} />}
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={shortDate(String(label))}
                    rows={payload.map((p) => ({ label: String(p.name), value: Number(p.value).toFixed(3), color: String(p.color) }))}
                  />
                ) : null
              }
            />
            <Line dataKey="off2" name="OFF, second pass" stroke={SERIES.neutral} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line dataKey="off" name="Memory OFF" stroke={SERIES.off} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="on" name="Memory ON" stroke={SERIES.on} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-neutral-400">Mean Brier score by decision week. Lower is better; a coin flip scores 0.25.</figcaption>
      <details className="mt-2 text-sm text-neutral-300">
        <summary className="cursor-pointer text-neutral-400">Show as a table</summary>
        <table className="mt-2 font-mono text-xs">
          <thead>
            <tr>
              <th className="pr-4 text-left font-normal">Week</th>
              <th className="pr-4 text-right font-normal">ON</th>
              <th className="pr-4 text-right font-normal">OFF</th>
              <th className="text-right font-normal">OFF 2</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td className="pr-4">{r.date}</td>
                <td className="pr-4 text-right">{r.on.toFixed(3)}</td>
                <td className="pr-4 text-right">{r.off?.toFixed(3)}</td>
                <td className="text-right">{r.off2?.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const STEPS: [string, string][] = [
  ["Forecast", "The agent answers yes/no questions about 7-day crypto moves, seeing only anonymised, rebased data."],
  ["Reflect", "When a forecast misses badly, it writes a short lesson. It also keeps a calibration snapshot."],
  ["Remember", "Lessons go to Walrus Memory on Sui mainnet, written only when the simulated clock reaches the outcome."],
  ["Compare", "The same model answers the same questions with memory off, and the score difference is the result."],
];

export default function Overview() {
  const summary = useSummary();
  const curve = useCurve();
  if (summary.state !== "ready" || curve.state !== "ready") return <Status results={[summary, curve]} />;
  const s = summary.data;
  const h = s.headline;
  if (!h) return <p className="text-neutral-300">The official run has no headline comparison yet.</p>;
  const v = verdict(h);
  const aa = find(s, "nomem2_vs_nomem");
  const vsBase = find(s, "mem_vs_base");

  return (
    <>
      <h1 className="max-w-2xl text-3xl font-semibold text-neutral-50 sm:text-4xl">Same model. Same questions. One remembers.</h1>
      <p className="mt-3 max-w-2xl text-neutral-300">
        Tuition is an AI crypto forecaster that writes lessons from its mistakes to Walrus Memory. This site publishes what those lessons did to
        its score, whatever the answer turned out to be.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Brier, memory OFF" value={num(h.referenceBrier)} note={`${h.n} test questions`} />
        <Stat label="Brier, memory ON" value={num(h.candidateBrier)} note="Lower is better" />
        <Stat
          label="Change with memory"
          value={signed(h.meanDelta)}
          note={
            <>
              <span className="font-mono">
                95% CI {signed(h.ci95[0])} to {signed(h.ci95[1])}
              </span>
              <br />
              {v.label}
            </>
          }
        />
      </div>

      <div className="mt-4 max-w-3xl rounded border border-neutral-800 p-4 text-neutral-200">
        <p>{v.sentence}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-neutral-300">
          <li>
            Memory scored better in {percent(h.shareAboveZero)} of {h.resamples.toLocaleString("en-GB")} bootstrap resamples of the {h.blocks} test weeks.
          </li>
          {aa && (
            <li>
              Two identical no-memory passes differ by <span className="font-mono">{signed(aa.meanDelta)}</span>, so a gap of this size can come from model
              noise alone.
            </li>
          )}
          {vsBase && (
            <li>
              Against a plain trailing base rate with no LLM, memory is <span className="font-mono">{signed(vsBase.meanDelta)}</span> (
              {num(vsBase.candidateBrier)} vs {num(vsBase.referenceBrier)}).
            </li>
          )}
        </ul>
      </div>

      {s.otherRun && (
        <div className="mt-4">
          <RunPair summary={s} />
        </div>
      )}

      <Section title="Learning curve">
        <LearningCurve curve={curve.data} summary={s} />
      </Section>

      <Section title="How it works">
        <ol className="grid gap-3 sm:grid-cols-2">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded border border-neutral-800 p-4">
              <p className="font-medium text-neutral-100">
                <span className="mr-2 font-mono text-accent">{i + 1}</span>
                {title}
              </p>
              <p className="mt-1 text-sm text-neutral-300">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="In numbers">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Questions in the experiment" value={String(s.counts.questions)} />
          <Stat label="Lessons written in the headline run" value={String(s.counts.lessons)} />
          <Stat label="Memories on mainnet, all runs" value={String(s.memories.mainnet.total)} />
        </div>
      </Section>
    </>
  );
}
