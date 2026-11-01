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
