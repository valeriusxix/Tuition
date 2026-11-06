# Decisions and deviations from AGENT.md

A running log of every place the build differs from AGENT.md, with the date and the reason (AGENT.md §18).
Newest entries at the bottom of each day.

## 2026-10-29 (Day 1)

**D1. File name.** Renamed `Agent.Md` to `AGENT.md` to match §2. `CLAUDE.md` is a byte-identical copy.

**D2. Existing scaffold moved into `web/`.** The repo root held a `create-vite` React template (JavaScript, ESLint, React Compiler). It is now the `web/` workspace and converted to TypeScript, so the root can be the npm-workspaces root required by §2.
- Kept **React 19.3** instead of §1's React 18. It was already installed, and Recharts 3 and React Router 7 support it. *Pending the owner's confirmation; switching to 18 is a two-line change.*
- Dropped the template's ESLint config and the React Compiler Babel plugin. Neither is in the §1 stack, and both slow the build. Strict `tsc` is the code-quality gate.
- Added Tailwind CSS v4 through `@tailwindcss/vite` (§1).

**D3. Node version gate.** `engines.node` is `^22.23.4 || ^24.22.1 || >=26.12.1`. §1 asks for ≥ 24.22.1 (or ≥ 22.23.4). The Walrus Memory SDK README (0.1.11) adds 26.12.1+ within 26.x. Odd, end-of-life majors (23, 25) are rejected. The SDK's own `engines` field only says `>=20` ("API compatibility, not the minimum security patch").

**D4. Layout additions** (nothing in §2 was removed):
- `engine/src/probes/`: the six Phase 0 probes. `cli.ts` routes to them and loads each lazily, after the Node check.
- `engine/src/paths.ts`, `engine/src/errors.ts`, `engine/src/util/node.ts`: small helpers.
- `web/scripts/check-no-secrets.mjs`: the §15 CI guard. It also runs before every `npm run build`, so a leak fails locally too. It additionally forbids importing engine code (§12).
- `web/tsconfig.node.json`: keeps Node types out of the browser code.
- Root npm aliases for the six probes, so `npm run probe:node` works from the root as written in §4.

**D5. Required variables are enforced per command.** `config.ts` parses the four secrets as optional, and each command calls `requireEnv([...])` for exactly what it needs. This lets tests, CI, `score`, `export` and `--dry` run without keys, while a real command still fails fast and names the variable and where to get it (§3). Blank values (as in a copied `.env.example`) count as unset. A `MEMWAL_SERVER_URL` containing "staging" is rejected.

**D6. Two fields added to §5 types.**
- `Question.skipped?: string`: the reason a question is excluded. §6.1 needs a way to mark gap-affected questions.
- `MemoryLedgerEntry.createdSimDate?: string`: §7.4 says the ledger records it, and the leakage test needs it.

**D7. Retry semantics.** "3 attempts with backoff (1s, 4s, 10s)" (§7.7) is implemented as up to 3 retries after the first try (4 calls at most), waiting 1s, 4s and 10s. Only network errors, timeouts, HTTP 429 and 5xx are retried. A longer server `Retry-After` is honoured up to 10 minutes; anything longer is rethrown. The Anthropic client runs with `maxRetries: 0`, so `util/retry.ts` is the only retry layer.

**D8. smoke:memwal additions.**
- It passes an explicit `idempotencyKey` (`sha256("smoke:smoke:<timestamp>")`) to `rememberAndWait`, so a retried write collapses onto the same relayer job instead of writing twice.
- It appends the write to `engine/state/ledger-smoke.jsonl` (kind `smoke`).
- It also saves `memwal.compatibility()` (relayer API version metadata) to fixtures.

**D9. Walrus Memory SDK facts.** Read from the `@mysten-incubation/memwal@0.1.11` type definitions (pinned exactly, because the SDK is in beta and moves daily). They get applied in `memory/store.ts` on Day 3.
- `waitForRememberJob()` resolves to `RememberResult { id, job_id?, blob_id, owner, namespace }` and throws `MemWalRememberJobFailedError` / `MemWalRememberJobTimeoutError`. There is no `status` field, so §7.7's `status.status === "done"` check becomes "resolved with a non-empty `blob_id`".
- `getPublicKeyHex()` is async.
- `recall()` supports `maxDistance` (drops distance ≥ value), `sort: "recent"` and `limit` ≤ 100. Results carry an optional `created_at`.
- Relayer errors carry `.status`, `.serverCode` (`AUTH_REJECTED` on 401) and `.retryAfterSeconds`.
- Idempotency keys are scoped per (owner, namespace). The SDK documents a 30-minute retry window for server-side dedupe, so the local ledger stays the long-term guard against double writes.

