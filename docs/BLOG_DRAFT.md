# I gave an AI forecaster a memory on Walrus. Here's what it learned from being wrong.

*Tuition, an entry for the Total Recall hackathon (Tatum × Walrus), Track 1: Markets & Sports Prediction.*

## The problem: agents repeat their mistakes

An LLM forecaster starts each question from nothing. It can be wrong the same way a hundred times and never notice. Memory is the obvious fix, and "our agent has memory" is easy to claim. It is much harder to show that memory made the agent better.

So I built the test first. Tuition answers yes/no questions about where crypto prices will be in 7 days. After each bad miss it writes a short lesson to Walrus Memory on Sui mainnet. Each week it also writes a calibration snapshot: a note on where its past forecasts ran too high or too low. Before every forecast it recalls the lessons closest to the current market, plus the newest snapshot.

## The experiment

Same model. Same questions. One remembers.

The agent answered 264 questions across 33 weeks of 2026 for BTC, ETH, SOL and SUI, in four arms:

- a plain trailing base rate, with no LLM
- the model with memory off
- the model with memory off again, because two identical passes show how much of any gap is just noise
- the model with memory on

The first 13 weeks were for tuning, under a rule I wrote down before starting. The last 20 weeks were held back, and only they produce the headline. The score is the Brier score: the mean squared error of the probability. Lower is better, and a coin flip scores 0.25.

## Keeping it honest: the leakage controls

An LLM may simply remember what BTC did in March. So prompts carry no tickers, dates or real prices: only "Asset C", prices rebased to 100, and computed features.

Memory could leak the future too. Every run starts with empty namespaces, weeks run strictly in order, and a lesson is written only when the simulated clock reaches its outcome. No recalled memory in either official run was dated after the decision it informed.

## The bug: a memory that stopped updating

The first official run looked fine. Then an independent audit of the run data found that the calibration snapshot had frozen.

The memory arm asked Walrus Memory for "the most recent calibration snapshot" with one result, sorted by recency. That sort does not search the whole namespace. It takes the few closest semantic matches and orders only those by time. My later snapshots were longer, so they sat further from the query and fell out of that window. From late April on, the agent got the same April snapshot every week, while 32 newer ones sat on mainnet unread. Only 6 of the 32 snapshots ever reached a prompt.

My tests had not caught it, because my fake memory store sorted the whole namespace, which the real one does not do. The fake was more correct than the real service.

What I did:

- **Fixed one call.** The agent now reads every snapshot back from Walrus and takes the newest by the date in its header.
- **Made the test store behave like the relayer.** A new test fails on the old call, in the same way the real run failed.
- **Pre-registered one rerun.** Before starting it I committed the plan to the decision log: the single change, the same settings, every arm rerun, the rerun as the headline, both runs published whichever way they landed, and no further reruns.

The rerun got the newest snapshot in all 32 weeks.

## Results

<!-- GENERATED:results -->
| Arm | n | Brier | Log loss | Accuracy | ECE | Skill vs base |
|---|---:|---:|---:|---:|---:|---:|
| Base rate (no LLM) | 160 | 0.259 | 0.713 | 0.553 | 0.119 | - |
| Memory OFF | 160 | 0.271 | 0.763 | 0.522 | 0.099 | −0.045 |
| Memory OFF, second pass | 160 | 0.267 | 0.745 | 0.522 | 0.106 | −0.032 |
| Memory ON | 160 | 0.265 | 0.735 | 0.512 | 0.107 | −0.021 |

Memory ON vs OFF: +0.0063, 95% CI [−0.0045, +0.0168], 2000 block-bootstrap resamples. Not statistically significant.

**Two official runs.** The first official run (`r-20261106-1001-f2a8`) had a bug: its memory arm asked for the newest calibration snapshot in a way that only searched the few closest matches, so from 2026-04-27 on it kept getting an old one (26 of 32 weeks stale; 6 of 32 snapshots ever reached a prompt). This run (`r-20261109-1519-27da`) is the single rerun, pre-registered before it started, with only that fixed (DECISIONS D51): 32 of 32 weeks got the newest snapshot. Both are published.

| Test split | Memory OFF | Memory ON | Δ | 95% CI | P(Δ>0) |
|---|---:|---:|---:|---:|---:|
| Rerun, calibration fixed (`r-20261109-1519-27da`, headline) | 0.271 | 0.265 | +0.0063 | [−0.0045, +0.0168] | 0.87 |
| First run, calibration frozen (`r-20261106-1001-f2a8`) | 0.267 | 0.258 | +0.0089 | [−0.0134, +0.0325] | 0.77 |
<!-- /GENERATED:results -->

Memory scored a little better in both official runs, and neither improvement is statistically significant. In the rerun, memory won 13 of the 20 test weeks, and P(Δ>0) is 0.87 across the bootstrap. That is suggestive, not proof:

