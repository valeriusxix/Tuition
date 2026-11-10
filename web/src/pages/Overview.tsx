import { verdict, type Comparison, type CurveFile, type SummaryFile } from "@tuition/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RunPair } from "../components/RunPair";
import { LINK, Mark, Section, SELECT, Stat, Status } from "../components/ui";
import { AXIS_TICK, INK, LABEL, Legend, SERIES, TooltipBox, useMedia } from "../lib/charts";
import { useCurve, useSummary } from "../lib/data";
import { num, percent, shortDate, signed } from "../lib/format";

const find = (s: SummaryFile, id: string, split = "test"): Comparison | undefined => s.comparisons.find((c) => c.id === id && c.split === split);

type Mode = "rolling" | "cumulative";

function LearningCurve({ curve, summary }: { curve: CurveFile; summary: SummaryFile }) {
  const [mode, setMode] = useState<Mode>("rolling");
  const phone = useMedia("(max-width: 639px)");
  const rows = useMemo(() => {
    const on = curve.arms.mem ?? [];
    const off = new Map((curve.arms.nomem ?? []).map((p) => [p.decisionDate, p]));
    const off2 = new Map((curve.arms.nomem2 ?? []).map((p) => [p.decisionDate, p]));
    return on.map((p) => ({ date: p.decisionDate, on: p[mode], off: off.get(p.decisionDate)?.[mode], off2: off2.get(p.decisionDate)?.[mode] }));
  }, [curve, mode]);
  if (rows.length === 0) return <p className="text-paper-2">The curve file has no memory-ON points to draw.</p>;

  const firstTest = rows.find((r) => r.date > summary.config.devSplitEnd)?.date;
  const values = rows.flatMap((r) => [r.on, r.off ?? r.on, r.off2 ?? r.on]);
  const low = Math.floor(Math.min(...values, 0.25) * 20);
  const high = Math.ceil(Math.max(...values, 0.25) * 20);
  const yTicks = Array.from({ length: high - low + 1 }, (_, i) => (low + i) / 20);
  const last = rows[rows.length - 1]!;
  // Direct labels at the right end of the lines, instead of making the reader look up a legend.
  const ends = [
    { key: "on", value: last.on, text: "ON", color: SERIES.on },
    { key: "off", value: last.off, text: "OFF", color: SERIES.off },
  ].flatMap((e) => (typeof e.value === "number" ? [{ ...e, value: e.value }] : []));

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Legend
          items={[
            { label: "Memory ON", color: SERIES.on },
            { label: "Memory OFF", color: SERIES.off },
            { label: "OFF, second pass", color: SERIES.off, dashed: true },
            { label: "Coin flip", color: SERIES.neutral, dotted: true },
          ]}
        />
        <label className="text-sm text-paper-2">
          <span className="sr-only">Curve type</span>
          <select className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="rolling">Last {curve.window} questions</option>
            <option value="cumulative">All questions so far</option>
          </select>
        </label>
      </div>
      <div className="h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: 36, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={shortDate} minTickGap={phone ? 72 : 48} stroke={INK.grid} tickLine={false} />
            <YAxis
              domain={[low / 20, high / 20]}
              ticks={phone ? yTicks.filter((_, i) => i % 2 === 0) : yTicks}
              tick={AXIS_TICK}
              width={44}
              stroke={INK.grid}
              tickLine={false}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <ReferenceLine y={0.25} stroke={SERIES.neutral} strokeDasharray="2 4" label={phone ? undefined : { value: "coin flip", position: "insideBottomRight", ...LABEL }} />
            {firstTest && <ReferenceLine x={firstTest} stroke={INK.axis} strokeDasharray="2 4" label={{ value: "test split →", position: "insideBottomRight", ...LABEL }} />}
            <Tooltip
              cursor={{ stroke: INK.axis, strokeDasharray: "2 4" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox title={shortDate(String(label))} rows={payload.map((p) => ({ label: String(p.name), value: Number(p.value).toFixed(3), color: String(p.color) }))} />
                ) : null
              }
            />
            <Line dataKey="off2" name="OFF, second pass" stroke={SERIES.off} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line dataKey="off" name="Memory OFF" stroke={SERIES.off} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="on" name="Memory ON" stroke={SERIES.on} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            {ends.map((e) => (
              <ReferenceDot key={e.key} x={last.date} y={e.value} r={0} label={{ value: e.text, position: "right", fill: e.color, fontSize: 11, fontFamily: LABEL.fontFamily }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-paper-2">Mean Brier score by decision week, lower is better. A coin flip scores 0.250. The dashed OFF line is a second identical no-memory pass, showing the model's own noise.</figcaption>
      <details className="mt-2 text-sm text-paper-2">
        <summary className="cursor-pointer py-2 hover:text-paper">Show as a table</summary>
        <table className="mt-2 font-mono text-xs">
          <thead>
            <tr className="text-paper-2">
              <th className="pr-4 text-left font-normal">Week</th>
              <th className="pr-4 text-right font-normal">ON</th>
              <th className="pr-4 text-right font-normal">OFF</th>
              <th className="text-right font-normal">OFF 2</th>
            </tr>
          </thead>
          <tbody className="text-paper">
            {rows.map((r) => (
              <tr key={r.date}>
                <td className="pr-4">{r.date}</td>
                <td className="pr-4 text-right">{r.on.toFixed(3)}</td>
                <td className="pr-4 text-right">{r.off?.toFixed(3) ?? "–"}</td>
                <td className="text-right">{r.off2?.toFixed(3) ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const STEPS: [string, string][] = [
  ["Forecast", "The agent answers yes/no questions about 7-day crypto moves, seeing only anonymised, rebased data: no tickers, no dates, no real prices."],
  ["Reflect", "When a forecast misses badly, it writes a short lesson in its own words. Each week it also writes a calibration snapshot."],
  ["Remember", "Lessons go to Walrus Memory on Sui mainnet, written only when the simulated clock reaches the outcome. Before each new forecast, it recalls the ones that match."],
  ["Compare", "The same model answers the same questions with memory off, in the same order. The difference in Brier score, with its interval, is the result."],
];

export default function Overview() {
  const summary = useSummary();
  const curve = useCurve();
  if (summary.state !== "ready" || curve.state !== "ready") return <Status results={[summary, curve]} />;
  const s = summary.data;
  const h = s.headline;
  if (!h) {
    return (
      <div className="max-w-xl">
        <h1 className="display text-4xl">Same model. Same questions. One remembers.</h1>
        <p className="mt-4 text-paper-2">The published run has no memory-ON versus memory-OFF comparison yet, so there is no headline to show.</p>
      </div>
    );
  }
  const v = verdict(h);
  const aa = find(s, "nomem2_vs_nomem");
  const vsBase = find(s, "mem_vs_base");
  const splitName = h.split === "test" ? "held-out test" : h.split;

  return (
    <>
      <section className="max-w-3xl">
        <h1 className="display text-4xl sm:text-6xl">Same model. Same questions. One remembers.</h1>
        <p className="mt-5 text-lg text-paper-2">
          Tuition is an AI crypto forecaster that writes lessons from its mistakes to Walrus Memory. This page shows what those lessons did to its score,
          whichever way it landed.
        </p>
      </section>

      <section className="rule-t mt-10 pt-8" aria-labelledby="headline">
        <p id="headline" className="text-sm text-paper-2">
          Brier score on {h.n} {splitName} questions, memory OFF corrected to memory ON
        </p>
        <Mark off={num(h.referenceBrier)} on={num(h.candidateBrier)} className="mt-2 text-5xl sm:text-7xl" />
        <p className="mt-6 max-w-2xl text-lg text-paper">{v.sentence}</p>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Stat label="Change in Brier (OFF − ON)" value={signed(h.meanDelta)} note="Positive means memory scored better" />
          <Stat
            label="95% interval"
            size="sm"
            value={`${signed(h.ci95[0])} to ${signed(h.ci95[1])}`}
            note={`Block bootstrap over ${h.blocks} weeks, ${h.resamples.toLocaleString("en-GB")} resamples`}
          />
          <Stat label="Resamples where memory won" value={percent(h.shareAboveZero)} note={v.label} />
        </div>
        <ul className="mt-6 max-w-2xl space-y-2 text-paper-2">
          {aa && (
            <li>
              Two identical no-memory passes differ by <span className="font-mono text-paper">{signed(aa.meanDelta)}</span> on the same questions, so a gap of this size
              can come from model noise alone.
            </li>
          )}
          {vsBase && (
            <li>
              Against a plain trailing base rate with no LLM at all, memory is <span className="font-mono text-paper">{signed(vsBase.meanDelta)}</span> (
              {num(vsBase.candidateBrier)} vs {num(vsBase.referenceBrier)}). The base rate is still the best forecaster here.
            </li>
          )}
          {s.influence && s.influence.meanBrierGainCiting !== null && s.influence.meanBrierGainNotCiting !== null && (
            <li>
              On the {s.influence.citing} forecasts where the model said it used a lesson, it gained <span className="font-mono text-paper">{signed(s.influence.meanBrierGainCiting)}</span>{" "}
              against the no-memory pass; on the rest, <span className="font-mono text-paper">{signed(s.influence.meanBrierGainNotCiting)}</span>.
            </li>
          )}
        </ul>
        <p className="mt-6 text-paper-2">
          {s.memories.run.lessons} lessons and {s.memories.run.calibrations} calibration snapshots from this run are on Sui mainnet.{" "}
          <Link className={LINK} to="/verify">
            Check them yourself
          </Link>
          .
        </p>
      </section>

      <Section title="Learning curve">
        <LearningCurve curve={curve.data} summary={s} />
      </Section>

      {s.otherRun && (
        <Section title="Two official runs">
          <RunPair summary={s} />
        </Section>
      )}

      <Section title="How it works">
        <ol className="max-w-3xl">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rule-b flex gap-5 py-4 last:border-b-0">
              <span className="display w-8 shrink-0 text-3xl text-pen">{i + 1}</span>
              <div>
                <p className="display text-xl text-paper">{title}</p>
                <p className="mt-1 text-paper-2">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-paper-2">
          <Link className={LINK} to="/method">
            The full method, leakage controls and limitations
          </Link>
        </p>
      </Section>

      <Section title="In numbers">
        <div className="grid gap-6 sm:grid-cols-3">
          <Stat label="Questions in the experiment" value={s.counts.questions.toLocaleString("en-GB")} note={`${s.weeks.count} decision weeks, ${s.config.assets.length} assets`} />
          <Stat label="Lessons written in this run" value={s.counts.lessons.toLocaleString("en-GB")} note={`plus ${s.counts.calibrations} calibration snapshots`} />
          <Stat label="Memories on mainnet, all runs" value={s.memories.mainnet.total.toLocaleString("en-GB")} note={`${Object.keys(s.memories.mainnet.byNamespace).length} namespaces`} />
        </div>
      </Section>
    </>
  );
}