**D10. Walrus aggregator confirmed (§3, §4.5).** docs.wal.app → Network Reference lists `https://aggregator.walrus-mainnet.walrus.space` as the Mysten Labs mainnet reference aggregator. Reading Blobs documents `GET $AGGREGATOR/v1/blobs/<BLOB_ID>` (and `/v1/blobs/by-object-id/<OBJECT_ID>`). A just-certified blob can briefly return a CDN-cached 404, so retry with backoff. The docs give **no** explorer URL pattern for a blob ID. The pattern for §11.6 is still open: it will be checked against the real smoke blob ID before being stored as a constant.

**D11. Tatum OHLCV batch shape.** It is a GET with query parameters `symbol`, `timeFrom` (ISO-8601 UTC), `numberOfCandles` (1–50) and `interval`. Third-party reports say it returns candles with `openTime ≥ timeFrom` in ascending order, with decimal-string prices. The official reference page documents only the single-candle endpoint. `probe:ohlcv` records the real response before any parser is written.

**D12. TypeScript 7.0.2** is installed in each workspace. The root `node_modules` also has TypeScript 6.0.3, a runtime dependency of `@mysten/sui` → `gql.tada`. Workspace scripts use their own 7.0.2.

## 2026-10-31 (Day 1, continued)

**D13. Walrus Memory SDK 0.1.12.** The owner installed `@mysten-incubation/memwal@^0.1.12` at the repo root (released 2026-10-30). Its type definitions (`memwal`, `types`, `errors`, `index`) are identical to 0.1.11's, and its Node requirement is unchanged. The engine pin moved to exactly `0.1.12`, so only one copy is installed. The root-level dependency entry is redundant but harmless.

**D14. Sui reads go through Tatum's GraphQL endpoint, not JSON-RPC (§4.4, §11).** Evidence:
- `POST https://sui-mainnet.gateway.tatum.io` with `sui_getObject` returns `HTTP 404 {"statusCode":404,"message":"Not Found"}` (`fixtures/sui-getObject-account.json`).
- The gateway's own `/_methods` lists only `sui-mainnet-graphql` at `/graphql` (`fixtures/sui-gateway-methods.json`). Sui retired JSON-RPC on full nodes in late July 2026.

§4.4 names Tatum's gRPC endpoint as the fallback. That host (`sui-mainnet-grpc.gateway.tatum.io`) speaks native gRPC only: `@mysten/sui`'s gRPC-web client fails with "unexpected response content type: application/grpc". Using it would need `@grpc/grpc-js` plus a transport package. GraphQL is served by the same Tatum host that `TATUM_SUI_RPC_URL` already points at, so it's plain HTTPS with no new dependencies, and it returns everything §11 needs: objectId, version, digest, type, owner kind and the full content (`fixtures/sui-graphql-account.json`). This follows AGENT.md's rule that the live response wins.

**D15. §11.2 delegate-key search also checks base64.** Sui GraphQL renders `vector<u8>` public keys as base64 (`delegate_keys[].public_key`), so `findDelegateKey` checks base64 as well as hex and byte arrays.

