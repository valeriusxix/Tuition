import type { ReactNode } from "react";
import { RunPair } from "../components/RunPair";
import { PageTitle, Section, Status } from "../components/ui";
import { useSummary } from "../lib/data";
import { REPO } from "../lib/links";

const List = ({ children }: { children: ReactNode }) => <ul className="max-w-2xl list-disc space-y-2 pl-5 text-neutral-300">{children}</ul>;

export default function Method() {
  const summary = useSummary();
  if (summary.state !== "ready") return <Status results={[summary]} />;
  const s = summary.data;
  const c = s.config;
  return (
    <>
      <PageTitle title="Method">The short version. The full account, including every deviation from the plan, is in the repository.</PageTitle>

      <Section title="Questions">
        <List>
          <li>
            Every Monday from {c.replayStart} to {c.replayEnd}, for {c.assets.join(", ")}: {s.counts.questions} questions over {s.weeks.count} weeks.
          </li>
          <li>Direction: will the close {c.horizonDays} days later be higher?</li>
          <li>Breakout: will price move at least a set threshold in either direction within {c.horizonDays} days? The threshold is the median past move, using only windows already finished. That aims for about half resolving yes, but the replay period was calmer than the months before it, so only 37% did (49 of 132).</li>
        </List>
      </Section>

      <Section title="Arms">
        <List>
          <li>Base rate: no LLM, the trailing frequency for that question type and asset.</li>
          <li>Memory OFF: {c.forecastModel}, told that no lessons are available.</li>
          <li>Memory OFF, second pass: the same again. Any gap between the two passes is pure model noise, which sizes what a real effect must beat.</li>
          <li>Memory ON: the same model and prompt, plus lessons and a calibration snapshot recalled from Walrus Memory.</li>
        </List>
      </Section>

      <Section title="Leakage controls">
        <List>
          <li>Prompts carry no tickers, dates, volumes or absolute prices: only rebased prices and computed features.</li>
          <li>Each run starts with empty namespaces and processes weeks in order, so recall can only surface the past. In both official runs, none of the recalled memories was dated after its decision.</li>
          <li>A lesson is written only when the simulated clock reaches its question's resolve date.</li>
        </List>
      </Section>

      <Section title="Splits and tuning">
        <List>
          <li>Dev: decisions through {c.devSplitEnd}. Test: everything after, used only by the official runs. The headline is always the test split.</li>
          <li>
            Three tuning runs, with an adoption rule fixed in advance. Neither change beat the noise floor, so the defaults stayed: lesson threshold {c.lessonErrorThreshold}, recall limit {c.recallLimit}, max distance{" "}
            {c.recallMaxDistance}.
          </li>
          <li>Two official runs. The first had the calibration bug described below. The second is its one rerun, pre-registered before it started (decision D51), with only that bug fixed. The workflow refuses a third.</li>
          <li>One mistake is on record: a tuning run was resumed without its week limit and forecast test weeks with no memory arm. It was stopped, never scored, and guards were added (decision D42).</li>
        </List>
      </Section>

      {s.otherRun && (
        <Section title="The calibration bug and the rerun">
          <List>
            <li>
              The memory arm is meant to read the newest calibration snapshot each week. It asked the relayer for one result sorted by "recent", but that sort only
              reorders the few closest matches, not the whole namespace. Later snapshots are longer and sit further from the query, so the first run kept getting an old one.
            </li>
            <li>The tests missed it because the in-memory test store sorted the whole namespace. It now behaves like the relayer, and a test fails on the old call.</li>
            <li>
              The fix reads every snapshot back and takes the newest by its header date. Nothing else changed: same models, prompts, questions, settings and scoring.
              The test split's results had already been seen when the rerun started, so it is no longer untouched.
            </li>
          </List>
          <div className="mt-4">
            <RunPair summary={s} />
          </div>
        </Section>
      )}

      <Section title="Metrics">
        <List>
          <li>Brier score, log loss, accuracy at 0.5, expected calibration error, and Brier skill against the base rate.</li>
          <li>
            The headline interval is a paired block bootstrap by decision week ({(s.headline?.resamples ?? 2000).toLocaleString("en-GB")} resamples, seed {c.seed}), because questions in one week are correlated.
          </li>
        </List>
      </Section>

      <Section title="Honest limitations">
        <List>
          <li>The sample is small: {s.counts.bySplit.test ?? 0} test questions in {s.headline?.blocks ?? 0} weeks, on four correlated crypto assets.</li>
          <li>No temperature setting is sent, because the models reject it, so the LLM is not deterministic. That is why the second no-memory pass exists.</li>
          <li>Run-to-run variation is large: with the same settings on the same dev questions, one tuning run scored memory Δ −0.0085 and the first official run +0.0091.</li>
          <li>{"The forecast prompt says breakout questions resolve yes \"roughly half the time historically\", but here it was 37%. That may be one reason every LLM arm lost to the base rate on breakout. The prompt was left unchanged so the runs stay comparable."}</li>
          <li>In the rerun, across all 33 weeks, forecasts that cited a lesson gained 0.013 on average and those citing none lost 0.0015. In the first run it was the other way round. Neither run can fully separate lessons from the calibration snapshot.</li>
          <li>The plain base rate beats every LLM arm on the test split, memory included, because the LLM arms lose on breakout questions.</li>
          <li>The model may still recognise a market from its shape, despite the anonymisation.</li>
          <li>The managed relayer sees memory text in plaintext when it embeds it. The stored blobs are encrypted.</li>
          <li>Live forecasts usually commit several hours into their first day (see the Live page).</li>
        </List>
      </Section>

      <p className="mt-10 text-neutral-300">
        <a className="text-accent underline-offset-2 hover:underline" href={REPO}>
          Source, decisions log and raw run data
        </a>
      </p>
    </>
  );
}
