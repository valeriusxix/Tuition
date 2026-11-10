import type { Arm, LessonsFile, QuestionRow } from "@tuition/shared";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BlobLink, Chip, LINK, PageTitle, Section, Status } from "../components/ui";
import { AXIS_TICK, INK, LABEL, Legend, SERIES, TooltipBox, useMedia } from "../lib/charts";
import { useLessons, useQuestions } from "../lib/data";
import { ARM_LABEL, signed } from "../lib/format";

function PriceChart({ q }: { q: QuestionRow }) {
  const phone = useMedia("(max-width: 639px)");
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
  const lastDay = q.path.dayFrom + q.path.closes.length - 1;
  const t = q.type === "BREAKOUT" ? q.threshold : undefined;
  const lines = t === undefined ? [] : [100 * (1 + t), 100 * (1 - t)];
  return (
    <figure>
      <div className="mb-3">
        <Legend
          items={[
            { label: "What the model saw", color: SERIES.off },
            { label: "What happened next", color: SERIES.on },
            ...(t === undefined ? [] : [{ label: `Breakout lines, ±${(t * 100).toFixed(1)}%`, color: SERIES.neutral, dotted: true }]),
          ]}
        />
      </div>
      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis
              dataKey="day"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={AXIS_TICK}
              tickLine={false}
              stroke={INK.grid}
              ticks={phone ? [q.path.dayFrom, -30, 0, lastDay] : [q.path.dayFrom, -45, -30, -15, 0, lastDay]}
              tickFormatter={(d: number) => (d > 0 ? `+${d}` : String(d))}
            />
            <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} tickLine={false} width={40} stroke={INK.grid} tickFormatter={(v: number) => v.toFixed(0)} tickCount={phone ? 4 : 6} />
            <ReferenceLine x={0} stroke={INK.axis} strokeDasharray="2 4" label={{ value: "decision", position: "insideTopRight", ...LABEL }} />
            {lines.map((y) => (
              <ReferenceLine key={y} y={y} stroke={SERIES.neutral} strokeDasharray="2 4" ifOverflow="extendDomain" />
            ))}
            <Tooltip
              cursor={{ stroke: INK.axis, strokeDasharray: "2 4" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={`Day ${Number(label) > 0 ? "+" : ""}${String(label)}`}
                    rows={payload.filter((p) => p.value !== undefined).map((p) => ({ label: String(p.name), value: Number(p.value).toFixed(2) }))}
                  />
                ) : null
              }
            />
            <Line dataKey="past" name="Close" stroke={SERIES.off} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="high" name="High" stroke={SERIES.on} strokeWidth={1} strokeOpacity={0.5} dot={false} isAnimationActive={false} />
            <Line dataKey="low" name="Low" stroke={SERIES.on} strokeWidth={1} strokeOpacity={0.5} dot={false} isAnimationActive={false} />
            <Line dataKey="after" name="Close after" stroke={SERIES.on} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-sm text-paper-2">Prices rebased so the decision-day close is 100, the only form the model ever saw. Days are counted from the decision.</figcaption>
    </figure>
  );
}

function Recalled({ q, lessons }: { q: QuestionRow; lessons: LessonsFile }) {
  const mem = q.forecasts.mem;
  const bodies = useMemo(
    () => new Map([...lessons.lessons.map((l) => [l.blobId, l.body] as const), ...lessons.calibrations.map((c) => [c.blobId, c.body] as const)]),
    [lessons],
  );
  if (!mem) return <p className="text-paper-2">This question has no memory-ON forecast.</p>;
  if (mem.recalled.length === 0) return <p className="text-paper-2">Nothing was recalled for this forecast: no memory was close enough, or none existed yet.</p>;
  return (
    <ul className="rule-t">
      {mem.recalled.map((m) => {
        const cited = mem.citedBlobIds.includes(m.blobId);
        return (
          <li key={m.blobId} className="rule-b py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip>{m.kind}</Chip>
              <Chip>distance {m.distance.toFixed(3)}</Chip>
              {cited ? <Chip tone="pen">cited by the model</Chip> : <Chip>recalled, not cited</Chip>}
              <span className="ml-auto">
                <BlobLink id={m.blobId} />
              </span>
            </div>
            <p className="mt-3 max-w-3xl text-sm whitespace-pre-line text-paper">{bodies.get(m.blobId) ?? "(this memory's text is not in the export)"}</p>
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
      <div className="max-w-xl">
        <p className="display text-3xl">No question with this ID.</p>
        <p className="mt-3">
          <Link className={LINK} to="/questions">
            All questions
          </Link>
        </p>
      </div>
    );
  }
  const h = questions.data.horizonDays;
  const asked =
    q.type === "DIRECTION"
      ? `Will the close ${h} days later be higher than the close on the decision day?`
      : `Will price trade at least ${((q.threshold ?? 0) * 100).toFixed(1)}% away from the decision-day close, in either direction, within ${h} days?`;
  const outcome = q.outcome === undefined ? "unresolved" : q.outcome === 1 ? "Yes" : "No";

  return (
    <>
      <p className="mb-4 text-sm">
        <Link className={LINK} to="/questions">
          ← All questions
        </Link>
      </p>
      <PageTitle title={`${q.symbol} ${q.type}, ${q.decisionDate}`}>
        <p className="text-paper">{asked}</p>
        <p className="mt-2 text-base">
          Shown after the fact: the model never saw the ticker or the date. It saw "{q.assetCode}", rebased prices and the regime below.
        </p>
      </PageTitle>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Chip>{q.split} split</Chip>
        {q.regime.split("/").map((part, i) => (
          <Chip key={`${i}-${part}`}>{part}</Chip>
        ))}
        <Chip tone={q.outcome === undefined ? "plain" : "pen"}>outcome: {outcome}</Chip>
      </div>

      <PriceChart q={q} />

      <Section title="The three forecasts" aside={q.brierGain !== undefined ? <span>Gain from memory <span className="font-mono text-paper">{signed(q.brierGain, 3)}</span></span> : undefined}>
        <div className="grid gap-8 md:grid-cols-3">
          {ARMS.map((arm) => {
            const f = q.forecasts[arm];
            if (!f) return null;
            return (
              <div key={arm} className={arm === "mem" ? "border-l-2 border-pen pl-4" : "border-l-2 border-rule pl-4"}>
                <p className="text-sm text-paper-2">{ARM_LABEL[arm]}</p>
                <p className="mt-1 font-mono text-4xl text-paper">{f.p.toFixed(2)}</p>
                {f.brier !== undefined && (
                  <p className="mt-1 font-mono text-sm text-paper-2">
                    Brier {f.brier.toFixed(3)}
                  </p>
                )}
                <p className="mt-3 text-sm text-paper-2">{f.rationale || "The trailing base rate for this question type and asset, no model involved."}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="What memory recalled">
        <Recalled q={q} lessons={lessons.data} />
      </Section>
    </>
  );
}