**D16. LLM calls go through the Orbio gateway (owner's choice).** This uses the same `@anthropic-ai/sdk`, pointed at Orbio's Anthropic-compatible endpoint through the new optional `ANTHROPIC_BASE_URL` (default `https://api.anthropic.com`). Model IDs are OpenRouter IDs:
- `FORECAST_MODEL=anthropic/claude-haiku-5.5`
- `REFLECT_MODEL=anthropic/claude-sonnet-5.5`

Per-token prices equal Anthropic's list prices ($0.10/$0.50 and $2/$10 per MTok). What `probe:llm` showed through Orbio (`fixtures/llm-*.json`):
- Both model IDs are accepted.
- Structured output (`output_config.format`) and `effort` work.
- No thinking blocks are returned (`thinking_tokens: 0`).
- Each response reports its exact `usage.cost`.
- `temperature: 0` is accepted by the gateway (see D17).

Anyone can still run against Anthropic directly by leaving `ANTHROPIC_BASE_URL` unset and using `claude-haiku-5-5` / `claude-sonnet-5-5`.

*Risk noted to the owner:* an Orbio key has no per-key spending cap and can spend the whole account balance, so it must never appear in logs or committed files. The engine registers it for redaction, and GitHub masks it in Actions logs.

**D17. No `temperature` parameter (§7.1, §7.10).** Claude Haiku 5.5 and Sonnet 5.5 reject non-default sampling on the Anthropic API, and SDK 1.x (API version 2026-10-21) rejects `temperature` on every model. Through Orbio the parameter is accepted but almost certainly dropped. Either way it can't make the arms deterministic, so it is not sent. Both LLM arms still share model, prompt template, settings and question order. To measure sampling noise honestly, the experiment adds a replicate arm (D18).

**D18. Owner decisions on the open proposals** (raised 2026-10-29, confirmed 2026-10-31):
- **React 19 kept** (closes D2's pending item).
- **Base arm uses Laplace smoothing:** `p = (k+1)/(n+2)` over that type × symbol's questions resolved by the decision date. With n = 0 it gives exactly the 0.5 that §7.1 asks for, and it never clamps to 0.02/0.98 after a single question.
- **A/A replicate arm `nomem2`:** a second, independent `nomem` pass over the same questions. The `nomem` vs `nomem2` Brier gap (same bootstrap) is the noise floor that the memory effect is judged against.
- Accepted by default (no objection):
  - Forecast settings: effort `low`, `max_tokens` 2048, schema-constrained JSON plus zod.
  - Prompts carry only memory *bodies* plus blobIds, never headers. Lesson bodies containing a ticker or date are rejected, and `prompt.test.ts` covers recalled memories.
  - Recall keeps memories from an allowed set of runs per context and drops any with `sim` after the decision date.
  - The live ledger is `engine/state/live-ledger.jsonl`, and the live job commits `engine/state/live-*`.
  - Calibration text says "my P(YES) was too LOW/HIGH by X".

Each of these is implemented on the day its module is built.

**D19. Expected lesson volume (informational).** At `LESSON_ERROR_THRESHOLD=0.45`, every forecast in [0.45, 0.55] writes a lesson whatever the outcome. Expect about 150–175 lessons plus 32 snapshots per full run, which fits the relayer's write rate.

## 2026-11-01 (Day 2)

**D20. BREAKOUT base rate is 0.371, outside the §16 target of 0.4–0.6.** It is 0.365 in dev and 0.375 in test, from 132 resolved BREAKOUT questions; DIRECTION is 0.455. This is not a bug: across all decision dates, the 180 trailing windows reach their own (rounded) median exactly 0.500 of the time, as the rule requires. The cause is a volatility regime shift. The 180 days behind the replay included turbulent months, with a mean absolute daily log return of 3.0–3.7% in Aug–Nov 2025 and Feb 2026. The replay months were calmer, at 1.7–2.5%. So forward 7-day excursions cleared the trailing median only 33–42% of the time, depending on the asset. AGENT.md's rule is **kept unchanged**: picking a different lookback after seeing these outcomes would fit the design to the evaluation period. The experiment is unaffected, since every arm answers the same questions, and a stable bias like this is exactly what the calibration snapshots and the Laplace base arm should pick up. *Flagged to the owner.*

**D21. Layout additions.** `engine/src/commands/` holds the CLI glue for `candles` and `questions`, so the pure modules (§18) stay free of I/O. `engine/test/helpers.ts` builds synthetic candles for the tests.

**D22. Skipped questions.** A decision date whose window has a candle gap or too little history (187 days before, plus 7 after for replay questions) produces no question. It is listed with its reason by `questions`; there are none in the current data. `Question.skipped` is kept for questions that exist but cannot be resolved later (live mode).

**D23. Candle cache coverage.** Each cache file records `requestedFrom`/`requestedTo`, and only days outside that range are ever fetched. In-progress days are never cached, and a day not yet published is retried on the next run. The Tatum key is on the FREE plan (`x-ttm-plan: FREE;ratelimit=3`, about 100k lifetime credits). The full history took 36 batch calls (about 18k credits) and covers 444 days per asset (2025-08-14 → 2026-10-31) with no gaps.

**D24. Edge guards and conventions.**
- `volRatio` is 1 when `vol30` is effectively 0.
- `volRegime` is "normal" when the 180-day median `vol7` is effectively 0. Both can only happen on synthetic series.
- Accuracy@0.5 gives half credit to an exact 0.5 forecast.
- Features are rounded to 2 decimals, but regime labels are taken from the unrounded values.

**D25. Line endings.** `.gitattributes` forces LF, so Windows commits and the Linux live bot produce identical files.

## 2026-11-01 (Day 3)

**D26. Live v1 scope.** `live` now does the following:
- Resolves due commitments.
- Creates today's questions, with the decision date set to the last closed candle.
- Recalls lessons from `LIVE_LESSON_NAMESPACES` plus `tuition.live.lessons`.
- Forecasts each question.
- Commits each forecast to `tuition.live.forecasts` on Walrus **before** exporting `web/public/data/live.json`.

Writing lessons and calibration snapshots for resolved live forecasts (the rest of §9 step 2) ships with `agent/reflect.ts` before the first resolution on 2026-11-08. Until then live forecasts have no lessons to recall. Recall errors are logged and the forecast goes ahead without that namespace, so a relayer hiccup can't block a day's commitments.

**D27. Live state and ledger files.** The state is `engine/state/live-forecasts.json`, written atomically after every single commitment. The ledger is `engine/state/live-ledger.jsonl` (D18). The workflow commits both, the candle cache and `web/public/data`, and its commit step runs `if: always()`, so memories written by a run that failed part-way still reach the ledger. Each idempotency key is `sha256("live:forecast:<questionId>")`.

**D28. Commitment text.** The §9.5 body names the BREAKOUT threshold (e.g. `FORECAST (BREAKOUT ±9.7%, Asset D, …)`) so each commitment can be checked on its own. The real symbol appears only in the header (`sym=`), as §9.5 asks.

**D29. Forecast output handling** (§7.10):
- `probability` must be in [0, 1] and is then clamped to [0.02, 0.98].
- The rationale is cut at 60 words rather than rejected.
- `cited_lessons` keeps only blob IDs that were actually shown to the model.
- One retry with the problem appended, then the forecast fails loudly.
- The memory-ON and memory-OFF prompts share one system prompt. Only the user message differs: the lessons block, or "No lessons are available."

**D30. Layout additions.** `engine/src/commands/live.ts` holds the CLI glue. `mapLimit` (bounded concurrency) lives in `util/ratelimit.ts`. `AUTH_HINT` moved to `memory/store.ts`, which owns the real-client factory, so the store doesn't import a probe.

**D31. Live preflight.** Every real `live` run first checks three things:
- relayer `health()`
- an authenticated `recall` on `tuition.live.lessons`, which proves the delegate key and account
- a 16-token model call, which proves the API key and model ID (about $0.000004)

A broken credential then fails the run immediately, even on a day with nothing new to commit. This also makes the first Actions run (Oct 31 was already committed by the local run) a real end-to-end credential test.

## 2026-11-04 (Day 4)

**D32. Replay checkpoint granularity.** §7.11 asks for an atomic checkpoint after every week. `engine/state/run-<runId>.json` is rewritten atomically after every forecast and every memory write as well, so a crash loses at most one in-flight call. A lesson's text is saved to the checkpoint **before** its Walrus write. Otherwise a resumed run would re-reflect, get different text, and the ledger (keyed by question) would pair the new text with the old blob ID. A resumed run writes the saved text as-is. Each arm's progress marker only advances once every write for that week is done.

**D33. Layout additions.** `engine/src/replay/checkpoint.ts` (checkpoint schema, run IDs, namespaces) and `engine/src/commands/replay.ts` (CLI glue). New tests: `reflect.test.ts`, `calibration.test.ts`, `leakage.test.ts`.

**D34. Reflection output handling (§7.5).** It follows the forecast rules (D17, D29): effort `low`, `max_tokens` 2048, schema-constrained JSON plus zod, no `temperature`.
- `lesson` and `applies_when` are cut at a word boundary to 280 / 120 characters rather than rejected.
- `magnitude` is clamped to [0, 0.3] and forced to 0 when `adjustment` is `none`.
- Text naming a configured ticker or a calendar date is invalid and retried once, like a schema failure.
- After the second failure the lesson is skipped. The skip is recorded in the checkpoint (or the live state) and never retried, so a resumed run makes no extra LLM calls.

**D35. Replay details.**
- `Arm` gains `nomem2` (D18). The default arms are `base,nomem,nomem2,mem`, run in that order.
- Outcomes reach the loop only through a date gate (`resolveDate ≤ D`). That holds even when another arm has already resolved later questions. Stored questions never carry an outcome.
- Recall keeps a memory only if it is this run's, of the expected kind, has `sim ≤ D`, and its body is prompt-safe. A dropped future memory is logged; `leakage.test.ts` plants one and checks it is dropped.
- The calibration snapshot is recalled once per week rather than once per question. Every question in a week would get the same snapshot anyway, so this only saves relayer calls.
- After the last week, that week's questions are resolved for scoring only. Nothing is forecast after them, so they write no lesson.
- Replay loads candles only through `REPLAY_END + HORIZON + 1`, so it never spends Tatum credits on recent days.
- `--resume` uses the checkpoint's config snapshot (models, dates, tuning parameters, seed) over the current environment and prints any setting that differs.
- `--official` refuses `--dry`, `--limit`, `MEMORY_BACKEND=memory`, a missing `base`/`nomem`/`mem` arm, and resuming a dev run as official.
- `--dry` and in-memory runs write their checkpoint to a temp directory and cannot be resumed, because their memory was lost with the process.
- A dev-split tuning run (§8.4) is `--limit 13`: the 13 Mondays from 2026-03-02 to 2026-05-25.
- A calibration snapshot drops its smallest-gap groups if all 8 would exceed the 1,000-character memory cap.

**D36. Live learning (completes D26, §9 step 2).** Each daily run now does the following:
- For every resolved live forecast that missed by at least `LESSON_ERROR_THRESHOLD`, it writes a lesson to `tuition.live.lessons` (`run=live`, `sim` = resolve date).
- Once 8 or more live forecasts have resolved, it writes one calibration snapshot per day to `tuition.live.calibration`, dated the last closed day.
- Live prompts also include the latest live calibration snapshot, matching the replay `mem` arm. §9.4 names only lessons. Live mode *is* the mem arm, and a snapshot that no prompt ever reads would be pointless.
- A failed reflection or snapshot write never blocks the day's commitments. It is logged, retried on the next run, and makes the CLI exit 1, so the Actions run shows red while its commit step (`if: always()`) still records everything written.
- The live state gains `calibrations` (it defaults to empty, so the committed file still parses) and, per record, `lesson` and `reflectionSkipped`.
- The preflight also pings the reflection model.

## 2026-11-05 (Day 4 exit, Day 5 tuning plan)

**D37. The Day 4 exit run is not a tuning run.** `r-20261105-0945-7e44` (`replay --limit 4`, 2026-03-02 → 2026-03-23) was the Day 4 exit check. It is not one of the three §8.4 tuning runs, and its Brier scores were not used to choose anything. Two facts from it shaped the tuning grid in D38:
- Lesson recall distances were 0.31–0.43 (median 0.344, n = 112). At 0.8, `RECALL_MAX_DISTANCE` filters nothing, so every question gets the full `RECALL_LIMIT` lessons.
- At `LESSON_ERROR_THRESHOLD` 0.45, 75% of mem-arm forecasts would write a lesson; at 0.55, 34%.

**D38. Tuning plan (§8.4), fixed before the first tuning run.**
- **Runs.** Three runs, each `replay --limit 13` (the 13 dev Mondays, 2026-03-02 → 2026-05-25) with arms base, nomem, nomem2 and mem. They run one after another, and each changes one setting:
  - **T1: defaults.** `LESSON_ERROR_THRESHOLD` 0.45, `RECALL_LIMIT` 5, `RECALL_MAX_DISTANCE` 0.8.
  - **T2: `LESSON_ERROR_THRESHOLD` 0.55.** The reason is stated without reference to outcomes: at 0.45, a forecast anywhere in [0.45, 0.55] writes a lesson whatever happens, and a coin-flip forecast is not a mistake to learn from. Expected side effect: forecasts sit between 0.2 and 0.6, so a miss of 0.55 or more is nearly always a YES the model rated low. In the D37 run, 30 of the 31 such misses across the three LLM arms were YES outcomes. T2's lessons will therefore mostly say "raise", and a T2 gain should be read as an upward nudge more than as sharper lessons.
  - **T3: `RECALL_MAX_DISTANCE` set to the median lesson-recall distance in T1's mem arm** (3 decimals). It is computed from distances only, before T3 runs. `RECALL_LIMIT` stays 5. The threshold is whichever of T1/T2 the rule below keeps.
- **Metric.** Dev-split mem-arm Brier on the same 104 questions, compared question by question with the current choice (T1, or T2 if T2 is adopted): `d = brier(mem_current) − brier(mem_candidate)`. The paired block bootstrap by decision week (`blockBootstrap`, 2,000 resamples, seed 42) is reported alongside.
- **Noise floor.** The range (max − min) of dev Brier across every no-memory pass so far: nomem and nomem2 of each tuning run, so four passes after T2 and six after T3.
- **Rule.** A non-default value is adopted only if its mean paired gain exceeds the noise floor; otherwise the default stays. The same rule applies to every setting. If T3 does not clear the floor, `RECALL_MAX_DISTANCE` stays 0.8, even though that means no filtering.
- **Expected outcome.** With 104 questions the likely result is "within noise, defaults kept". It will be reported exactly as it comes out.

**D39. `score` and `export` (§8, §10, §12.1).**
- **One question set for every arm.** Every metric is computed on the questions that every arm of the run forecast and that have resolved, so all arms are always scored on the same questions. For a complete run this is every question; for a run stopped part-way it is the overlap.
- **Comparisons.** Paired block bootstraps (2,000 resamples, seed `SEED`) are reported per split (all/dev/test) for:
  - mem vs nomem, the §8.3 headline
  - mem vs nomem2
  - nomem2 vs nomem, the A/A noise floor from D18
  - mem vs base and nomem vs base

  The headline is mem vs nomem on the test split. A run with no test weeks (a dev or tuning run) falls back to dev, and the `split` field always says which.
- **Memory influence (§8.5).** Citations and recalls are counted over every mem forecast. Shift and Brier gain use only scored questions. Cited blob IDs that are not lessons of this run are ignored.
- **`score --compare <ref>[,<run>…]`** implements the D38 rule: this run's mem arm against the first listed run's mem arm, question by question on the dev split. The noise floor is the Brier range of every listed run's nomem and nomem2 passes on those same questions.
- **Export safety.** `export` writes `summary`, `curve`, `reliability`, `questions` and `lessons`.
  - It validates all five against their shared schemas before writing any of them, then writes each atomically.
  - Non-integer numbers are rounded to 6 decimals before validation.
  - Only an official run goes to `web/public/data` by default. A dev or dry run needs an explicit `--out`, so tuning numbers can never replace the published results by accident.
  - The proof.json schema is defined with `verify` (§11), not here.
- **Additions to the §12.1 file contents.**
  - `questions.json` carries each question's rebased price path for the question page: closes from day −59 to +7 with day 0 = 100, plus the future highs and lows. It also shows the real ticker, which is shown only after the fact; the model only ever saw the asset code.
  - `lessons.json` also lists the run's calibration snapshots, so the question page can show every recalled memory by blob ID.
  - The mainnet memory count in `summary.json` is taken over every ledger in `engine/state` (replay runs, live and smoke), one per blob ID.
- **Layout additions:** `engine/src/score/report.ts` (pure), `engine/src/commands/score.ts`, `engine/src/commands/export.ts`. New tests: `report.test.ts` (hand-computed) and `export.test.ts` (a dry replay exported and read back).

**D40. Tuning log (§8.4).** All runs use `--limit 13` (104 dev questions) and the arms base, nomem, nomem2 and mem.
- **T1, `r-20261105-1041-51d2`: defaults** (threshold 0.45, limit 5, distance 0.8).
  - Brier: base 0.264, nomem 0.243, nomem2 0.244, mem 0.251.
  - Paired mem vs nomem: Δ −0.0085, 95% CI [−0.0343, +0.0149], P(Δ>0) 0.25.
  - By type, mem hurt DIRECTION (0.259 vs 0.245) and was neutral on BREAKOUT (0.243 vs 0.240).
  - Memory activity: 66 lessons and 12 snapshots written; 48 of 104 mem forecasts cited a lesson. Cost $0.50.
- **T3's distance cutoff is now fixed at 0.347,** the median of T1's 480 lesson-recall distances (0.294–0.478; exact median 0.3465). It was computed from distances only and recorded before T2's results.
- **Caveat, noted before T2 and T3 report.** In T1 the two no-memory passes differ by only 0.0018, so the D38 noise floor will be small. It measures sampling noise on fixed prompts, not how much the mem arm itself varies from run to run: different lessons early can change everything after. The rule stands as registered. Any "adopt" verdict will be reported with this caveat.

**D41. LLM connection errors are now retried.** Tuning run T2 stopped during the nomem2 arm, at its 4th week, with `Error: Connection error.`, and nothing had retried it. The Anthropic SDK wraps a network failure as `APIConnectionError`. It has no status, its name is plain `Error`, and the socket code sits two `cause` levels down (or there is no cause at all for `APIConnectionTimeoutError`). So it slipped past `isRetryableError`, contrary to D7. Two fixes:
- `isNetworkError` now walks the whole cause chain.
- Every Claude call (forecast, reflect and both pings) uses `isRetryableClaudeError`, which also accepts the SDK's connection error classes.

Regression tests in `retry.test.ts` use the exact failure shape. Nothing about how forecasts are produced changed. The live job uses the same forecaster, so it is covered too. Resuming that T2 went wrong; see D42.

**D42. A dev run can no longer reach the test split.**
- **What happened.** After D41 I resumed T2 (`r-20261105-1105-ab7a`) without repeating `--limit 13`. `--resume` did not remember the limit, and nothing stopped a dev run from continuing past the dev split, so it started on all 33 weeks. I saw that in its log about a minute later and stopped it. By then the base arm (no LLM) had reached every test week and nomem had forecast 5 test weeks (40 questions, 2026-06-01 → 2026-06-29). nomem2 and mem never left the dev weeks. The run wrote no memories, so no test-week outcome reached a lesson, a snapshot or a mem forecast.
- **What was seen.** Progress lines showing each week's mean forecast. No test-split score was computed or viewed.
- **What was done with it.** That run is abandoned. It produced no mem-arm result, so it is not one of the three §8.4 tuning runs, and it will never be scored. Its checkpoint is committed unchanged as the record. T2 was restarted from nothing as `r-20261105-1114-3131`.
- **Test-split integrity.** The tuned settings act only on the mem arm, and the official run starts with a fresh run ID, fresh namespaces and its own forecasts, so nothing from the abandoned run feeds it. Test-split outcomes were already in the committed candle cache. What matters is that no setting was chosen after seeing a test score, and none was.
- **The fix.**
  - The checkpoint now records its `limit`, and a resume keeps it. Asking for a different limit is refused.
  - A dev run that would cover any week after `DEV_SPLIT_END` is refused before anything is written or called. That covers new runs and resumes of older checkpoints that never recorded a limit.
  - Only `--official` forecasts test weeks. Dry runs are exempt because their stub LLM shows nothing about the test split.

  Both rules have tests in `leakage.test.ts` (including this exact case), and I confirmed both on the real CLI.

## 2026-11-06 (Day 5 tuning, continued)

**D43. Tuning log, continued from D40.**
- **T2, `r-20261105-1114-3131`: threshold 0.55** (limit 5, distance 0.8). It replaces the abandoned attempt in D42. The system stopped it after two mem weeks when the machine ran low on memory, and it was resumed from its checkpoint with its saved limit and threshold.
  - Brier: base 0.264, nomem 0.252, nomem2 0.251, mem 0.255.
  - Paired mem vs nomem: Δ −0.0022, 95% CI [−0.0247, +0.0208].
  - Memory activity: 25 lessons (19 raise, 3 lower, 3 none, as D38 predicted) and 12 snapshots; 36 of 104 mem forecasts cited a lesson. Cost $0.25.
- **Rule applied (D38): T2 is not adopted, and the threshold stays 0.45.** Against T1, the paired gain is −0.0036, 95% CI [−0.0147, +0.0077]. That does not exceed the noise floor of 0.0098, the range of four no-memory passes (0.243, 0.244, 0.252, 0.251).
- **The noise floor came out larger than D40 expected.** The D40 caveat was written when only T1's two passes existed, and they happened to agree closely. Forecast disagreement is about the same within and between runs: the mean |Δp| is 0.029–0.034 for all six pairs of passes. So there is no sign of a run-level effect, and the 0.0018 gaps within each run were chance.
- **Run comparability checked.** All tuning runs have the same 264 questions in every field and in the same order.
- **T3, `r-20261106-0910-5942`:** threshold 0.45, limit 5, distance 0.347, as fixed in D40.

**D44. Tuning result (§8.4): the defaults stay.**
- **T3, `r-20261106-0910-5942`: distance cutoff 0.347** (threshold 0.45, limit 5). The system stopped it after 8 mem weeks when the machine ran low on memory, and it was resumed in the foreground from its checkpoint.
  - Brier: base 0.264, nomem 0.248, nomem2 0.252, mem 0.256.
  - Paired mem vs nomem: Δ −0.0081, 95% CI [−0.0305, +0.0086].
  - Memory activity: 67 lessons and 12 snapshots; 340 lessons recalled against T1's 480, so the cutoff did filter; 30 of 104 mem forecasts cited a lesson. Cost $0.50.
- **Rule applied (D38): T3 is not adopted.** Against T1, the paired gain is −0.0047, 95% CI [−0.0178, +0.0091]. That does not exceed the noise floor of 0.0098, the range of six no-memory passes (0.243, 0.244, 0.252, 0.251, 0.248, 0.252).
- **Settings for the official run:** `LESSON_ERROR_THRESHOLD` 0.45, `RECALL_LIMIT` 5, `RECALL_MAX_DISTANCE` 0.8. This is the "within noise, defaults kept" outcome D38 expected. With 0.8 no recalled lesson is filtered out by distance.
- **Reported as it came out.** In all three runs the mem arm scored worse than the same run's no-memory passes on the dev split (mem 0.251, 0.255, 0.256; mean of the six no-memory passes 0.247). Every paired confidence interval for mem vs nomem includes zero. Dev is not the headline (§8.4), memory built up in dev carries into test, and the design is unchanged. If the test split shows the same, the README says so (§18).
- **Tuning runs used:** 3 of 3. The abandoned attempt in D42 is not counted.
- **Tuning runs verified.** Across T1, T2 and T3:
  - Every ledger matches its checkpoint, with no duplicate writes.
  - All 194 blobs return HTTP 200 from the Walrus mainnet aggregator.
  - No recalled memory is dated after its forecast's decision date.
  - No forecast falls after the dev split.
  - No secret appears in the committed state files.

## 2026-11-06 (Day 6, the official run)

**D45. The official run runs in GitHub Actions.** The owner chose this after low memory on the 8 GB laptop stopped T2 and T3. §1 allows long jobs in Actions. `official.yml` is dispatched by hand.
- **`mode=smoke`** is a 2-week dev replay with real credentials, proving the workflow first. It stays inside the dev split and is not a tuning run, so nothing is chosen from it. Its memories are real mainnet writes, so its ledger is committed like any other.
- **`mode=official`** is `replay --official`, with the settings from D44 set explicitly.
- **Nothing can be lost with the runner.** Checkpoint and ledger are pushed to the `official-state` branch every 10 minutes and again at the end. The final state is committed to `main` even if the run fails. `resume` restores them from that branch.
- **One official run.** A new official run is refused if a checkpoint with mode official exists on `main` or the state branch exists, so an official run can only be resumed, never redone.

**D46. The official run: result and what it does and does not show.** Run `r-20261106-1001-f2a8`, GitHub Actions run 42199428492, settings from D44 (0.45 / 5 / 0.8), started once and never resumed. 264 questions in every arm, 181 lessons and 32 calibration snapshots on mainnet, no reflection skipped, LLM cost about $1.34.
- **Headline (test split, 160 questions, 20 weeks).** Brier memory OFF 0.267, ON 0.258. Δ = +0.0089, 95% CI [−0.0134, +0.0325], P(Δ>0) = 0.77. **The interval spans zero: memory did not show a statistically significant improvement.**
- **Noise scale.** The two identical no-memory passes differ by +0.0052 on the test split (nomem2 vs nomem), about 60% of the headline effect. Against the other pass, memory gains only +0.0037 (CI [−0.0174, +0.0261]).
- **Versus base.** Memory ties the no-LLM trailing base rate on the test split (0.258 vs 0.259, Δ = +0.0010). Both no-memory passes lose to it (0.267, 0.262). Every LLM arm loses to base on BREAKOUT (base 0.245; nomem 0.280, nomem2 0.270, mem 0.262) and beats it on DIRECTION (0.254 each vs 0.273). Memory's BREAKOUT score is the best of the LLM arms.
- **Lessons do not explain the gain.** Over all weeks, 100 of 264 memory forecasts cited a lesson. Those had a mean Brier gain of −0.0061; forecasts citing none had +0.0182. The published text must not claim that cited lessons drove the difference.
- **Dev tuning did not predict this.** In T1–T3 memory scored worse than no memory on dev; in this run it scored better on dev (0.248 vs 0.257). The swing is within the noise found in D44.
- **Verified.** Ledger and checkpoint agree (213 entries, no duplicate key or blob), and 0 of 1,536 recalled memories are dated after their decision date. Blob availability is covered by `verify` (D47).

**D47. `verify`, `memories` and the rest of §11.**
- `tatum/sui.ts` holds the GraphQL account read (D14), now shared by `probe:sui` and `verify`.
- `verify --run <id>` covers the run ledger and the live ledger, not the smaller tuning and smoke ledgers. Those are in the mainnet counts and were checked in D44.
- **Blob explorer link (closes D10).** walruscan.com returns the same empty HTML shell for every path, so no blob URL pattern could be confirmed. Blob links use the aggregator URL `{WALRUS_AGGREGATOR_URL}/v1/blobs/{blobId}`, the same URL the check fetches, rather than a guessed pattern.
- A blob that is not 200 is rechecked once after a pause, because a recent blob can briefly 404 through the CDN (D10). Anything still failing is recorded as failed and `verify` exits non-zero.
- The recall round-trip takes three seeded-random lessons and records whether the top hit matched. It is not retried until it matches.
- `LIVE_LESSON_NAMESPACES` was set to the official lessons at 2026-11-06 16:01 UTC. Live forecasts made before then did not recall the official lessons; those from the next scheduled run onward do.

**D48. The site, the docs and the daily refresh.**
- **Web app.** All seven pages of §12.2 are built. Every data file is validated on load, and each page has a loading and an error state. Checked at a true 375 px in a browser: no page scrolls sideways. Chart colors passed the palette validator on the dark surface, so memory OFF carries a second hue beside the one UI accent.
- **`vercel.json` is at the repo root**, not in `web/`, so importing the repo needs no root-directory setting. It rewrites unknown paths to `index.html` so `/questions/:id` works on a direct link.
- **Generated docs.** `export --docs` fills marked blocks in README.md and BLOG_DRAFT.md from summary.json and proof.json. A missing marker is an error. The verdict wording lives in `shared/src/verdict.ts` and depends only on the interval, so the site, README and blog cannot claim more than it shows.
- **Deviation from §9.** The live job also runs `verify` and `export` after forecasting, so the site's counts and proof stay current through submission. That step cannot stop the day's forecasts from being committed.
- **Second-pass arm in the charts.** The learning curve also shows the A/A pass, which §12.2 did not ask for, because it sizes the noise behind the headline.

**D49. Atomic writes retry on Windows.** The full test suite started failing locally with `EPERM` on the checkpoint's tmp-and-rename, a different number of tests each run. Renaming over a file another process has briefly open fails on Windows, and the tests rewrite one file many times quickly. Real replays use the same line, so `util/atomic.ts` now retries `EPERM`, `EACCES` and `EBUSY` for up to about half a second, and checkpoint, live, export and verify all use it. Other errors still throw at once. Linux is unaffected, and no published data changed.

**D50. Corrections after the final review of D48.**
- **The daily job no longer commits README.md or BLOG_DRAFT.md,** as first shipped in D48. Those files are about to be edited by hand, and a conflict would fail the job's rebase and could keep that day's live ledger off `main`, which risks a later double write. Filling them is now the explicit `export --docs`.
- **`docs/links.json`** holds the demo, video and blog URLs, and `export --docs` writes the README links and the blog checklist item from it.
- **`verify` holds back blobs under 30 minutes old** until its next run. The daily job checks right after writing, and a fresh blob can return a cached 404 (D10), which would have shown a false failure on `/verify`.
- **Live recall of the official lessons was tested on mainnet** before any scheduled run used it: a read-only check on all 8 questions for decision day 2026-11-05 returned 40 prompt-safe lessons, all from the official run.
- **Mixed periods are labelled.** The influence figures cover all 33 weeks; the headline and the breakout gap cover the test split. The README, Method page and blog draft now say which is which.
