# I gave an AI forecaster a memory on Walrus. Here's what it learned from being wrong.

> Draft for the author (AGENT.md §14). The facts and quoted lessons below are from the official run; rewrite the prose in your own voice. The results table is filled by `export` and should not be typed by hand. Screenshots and links are marked in brackets. Delete this note before publishing.

## The problem: agents repeat their mistakes

An LLM forecaster starts each question from nothing. It can be wrong in the same way a hundred times and never know. Memory is the obvious fix, and "our agent has memory" is an easy claim to make. It is much harder to show that memory made the agent better.

So I built the test first. Tuition answers yes/no questions about where crypto prices will be in 7 days. After each bad miss it writes a lesson to Walrus Memory on Sui mainnet, and before each forecast it recalls the lessons that match the current market.

## The experiment

Same model, same questions, one remembers.

The agent answered 264 questions across 33 weeks of 2026 for BTC, ETH, SOL and SUI, in four arms:

- a plain base rate with no LLM
- the model with memory off
- the model with memory off again, because two identical passes show how much of any gap is noise
- the model with memory on

The first 13 weeks were for tuning, under a rule I wrote down before starting. The last 20 weeks were held back, and they alone produce the headline. There was one official run, and the workflow refuses to start a second.

## Keeping it honest: the leakage controls

An LLM may simply remember what BTC did in March. So prompts carry no tickers, dates or real prices: only "Asset C", prices rebased to 100, and computed features.

Memory could leak the future too. Every run starts with empty namespaces, weeks run strictly in order, and a lesson is written only when the simulated clock reaches its outcome. In the official run, none of the 1,536 memories recalled was dated after its decision.

## Results

<!-- GENERATED:results -->
| Arm | n | Brier | Log loss | Accuracy | ECE | Skill vs base |
|---|---:|---:|---:|---:|---:|---:|
| Base rate (no LLM) | 160 | 0.259 | 0.713 | 0.553 | 0.119 | - |
| Memory OFF | 160 | 0.267 | 0.749 | 0.519 | 0.097 | −0.031 |
| Memory OFF, second pass | 160 | 0.262 | 0.736 | 0.531 | 0.079 | −0.011 |
| Memory ON | 160 | 0.258 | 0.714 | 0.516 | 0.082 | +0.004 |

Memory ON vs OFF: +0.0089, 95% CI [−0.0134, +0.0325], 2000 block-bootstrap resamples. Not statistically significant.
<!-- /GENERATED:results -->

[Learning curve chart from the Overview page]

[Calibration chart from the Calibration page]

Memory scored better, and the improvement is not statistically significant. The interval spans zero, and two identical no-memory passes differ by more than half of the gap. A plain base rate with no LLM at all ties the memory arm.

## Three lessons it wrote

What surprised me was how often the honest lesson was "that was noise". 31 of the 181 lessons recommended no adjustment at all.

The most cited lesson, used 20 times:

> With a flat trend, low contracting vol and price at its 20-day mean after a strong 30-day gain, the 7-day direction was near a coin flip, and the small upward tilt was reasonable. A wide last-day range after a drop flagged noise, not a signal. Keep estimates near 0.5.

One with an actual opinion, used 16 times:

> In a persistent downtrend with price below a falling 20-day mean and a deep drawdown, a flat 7-day return after a bounce doesn't mean the slide is over. Trend persistence was under-weighted; I should lean bearish a bit more, though one outcome is weak evidence.

That one sounds sensible. Forecasts citing it scored worse than the same forecasts without memory, by 0.015 on average.

And an early one, written after only two weeks:

> In a flat, normal-vol, stable regime after a large prior drawdown, price near the 20-day mean and a bounce off the range low, my small bearish tilt from weak trend features had no edge. Stay near 0.50; this miss is mostly noise.

## Live commitments: forecasts written to Walrus before the outcome

A replay can always be doubted, so the agent also runs forward. Every day it forecasts each asset and writes the forecast to Walrus before the outcome is known, so it cannot be edited later.

[Live page screenshot, with the first resolved forecasts from 8 November onward]

One honest wrinkle: the job is scheduled for just after midnight UTC, but GitHub usually runs it around 06:00 to 07:00. The model does not see those hours, but the commitments are not as tight as the schedule suggests.

## What did not work

- **Tuning found nothing.** Neither change beat the noise floor, and on the dev weeks memory scored worse than no memory in all three tuning runs.
- **Cited lessons did not earn the gain.** Forecasts that cited a lesson did slightly worse than without memory; forecasts that cited none did better. Every memory forecast also sees a calibration snapshot, so that may be the real source, but this design cannot separate them.
- **Lessons barely moved anything.** A citing forecast shifted by about 0.04 on average.
- **The LLM lost to arithmetic on breakouts.** Every LLM arm scored worse than the base rate on breakout questions, though memory was the closest.
- **I made a mistake.** I resumed a tuning run without its week limit, and it forecast test weeks in the no-memory arms before I caught it. I stopped it, never scored it, and added guards. It is logged as decision D42.

The likely bottom line: 7-day crypto direction has very little signal to remember. A memory layer can only amplify what is learnable.

## Verify it yourself

Nothing here needs trust.

- Account object through Tatum's Sui gateway, with the agent's key on it: [`/verify` link]
- Every blob of the official run and the live forecasts checked against the Walrus aggregator
- Three random lessons recalled by their own text, each returning the same blob first
- All forecasts, ledgers and code in the repository: [repo link]

[Demo link]
