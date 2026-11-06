# Methodology

AGENT.md §8 in plain words. Results are in the README and on the site, generated from the run. Deviations from the plan are in [DECISIONS.md](DECISIONS.md).

## Questions

Decision dates are the 33 Mondays from 2026-03-02 to 2026-10-12, UTC. For each date and each of BTC, ETH, SOL and SUI there are two questions, 264 in all.

- **DIRECTION:** will the close 7 days later be higher than the decision-day close?
- **BREAKOUT:** within the next 7 days, will price trade at least a threshold away from the decision-day close, in either direction? The threshold is the median 7-day maximum excursion over the previous 180 days, using only windows that had already ended. That aims for about half of these resolving yes without using future data.

Decision dates through 2026-05-25 are the **dev** split (13 weeks, 104 questions). Later ones are the **test** split (20 weeks, 160 questions).

## Arms

All LLM arms use the same model, prompt template, settings and question order.

| Arm | What it does |
|---|---|
| Base rate | No LLM. The trailing frequency for that question type and asset. |
| Memory OFF | The standard prompt with "No lessons are available." |
| Memory OFF, second pass | The same again. Added to measure noise (an A/A test). |
| Memory ON | The same prompt, plus recalled lessons and the latest calibration snapshot from Walrus Memory. |

After each week resolves, the memory arm writes a lesson for each forecast that missed by at least 0.45, and one calibration snapshot once 8 or more forecasts have resolved. It writes before forecasting the next week, so the writes are indexed in time.

## Leakage controls

- **Anonymised prompts.** No tickers, dates, weekdays, volumes or absolute prices. Assets are "Asset A" to "Asset D", and prices are rebased so the decision-day close is 100. A test asserts this on rendered prompts.
- **Point-in-time memory.** Each run uses fresh namespaces and processes weeks in order, and a lesson is written only at its question's resolve date. A test replays a small run and checks every recalled memory. The same check on the official run's real data found none of 1,536 recalled memories dated after its decision.
- **Reflection sees the future only to write the lesson.** A question's lesson never reaches that question's own forecast.

## Tuning

Only three settings could be tuned, only on dev, with at most three runs. The rule was fixed before any tuning run (D38): adopt a non-default value only if its mean paired gain beats the noise floor, the spread between no-memory passes. Neither tested change did (D43, D44), so the official run used the defaults: threshold 0.45, recall limit 5, max distance 0.8.

## Metrics

- **Brier score:** mean squared error of the probability. Lower is better; always saying 0.5 scores 0.25.
- **Log loss**, with probabilities clipped to [0.02, 0.98].
- **Accuracy** at 0.5.
- **ECE:** expected calibration error over 10 equal-width bins.
- **Brier skill vs base:** 1 − Brier(arm) / Brier(base).
- **Learning curve:** rolling mean Brier over the last 24 questions, by decision date, plus the cumulative mean.

Every metric uses the set of resolved questions that every arm forecast.

## Statistical test

The headline is the memory ON vs OFF paired difference on the test split. Questions in one week are correlated, so the bootstrap resamples whole decision weeks: 2,000 resamples, seed 42. It reports the mean difference, the 95% interval and the share of resamples above zero. A positive difference means memory did better.

The A/A comparison (second OFF pass vs first) gets the same treatment, so the headline can be read against the model's own noise.

## Memory influence

For each memory forecast that cited at least one lesson: shift = p(ON) − p(OFF), and gain = Brier(OFF) − Brier(ON). These are aggregated per lesson. Citation is the model's own report, not a causal test: a forecast that cites a lesson might have landed in the same place without it. Every memory forecast also sees the calibration snapshot, so the design cannot separate lessons from calibration.

## Live mode

A daily job fetches the last closed candle, resolves due forecasts, forecasts every asset and question type, and writes each forecast to Walrus Memory before publishing it. Forecasts carry their commit timestamp and blob ID.

- **Commit timing.** The job is scheduled for 00:17 UTC, but GitHub runs it around 06:00 to 07:00 UTC. A forecast's decision uses the prior day's close, so it commits some hours into its first day. The model does not see those hours, but a reader should not treat the commitment as made at the close.
- **Lessons cutover.** The official run's lessons were added to live recall on 2026-11-06 at 16:01 UTC. Forecasts for decision days before 2026-11-06 could recall only live lessons.

## Honest limitations

- **Small sample.** 160 test questions over 20 weeks. Four crypto assets move together, so the effective sample is smaller still.
- **One market, one horizon.** Nothing here shows the approach works elsewhere.
- **LLM noise.** The model is not deterministic at temperature 0. Identical passes give different scores, by amounts comparable to the headline effect.
- **One run.** There is one official run by design, which rules out picking a good one but leaves run-to-run variation in the memory arm itself unmeasured.
- **Possible recognition.** Anonymisation removes labels, not shapes. A model could still recognise a market from its price path.
- **Managed relayer.** It sees memory text in plaintext when embedding. Stored blobs are encrypted.
- **A tuning mistake (D42).** A dev run was resumed without its limit and forecast test weeks in the base and no-memory arms only. It was stopped, was never scored, and no memory arm forecast or memory write touched the test split. Guards now refuse this.
