import type { Arm, LessonsFile, QuestionRow } from "@tuition/shared";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BlobLink, Chip, PageTitle, Section, Stat, Status } from "../components/ui";
import { AXIS_TICK, INK, Legend, SERIES, TooltipBox } from "../lib/charts";
import { useLessons, useQuestions } from "../lib/data";
import { ARM_LABEL, signed } from "../lib/format";

function PriceChart({ q }: { q: QuestionRow }) {
  const rows = useMemo(
    () =>
      q.path.closes.map((close, i) => {
        const day = q.path.dayFrom + i;
        return {
          day,
          past: day <= 0 ? close : undefined,
          after: day >= 0 ? close : undefined,
          high: day > 0 ? q.path.futureHighs[day - 1] : undefined,
          low: day > 0 ? q.path.futureLows[day - 1] : undefined,
        };
      }),
    [q],
  );
  const t = q.type === "BREAKOUT" ? q.threshold : undefined;
  const lines = t === undefined ? [] : [100 * (1 + t), 100 * (1 - t)];
  return (
    <figure>
      <div className="mb-3">
        <Legend
          items={[
            { label: "What the model saw", color: SERIES.neutral },
            { label: "What happened next", color: SERIES.on },
            ...(t === undefined ? [] : [{ label: `Breakout line (±${(t * 100).toFixed(1)}%)`, color: SERIES.off, dashed: true }]),
          ]}
        />
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="day" type="number" domain={["dataMin", "dataMax"]} tick={AXIS_TICK} stroke={INK.grid} ticks={[-59, -45, -30, -15, 0, q.path.dayFrom + q.path.closes.length - 1]} />
            <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} width={48} stroke={INK.grid} tickFormatter={(v: number) => v.toFixed(0)} />
            <ReferenceLine x={0} stroke={INK.axis} label={{ value: "decision", position: "insideTopLeft", fill: INK.axis, fontSize: 12 }} />
            {lines.map((y) => (
              <ReferenceLine key={y} y={y} stroke={SERIES.off} strokeDasharray="4 4" ifOverflow="extendDomain" />
            ))}
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={`Day ${Number(label) > 0 ? "+" : ""}${String(label)}`}
                    rows={payload.filter((p) => p.value !== undefined).map((p) => ({ label: String(p.name), value: Number(p.value).toFixed(2) }))}
                  />
                ) : null
              }
            />
            <Line dataKey="past" name="Close" stroke={SERIES.neutral} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="high" name="High" stroke={SERIES.on} strokeWidth={1} strokeOpacity={0.6} dot={false} isAnimationActive={false} />
            <Line dataKey="low" name="Low" stroke={SERIES.on} strokeWidth={1} strokeOpacity={0.6} dot={false} isAnimationActive={false} />
            <Line dataKey="after" name="Close after" stroke={SERIES.on} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-neutral-400">Prices rebased so the decision-day close is 100, the only form the model ever saw.</figcaption>
    </figure>
  );
}

function Recalled({ q, lessons }: { q: QuestionRow; lessons: LessonsFile }) {
  const mem = q.forecasts.mem;
  const bodies = useMemo(
    () => new Map([...lessons.lessons.map((l) => [l.blobId, l.body] as const), ...lessons.calibrations.map((c) => [c.blobId, c.body] as const)]),
    [lessons],
  );
  if (!mem || mem.recalled.length === 0) return <p className="text-neutral-300">Nothing was recalled for this forecast.</p>;
  return (
    <ul className="space-y-3">
      {mem.recalled.map((m) => {
        const cited = mem.citedBlobIds.includes(m.blobId);
        return (
          <li key={m.blobId} className="rounded border border-neutral-800 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip>{m.kind}</Chip>
              <Chip>distance {m.distance.toFixed(3)}</Chip>
              <Chip>{cited ? "cited" : "not cited"}</Chip>
            </div>
            <p className="mt-2 text-sm whitespace-pre-line text-neutral-200">{bodies.get(m.blobId) ?? "(text not in this export)"}</p>
            <p className="mt-2">
              <BlobLink id={m.blobId} />
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const ARMS: Arm[] = ["base", "nomem", "mem"];

export default function QuestionDetail() {
  const { id } = useParams();
  const questions = useQuestions();
  const lessons = useLessons();
  if (questions.state !== "ready" || lessons.state !== "ready") return <Status results={[questions, lessons]} />;
  const q = questions.data.questions.find((x) => x.id === id);
  if (!q) {
    return (
      <p className="text-neutral-300">
        No question with this ID.{" "}
        <Link className="text-accent underline" to="/questions">
          All questions
        </Link>
      </p>
    );
  }
  const asked =
    q.type === "DIRECTION"
      ? `Will the close 7 days later be higher than the close on the decision day?`
      : `Will price trade at least ${((q.threshold ?? 0) * 100).toFixed(1)}% away from the decision-day close, in either direction, within 7 days?`;

  return (
    <>
      <p className="mb-4 text-sm">
        <Link className="text-accent underline-offset-2 hover:underline" to="/questions">
          All questions
        </Link>
      </p>
      <PageTitle title={`${q.symbol} ${q.type}, ${q.decisionDate}`}>
        <p>{asked}</p>
        <p className="mt-1 text-sm text-neutral-400">
          Shown after the fact: the model never saw the ticker or the date. It saw "{q.assetCode}", rebased prices and the features below.
        </p>
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip>{q.split} split</Chip>
        {q.regime.split("/").map((part, i) => (
          <Chip key={`${i}-${part}`}>{part}</Chip>
        ))}
        <Chip>outcome: {q.outcome === undefined ? "unresolved" : q.outcome === 1 ? "yes" : "no"}</Chip>
        {q.brierGain !== undefined && <Chip>gain from memory {signed(q.brierGain, 3)}</Chip>}
      </div>

      <PriceChart q={q} />

      <Section title="The forecasts">
        <div className="grid gap-3 md:grid-cols-3">
          {ARMS.map((arm) => {
            const f = q.forecasts[arm];
            return f ? (
              <Stat
                key={arm}
                label={ARM_LABEL[arm]}
                value={f.p.toFixed(2)}
                note={
                  <>
                    <p>{f.rationale || "Trailing base rate for this question type and asset."}</p>
                    {f.brier !== undefined && <p className="mt-2 font-mono text-neutral-400">Brier {f.brier.toFixed(3)}</p>}
                  </>
                }
              />
            ) : null;
          })}
        </div>
      </Section>

      <Section title="What memory recalled">
        <Recalled q={q} lessons={lessons.data} />
      </Section>
    </>
  );
}