- **The noise is the same size.** Two identical no-memory passes differ by +0.0034. Against the second pass, memory gains only +0.0029.
- **Arithmetic still wins.** The plain base rate scores 0.259 and beats every LLM arm, memory included (0.265).
- **The gain is in breakouts.** On direction questions, all three LLM arms score 0.253. On breakout questions memory is best of the LLM arms (0.276, against 0.289 and 0.281), but the base rate is 0.245.
- **No learning curve.** The gain over memory OFF by third of the run was +0.0041, +0.0018 and +0.0086. That is not a steady climb as lessons pile up.

[See the charts on the Overview and Calibration pages.](https://tuition-jet.vercel.app/)

The fix also changed how the memory worked, not just the number. In the first run, forecasts that cited a lesson did worse than memory OFF, and those that cited none did better, so the gain probably came from the frozen snapshot. In the rerun it flipped. Forecasts citing a lesson gained 0.013 on average, and those citing none lost 0.0015. Of the 21 lessons cited at least three times, 13 helped on average and 6 hurt.

## Three lessons it wrote

Many of the honest lessons were "that was noise". 31 of the 175 recommended no adjustment at all.

The most cited, used 16 times:

> With a flat trend and normal stable vol, a 0.50 forecast carries no edge, and one down week is mostly noise. After a sharp 7-day drop and a wide, volatile range, I can't count on a bounce, so I shouldn't lean either way without confirming signals.

The one that helped most, cited 11 times and improving those forecasts by 0.095 on average:

> When vol7 is below vol30 and volRatio is low, I shouldn't treat contraction as proof of calm. With a 9% drawdown, a recent 3% rebound and wide lastRange, a 7.6% two-sided touch was reachable. I'll weight vol30 and range more and nudge up.

And one that sounded right but hurt, cited 12 times and costing 0.009 on average:

> After a sharp 7-day drop in a down trend with normal, stable vol, the price sat below its 20-day average and the next week continued lower. A mild lean to NO was right but too timid; I should lean a bit harder when ret7 is steeply negative and smaDist20 is well below zero.

The last calibration snapshot shows the agent's blind spot. On breakouts in flat or rising, low-volatility markets, it said yes about 21% of the time, and they happened about 41% of the time.

## Live commitments

A replay can always be doubted, so the agent also runs forward. Every day it forecasts each asset and writes the forecast to Walrus Memory before the outcome is known. The bot commits the forecast and the hash of its text to git the same morning, so the timing is on record, and the ciphertext is on Walrus.

24 live forecasts have resolved so far, with a Brier of 0.247. Be careful with that number: all 24 were made before the replay's lessons were connected to live mode, so none of them used memory. The first memory-informed live forecasts resolve after the deadline. There are no forecasts for decision day 7 November: that day's run did not record any.

The job is scheduled for just after midnight UTC, but GitHub usually runs it around 06:00 to 07:00 UTC. The model never sees those hours, but the commitments are not as tight as the schedule suggests.

[Live page](https://tuition-jet.vercel.app/live)

## What did not work

- **A memory bug ran for a whole official run.** It is described above, along with the fix and the rerun.
- **Tuning found nothing.** No change beat the noise floor, and on the dev weeks memory scored worse than memory OFF in all three tuning runs.
- **The model lost to arithmetic on breakouts.** I also told it that breakout questions resolve yes "roughly half the time". In this period it was 37%, because the market was calmer than the months behind it. I left the prompt alone so the two runs stay comparable.
- **Recall surfaces a small slice.** Only 70 of the 175 lessons in the rerun were ever recalled.
- **Run-to-run swings are large.** On the same dev questions with the same settings, memory scored −0.0085 in one tuning run and +0.0091 in the first official run.
- **I made a tuning mistake.** I resumed a tuning run without its week limit, and it forecast some test weeks with memory OFF before I caught it. I stopped it, never scored it, and added guards. It is decision D42.

The likely bottom line: 7-day crypto direction has very little signal to remember. A memory layer can only amplify what is learnable. Breakouts are where the agent's errors were systematic, and that is where memory helped.

## Verify it yourself

You can check most of this without trusting me:

- **The account object.** It is read through Tatum's Sui gateway, with the agent's delegate key on it. See the [Verify page](https://tuition-jet.vercel.app/verify).
- **Every blob.** All 299 blobs of the rerun and the live forecasts return HTTP 200 from the Walrus aggregator. The content is encrypted, so you can check that a blob exists, not what it says.
- **Recall.** Three random lessons were recalled by their own text, and each returned the same blob first.
- **The records.** Forecasts, ledgers, both runs' checkpoints, the decision log and the code are in the [repository](https://github.com/valeriusxix/Tuition).

Tuition: *the market charges tuition. Tuition keeps the notes.* [Try the site](https://tuition-jet.vercel.app/).
