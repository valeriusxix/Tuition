# AGENT.md — Tuition

> **Working name:** Tuition (rename with a project-wide find/replace if a different name is chosen).
> **Tagline:** *The market charges tuition. Tuition keeps the notes.*
> **Hackathon:** Total Recall (Tatum × Walrus Foundation) — Track 1: Markets & Sports Prediction. Also targets *Best Walrus Memory*.
> **Hard deadline:** 2026-11-10 17:00 UTC (submission form + public blog post).

This file is the single source of truth for building the product. Read it fully before writing code. When this file and your own assumptions disagree, this file wins. When this file and a **live API response** disagree, the live response wins: record the real shape in `engine/fixtures/`, update the parser, and note the change in `docs/DECISIONS.md`.

---

## 0. What we are building (one paragraph)

Tuition is an AI forecasting agent for crypto prices that **learns from its own mistakes and proves it**. It answers binary questions about where an asset will be in 7 days. After each question resolves, it writes a short post-mortem *lesson* and a *calibration snapshot* to **Walrus Memory on Sui mainnet**. Before each new forecast it recalls the lessons that match the current market regime. The core deliverable is an **A/B experiment**: the same model answers the same historical questions twice, once with memory OFF and once with memory ON, in strict chronological order, and we publish the difference in Brier score with a confidence interval. A small web app shows the learning curve, the calibration chart, every lesson (with its Walrus blob ID), per-question "what changed because of memory", live daily forecasts committed to Walrus before their outcome is known, and an on-chain verification page using **Tatum's Sui RPC**.

### Why this design (keep these properties; do not "simplify" them away)

1. **Proof over claims.** The memory-ON vs memory-OFF comparison on identical questions is the product. Everything else supports it.
2. **No lookahead leakage.** LLMs may have memorised historical prices. Every prompt uses anonymised, rebased data with no tickers and no dates (§6.3). Memory only contains information that was knowable at the simulated decision time (§7.4).
3. **Walrus is the system of record for what the agent learned.** Lessons and calibration notes live in Walrus Memory; the agent reads them back through `recall()`. Local files are a cache/ledger, never the source the agent reasons from.
4. **Honest reporting.** Report whatever the numbers are, including if memory does not help on some slice. Never cherry-pick runs.

---

## 1. Tech stack (fixed)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Node.js ≥ 24.22.1** (or ≥ 22.23.4) | Walrus Memory SDK requires these minimums. Add an `engines` field and a startup check that exits with a clear message. |
| Language | TypeScript (strict) everywhere | `"strict": true`, `"noUncheckedIndexedAccess": true` |
| Repo | npm workspaces: `shared`, `engine`, `web` | One `package-lock.json` at root |
| Engine | Node CLI run with `tsx` | No server. Long jobs run locally or in GitHub Actions |
| LLM | Anthropic Claude via `@anthropic-ai/sdk` | Forecast model default `claude-haiku-5-5`; reflection model default `claude-sonnet-5-5`; both overridable by env |
| Memory | `@mysten-incubation/memwal` + peer deps `@mysten/sui @mysten/seal` | Peers are **required** even for the default client: `recall()` crashes with "Cannot find package '@mysten/seal'" without them |
| Chain reads | Tatum Sui mainnet RPC gateway `https://sui-mainnet.gateway.tatum.io` | Header `x-api-key` |
| Price data | Tatum Data API OHLCV | `GET https://api.tatum.io/v4/data/rate/symbol/OHLCV/batch` |
| Validation | `zod` | Parse every external response and every LLM output |
| Tests | `vitest` | Pure modules must be unit-tested |
| Web | Vite + React 18 + TypeScript + Tailwind CSS v4 (`@tailwindcss/vite`) + Recharts + React Router | Static site; reads JSON from `web/public/data/` |
| Hosting | Vercel (static build of `web/`) | No secrets in the web build, ever |
| Automation | GitHub Actions (daily live job) | Commits refreshed JSON; Vercel redeploys |

Do **not** add a database, a backend server, Next.js, or authentication. They are out of scope.

---

## 2. Repository layout (create exactly this)

```
tuition/
├─ AGENT.md                      # this file (also copy to CLAUDE.md)
├─ README.md                     # judge-facing; see §13
├─ package.json                  # workspaces: ["shared","engine","web"]; engines.node
├─ tsconfig.base.json
├─ .env.example                  # every variable in §3, no real values
├─ .gitignore                    # .env*, !.env.example, node_modules, dist, engine/state/*.tmp
├─ .github/workflows/
│  ├─ ci.yml                     # typecheck + test + web build on PR/push
│  └─ live.yml                   # daily live forecasting job (§9)
├─ docs/
│  ├─ DECISIONS.md               # running log of any deviation from this file
│  ├─ METHODOLOGY.md             # generated/maintained; §8 in plain words
│  └─ BLOG_DRAFT.md              # skeleton for the required blog post (§14)
├─ shared/
│  ├─ package.json               # name "@tuition/shared"
│  └─ src/
│     ├─ types.ts                # ALL cross-package types (§5)
│     ├─ schemas.ts              # zod schemas for the web data files (§12.1)
│     └─ index.ts
├─ engine/
│  ├─ package.json               # name "@tuition/engine"; scripts in §10
│  ├─ fixtures/                  # recorded real API responses (probe outputs)
│  ├─ data/candles/              # cached daily candles: {SYMBOL}-1d.json (committed)
│  ├─ state/                     # run checkpoints + memory ledgers (committed, no secrets)
│  ├─ src/
│  │  ├─ cli.ts                  # command router (§10)
│  │  ├─ config.ts               # zod-validated env (§3)
│  │  ├─ log.ts                  # tiny structured logger
│  │  ├─ util/{ratelimit.ts,retry.ts,hash.ts,dates.ts,rng.ts}
│  │  ├─ tatum/ohlcv.ts          # §6.1
│  │  ├─ tatum/sui.ts            # §11
│  │  ├─ data/candles.ts         # fetch + cache + integrity checks
│  │  ├─ features/regime.ts      # §6.2 (pure)
│  │  ├─ questions/generate.ts   # §6.3 (pure)
│  │  ├─ questions/resolve.ts    # (pure)
│  │  ├─ prompt/render.ts        # anonymised prompt rendering (pure)
│  │  ├─ agent/forecast.ts       # LLM forecast call
│  │  ├─ agent/reflect.ts        # LLM post-mortem → lesson
│  │  ├─ memory/store.ts         # MemoryStore interface + WalrusMemoryStore + InMemoryStore
│  │  ├─ memory/format.ts        # memory text header encode/decode (pure)
│  │  ├─ memory/calibration.ts   # calibration snapshot builder (pure)
│  │  ├─ memory/ledger.ts        # local append-only ledger of writes
│  │  ├─ score/metrics.ts        # Brier, log loss, ECE, reliability, bootstrap (pure)
│  │  ├─ replay/run.ts           # §7 the A/B experiment
│  │  ├─ live/daily.ts           # §9
│  │  ├─ verify/proof.ts         # §11
│  │  └─ publish/export.ts       # writes web/public/data/*.json (§12.1)
│  └─ test/                      # vitest specs (§15)
└─ web/
   ├─ package.json               # name "@tuition/web"
   ├─ index.html
   ├─ vite.config.ts
   ├─ public/data/               # JSON written by engine/publish (committed)
   └─ src/ …                     # §12
```

---

## 3. Environment variables

All parsed in `engine/src/config.ts` with zod. Missing required values must fail fast with a message naming the variable and where to get it.

| Variable | Required | Default | Where to get it |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes (except `--dry`) | — | console.anthropic.com |
| `FORECAST_MODEL` | no | `claude-haiku-5-5` | — |
| `REFLECT_MODEL` | no | `claude-sonnet-5-5` | — |
| `TATUM_API_KEY` | yes | — | dashboard.tatum.io |
| `TATUM_OHLCV_BATCH_URL` | no | `https://api.tatum.io/v4/data/rate/symbol/OHLCV/batch` | — |
| `TATUM_OHLCV_URL` | no | `https://api.tatum.io/v4/data/rate/symbol/OHLCV` | — |
| `TATUM_SUI_RPC_URL` | no | `https://sui-mainnet.gateway.tatum.io` | — |
| `MEMWAL_PRIVATE_KEY` | yes | — | memory.walrus.xyz → SDK credentials (Ed25519 delegate key, hex) |
| `MEMWAL_ACCOUNT_ID` | yes | — | memory.walrus.xyz (account **object** ID, `0x` + 64 hex; NOT a wallet address) |
| `MEMWAL_SERVER_URL` | no | `https://relayer.memory.walrus.xyz` | Mainnet relayer. Never use the staging relayer with mainnet credentials |
| `WALRUS_AGGREGATOR_URL` | no | `https://aggregator.walrus-mainnet.walrus.space` | Confirm against docs.wal.app before first use; record in DECISIONS.md |
| `MEMORY_BACKEND` | no | `walrus` | `walrus` or `memory` (in-memory, tests/dry runs only) |
| `ASSETS` | no | `BTC,ETH,SOL,SUI` | Comma list of Tatum symbols |
| `REPLAY_START` | no | `2026-03-02` | First decision date (a Monday, UTC) |
| `REPLAY_END` | no | `2026-10-12` | Last decision date (a Monday, UTC) |
| `DEV_SPLIT_END` | no | `2026-05-25` | Decision dates ≤ this are "dev", after are "test" (§8.4) |
| `HORIZON_DAYS` | no | `7` | — |
| `MEMWAL_WRITE_CONCURRENCY` | no | `2` | — |
| `MEMWAL_MAX_WRITES_PER_HOUR` | no | `120` | Soft cap; the managed relayer applies usage limits |
| `LLM_CONCURRENCY` | no | `4` | — |
| `RECALL_LIMIT` | no | `5` | — |
| `RECALL_MAX_DISTANCE` | no | `0.8` | Calibrate in dev split; SDK has no default threshold |
| `LESSON_ERROR_THRESHOLD` | no | `0.45` | Write a lesson when `|p − outcome| ≥` this |
| `LIVE_LESSON_NAMESPACES` | no | (empty) | Comma list; set to the official run's lesson namespace after §7 completes |
| `SEED` | no | `42` | — |

`.env.example` must list all of these with comments. Secrets must never be prefixed `VITE_` and must never be read by `web/`.

---

## 4. Phase 0 — probes before any feature code (mandatory)

Do these first. Each probe is a script under `engine/src/cli.ts` and **saves the raw response** to `engine/fixtures/`. Parsers are written from these fixtures, not from guesses.

1. `npm run probe:node` — print `process.version`; exit 1 if below the minimum in §1.
2. `npm run smoke:memwal` —
   - `MemWal.create({ key, accountId, serverUrl, namespace: "tuition.smoke" })`
   - `await memwal.health()` → save to `fixtures/memwal-health.json`
   - `const res = await memwal.rememberAndWait("tuition smoke test " + new Date().toISOString(), "tuition.smoke", { timeoutMs: 60_000 })` → save (expect `{ id, job_id, blob_id, owner, namespace }`)
   - `await memwal.recall({ query: "tuition smoke test", namespace: "tuition.smoke", limit: 3 })` → save (expect `{ results: [{ blob_id, text, distance }], total }`)
   - Print `memwal.getPublicKeyHex()` labelled **MEMWAL_AGENT_ID (paste into the submission form)** and print `MEMWAL_ACCOUNT_ID`.
3. `npm run probe:ohlcv` — one batch call: `?symbol=BTC&timeFrom=2026-03-01T00:00:00Z&numberOfCandles=5&interval=1d` with headers `accept: application/json`, `x-api-key`. Save. Expected element fields: `symbol, openTime, closeTime, open, high, low, close` (+ volume); prices may be **decimal strings**; times may be epoch ms numbers or strings. `time`/`timeFrom` must be ISO-8601 UTC strings (epoch ms is rejected with HTTP 400). If `interval=1d` is rejected, fall back to `1h` and aggregate to daily in `data/candles.ts`; record in DECISIONS.md.
4. `npm run probe:sui` — JSON-RPC POST to `TATUM_SUI_RPC_URL` with `{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":[MEMWAL_ACCOUNT_ID,{"showType":true,"showOwner":true,"showContent":true}]}` and header `x-api-key`. Save. If the gateway reports JSON-RPC as unsupported/deprecated, switch to Tatum's Sui gRPC endpoint for the same read and record it in DECISIONS.md.
5. `npm run probe:aggregator` — `GET {WALRUS_AGGREGATOR_URL}/v1/blobs/{blob_id from step 2}`; save status code and byte length (content is encrypted — do not try to decode).
6. `npm run probe:llm` — one tiny Claude call with the forecast model; confirm the model ID is accepted.

Rate limits to respect from the start: Tatum free tier ≈ 3 requests/second (use a token bucket at 2.5 rps shared by OHLCV and Sui RPC). OHLCV batch costs ~500 credits per call (≤ 50 candles); single candle ~50 credits. Cache everything.

---

## 5. Shared types (`shared/src/types.ts`)

Implement exactly these (add fields only if needed, and document them in DECISIONS.md).

```ts
export type QuestionType = "DIRECTION" | "BREAKOUT";
export type Arm = "base" | "nomem" | "mem";
export type Split = "dev" | "test" | "live";
export type Trend = "up" | "down" | "flat";
export type VolRegime = "low" | "normal" | "high";
export type VolTrend = "expanding" | "contracting" | "stable";

export interface Candle {               // normalised daily candle, UTC
  t: number;                            // open time, epoch ms, 00:00:00Z
  open: number; high: number; low: number; close: number;
}

export interface Features {             // all computed from candles with t ≤ decision day close
  ret7: number;  ret30: number;         // % change, e.g. -4.2
  vol7: number;  vol30: number;         // stdev of daily log returns, in %
  volRatio: number;                     // vol7 / vol30
  smaDist20: number;                    // % distance of close from SMA20
  smaSlope20: number;                   // % change of SMA20 over last 5 days
  drawdown30: number;                   // % below 30-day high (≥ 0)
  lastRange: number;                    // last day's (high-low)/close in %
  trend: Trend; volRegime: VolRegime; volTrend: VolTrend;
}

export interface Question {
  id: string;                           // deterministic: `${type}-${symbol}-${decisionDate}`
  symbol: string;                       // real ticker — NEVER sent to the LLM
  assetCode: string;                    // "Asset A".."Asset F" — what the LLM sees (fixed per symbol per run)
  type: QuestionType;
  decisionDate: string;                 // YYYY-MM-DD (UTC); decision uses the close of this day
  resolveDate: string;                  // decisionDate + HORIZON_DAYS
  threshold?: number;                   // BREAKOUT only: fractional move, e.g. 0.072
  split: Split;
  features: Features;
  outcome?: 0 | 1;                      // set only after resolution
}

export interface RecalledMemory { blobId: string; distance: number; text: string; kind: "lesson" | "calibration"; }

export interface Forecast {
  questionId: string;
  arm: Arm;
  p: number;                            // probability of YES, clamped to [0.02, 0.98]
  rationale: string;                    // ≤ 60 words
  citedBlobIds: string[];               // lessons the model says it used (mem arm only)
  recalled: RecalledMemory[];           // what recall returned (mem arm only)
  model: string;
  createdAt: string;                    // ISO
}

export interface Lesson {
  blobId: string;
  runId: string;
  questionId: string;
  type: QuestionType;
  regime: string;                       // e.g. "down/high/expanding"
  createdSimDate: string;               // the resolveDate of the question that produced it
  text: string;                         // full memory text (header + body)
  adjustment: "raise" | "lower" | "none";
  magnitude: number;                    // 0–0.3
  timesCited: number;                   // filled by export
}

export interface MemoryLedgerEntry {     // engine/state/ledger-{runId}.jsonl, one per successful write
  key: string;                          // deterministic idempotency key (sha256)
  namespace: string;
  kind: "lesson" | "calibration" | "forecast" | "smoke";
  blobId: string;
  jobId: string;
  createdAt: string;
  textSha256: string;
}
```

---

## 6. Data, features, questions

### 6.1 Candles (`tatum/ohlcv.ts`, `data/candles.ts`)

- Fetch daily candles for each symbol from `REPLAY_START − 200 days` through `REPLAY_END + HORIZON_DAYS + 1 day`, paging the batch endpoint 50 candles at a time (`timeFrom` advances by 50 days per page).
- Normalise to `Candle` (numbers), sort by `t`, de-duplicate by `t`, and verify: no gaps of more than 1 day (if a gap exists, log it and mark affected questions `skipped`), `low ≤ open,close ≤ high`.
- Cache to `engine/data/candles/{SYMBOL}-1d.json` and **commit the cache** so replays are reproducible and do not spend credits again. `--refresh` flag re-fetches.
- An HTTP 404 for a symbol means "not supported": drop that symbol with a warning, continue with the rest. Require at least 3 symbols.

### 6.2 Features (`features/regime.ts`, pure)

Computed for decision day `d` using only candles with `t ≤ d` (the decision uses the close of day `d`).

- `ret7 = close[d]/close[d-7] − 1`, `ret30` likewise (×100).
- `vol7`, `vol30` = sample stdev of daily log returns over the last 7 / 30 days (×100).
- `volRatio = vol7 / vol30`.
- `smaDist20 = close[d]/SMA20[d] − 1` (×100); `smaSlope20 = SMA20[d]/SMA20[d-5] − 1` (×100).
- `drawdown30 = 1 − close[d]/max(high over last 30 days)` (×100).
- `lastRange = (high[d] − low[d]) / close[d]` (×100).
- `trend`: `up` if `smaDist20 > 2` and `smaSlope20 > 0`; `down` if `smaDist20 < −2` and `smaSlope20 < 0`; else `flat`.
- `volRegime`: compare `vol7` to the median of daily `vol7` values over the previous 180 days: `< 0.75×` → `low`, `> 1.33×` → `high`, else `normal`.
- `volTrend`: `volRatio > 1.2` → `expanding`, `< 0.8` → `contracting`, else `stable`.
- Regime string: `${trend}/${volRegime}/${volTrend}`.

### 6.3 Questions (`questions/generate.ts`, pure)

Decision dates: every Monday from `REPLAY_START` to `REPLAY_END` inclusive (UTC). For each date × symbol create two questions:

- **DIRECTION:** "Will the close on day +7 be higher than the close on day 0?" Outcome 1 if `close[d+7] > close[d]`.
- **BREAKOUT:** "At any point in the next 7 days, will price trade at least `threshold` away from today's close, in either direction?" Outcome 1 if `max(high[d+1..d+7]) ≥ close[d]·(1+threshold)` OR `min(low[d+1..d+7]) ≤ close[d]·(1−threshold)`.
  - `threshold` = median, over the previous 180 days, of the 7-day maximum absolute excursion — computed **only from 7-day windows that ended on or before day `d`**. Round to 3 decimals. This targets a ~50% base rate and uses no future data.

Split: `decisionDate ≤ DEV_SPLIT_END` → `dev`, else `test`.

Anonymisation (used for every LLM prompt, `prompt/render.ts`):
- Map each symbol to a fixed `Asset A`, `Asset B`, … using a seeded shuffle (`SEED`).
- Price series: last 60 daily closes ending at day `d`, **rebased so close[d] = 100.00**, rounded to 2 decimals, labelled `day −59 … day 0`. Also include the last 10 daily highs/lows rebased the same way.
- No dates, no weekdays, no tickers, no absolute prices, no volumes.
- Include the computed `Features` and the regime string.
- A unit test asserts that rendered prompts never contain any configured ticker, any `20xx-` date, or any number equal to a raw (un-rebased) close.

---

## 7. The experiment (`replay/run.ts`)

### 7.1 Arms

Run the same question set through three arms:

| Arm | What it does |
|---|---|
| `base` | No LLM. `p` = trailing base rate for that question type and symbol, computed from questions resolved before the decision date (start at 0.5 when none). |
| `nomem` | LLM forecast with the standard prompt and the line "No lessons are available." No recall, no writes. |
| `mem` | LLM forecast with recalled lessons + latest calibration snapshot from Walrus Memory. Writes lessons and calibration snapshots back to Walrus as questions resolve. |

Same model, same prompt template, same temperature (0), same question order for `nomem` and `mem`. Run `base` and `nomem` first, then `mem`.

### 7.2 Run identity and namespaces

- `runId = "r-" + YYYYMMDD-HHmm + "-" + 4 random hex` (seeded where possible). Print it.
- Namespaces (flat strings; exact-match):
  - `tuition.${runId}.lessons`
  - `tuition.${runId}.calibration`
- A fresh namespace per run guarantees a run starts with an empty memory.

### 7.3 Weekly loop (mem arm; nomem follows the same order without memory steps)

For each decision Monday `D` in ascending order:

1. **Resolve** every question with `resolveDate ≤ D` that is not yet resolved (with the weekly cadence and 7-day horizon, these are last week's questions).
2. **Reflect** (mem arm only): for each just-resolved question where `|p_mem − outcome| ≥ LESSON_ERROR_THRESHOLD`, call the reflection model (§7.5) and write one lesson memory (§7.6). Await each write (`rememberAndWait` path in §7.7) so it is indexed before step 4.
3. **Calibrate** (mem arm only): build one calibration snapshot from all resolved mem-arm forecasts so far (§7.8) and write it (only if at least 8 forecasts are resolved).
4. **Forecast** every question with `decisionDate = D`:
   - mem arm: `recall` lessons (§7.9) and the latest calibration snapshot, render the prompt, call the model, parse JSON.
   - Save forecasts to the checkpoint immediately.

### 7.4 Leakage rules (enforced in code and tests)

- A question's outcome and lesson are written only at simulated time `resolveDate`, and recall for a question with decision date `D` happens after all writes for resolve dates `≤ D` and before any write for later dates. Because each run uses fresh namespaces and processes weeks in order, recall can only surface past knowledge.
- Keep a local ledger `engine/state/ledger-${runId}.jsonl` (every successful write with `createdSimDate`). A test replays a small run on `InMemoryStore` and asserts every recalled memory has `createdSimDate ≤ decisionDate`.
- The reflection prompt may see the realised future path (that is the point of a post-mortem) but its output is only stored, never shown to the forecast of the same question.

### 7.5 Reflection prompt (`agent/reflect.ts`)

Input: anonymised question, features, regime, the forecast `p`, its rationale, the outcome, and the rebased price path for days +1..+7. Ask for strict JSON:

```json
{
  "lesson": "≤ 280 chars, a general rule about this kind of regime, written in first person",
  "applies_when": "≤ 120 chars, the conditions in terms of the feature names",
  "adjustment": "raise | lower | none",
  "magnitude": 0.0
}
```

Rules in the system prompt: no tickers, no dates, no absolute prices; generalise beyond this single case; if it was bad luck rather than bad reasoning, say so and use `"adjustment": "none"`. Validate with zod; on parse failure retry once with the error appended; on second failure skip the lesson and log it.

### 7.6 Memory text format (`memory/format.ts`, pure)

Every memory is plain text with a one-line machine header followed by the body. The relayer embeds the whole text, so put the human-meaningful words in the body.

```
[TUITION v1|kind=lesson|run=r-20261101-0930-a1b2|q=BREAKOUT-SOL-2026-04-13|type=BREAKOUT|regime=down/high/expanding|sim=2026-04-20|adj=raise|mag=0.15]
LESSON (BREAKOUT, downtrend, high volatility, volatility expanding): When volatility is expanding inside a downtrend I underestimated the chance of a large excursion. Applies when volRatio > 1.2 and trend is down. Next time raise my probability by about 0.15.
```

`decodeHeader(text)` must tolerate missing optional fields and return `null` for non-Tuition text. Max total length 1,000 characters.

### 7.7 Writing memories (`memory/store.ts`)

Interface:

```ts
interface MemoryStore {
  write(input: { namespace: string; text: string; key: string; kind: MemoryLedgerEntry["kind"]; simDate?: string }): Promise<{ blobId: string; jobId: string }>;
  recall(input: { namespace: string; query: string; limit: number; maxDistance?: number; sort?: "relevance" | "recent" }): Promise<RecalledMemory[]>;
  health(): Promise<unknown>;
}
```

`WalrusMemoryStore.write`:
1. If the ledger already has an entry with this `key`, return it (resumability; Walrus Memory is append-only, so never write twice).
2. `const accepted = await memwal.remember(text, namespace, { idempotencyKey: key })`.
3. `const status = await memwal.waitForRememberJob(accepted.job_id, { pollIntervalMs: 1000, timeoutMs: 90_000 })`; require `status.status === "done"` and a `blob_id`.
4. Append to the ledger and return.
- Concurrency ≤ `MEMWAL_WRITE_CONCURRENCY`; hourly soft cap `MEMWAL_MAX_WRITES_PER_HOUR` (when hit, wait, and log the wait).
- Retries: 3 attempts with exponential backoff (1s, 4s, 10s) on network errors, HTTP 429 and 5xx. A 401 is fatal: print the troubleshooting hint (wrong key, key not registered on the account, account ID is a wallet address, or staging/mainnet mismatch).
- If the installed SDK version exposes `remember` options differently, adapt to the real signature found in `node_modules/@mysten-incubation/memwal` type definitions and record it in DECISIONS.md.

`key = sha256(runId + ":" + kind + ":" + questionId-or-simDate)`.

`InMemoryStore` (tests and `--dry` only): stores texts in arrays per namespace; recall ranks by token overlap; returns fake blob IDs `mem-<n>`. Refuse to run `replay --official` unless `MEMORY_BACKEND=walrus`.

### 7.8 Calibration snapshot (`memory/calibration.ts`, pure builder)

From resolved mem-arm forecasts so far, group by `type` × `trend` × `volRegime`. For each group with `n ≥ 4`, compute mean forecast `p̄`, observed frequency `ȳ`, and gap `ȳ − p̄`. Body text example:

```
[TUITION v1|kind=calibration|run=…|sim=2026-05-04|n=96]
CALIBRATION SNAPSHOT after 96 resolved forecasts.
BREAKOUT, down trend, high vol: I forecast 0.41 on average (n=9) but it happened 0.78 of the time → I am UNDER-confident by 0.37.
DIRECTION, up trend, normal vol: I forecast 0.68 (n=12) but it happened 0.50 → OVER-confident by 0.18.
Overall Brier so far 0.262 (coin-flip is 0.250).
```

List at most 8 groups, largest `|gap|` first.

### 7.9 Recall (mem arm)

- Lessons: `recall({ namespace: lessonsNs, query, limit: RECALL_LIMIT, maxDistance: RECALL_MAX_DISTANCE })` where `query` is a sentence built from the question: e.g. `"BREAKOUT question; trend down; volatility high and expanding; drawdown 18%; last day range 6.1%"`.
- Calibration: `recall({ namespace: calibrationNs, query: "calibration snapshot", limit: 1, sort: "recent" })`.
- Decode headers; drop anything whose header is missing or whose `run` differs from the current run.
- Put lessons into the prompt as a numbered list including each `blobId`, and instruct: "Apply a lesson only if its conditions match this question. List the blob IDs you actually used in `cited_lessons`."

### 7.10 Forecast prompt (`agent/forecast.ts`)

System prompt essentials:
- You are a calibrated forecaster. You see anonymised, rebased data only. Do not use outside knowledge about any real asset or date.
- Output strict JSON: `{ "probability": number (0–1), "rationale": "≤ 60 words", "cited_lessons": ["blobId", …] }`.
- Base rates: DIRECTION questions resolve YES roughly half the time; BREAKOUT thresholds are set so YES happens roughly half the time historically.
- Use the calibration snapshot to correct known over/under-confidence.

Parse with zod, clamp `p` to `[0.02, 0.98]`, retry once on invalid JSON. `temperature: 0`, `max_tokens: 400`. Concurrency `LLM_CONCURRENCY`; retry 429/529 with backoff.

### 7.11 Checkpointing

`engine/state/run-${runId}.json` holds: config snapshot, question list, forecasts per arm, resolved outcomes, last completed decision date. `replay --resume <runId>` continues from the last completed week without re-calling the LLM or re-writing memories. Write the checkpoint atomically (write `*.tmp`, then rename) after every week.

---

## 8. Scoring (`score/metrics.ts`, pure, fully unit-tested)

### 8.1 Metrics per arm (overall, per split, per type)
- **Brier** = mean((p − y)²). Lower is better. Coin-flip = 0.25.
- **Log loss** with p clipped to [0.02, 0.98].
- **Accuracy@0.5**.
- **ECE** with 10 equal-width bins.
- **Reliability data**: per bin `{ binMid, meanP, freqY, n }`.
- **Brier skill score vs base arm** = 1 − Brier(arm)/Brier(base).

### 8.2 Learning curve
Rolling mean Brier over the last 24 resolved questions, by decision date, for `nomem` and `mem` (and the per-date cumulative mean). This is the headline chart.

### 8.3 Statistical test
Paired bootstrap on per-question Brier difference `d_i = brier_nomem_i − brier_mem_i` over the **test split**: 2,000 resamples, seeded; report mean Δ, 95% CI, and the share of resamples with Δ > 0. Use block bootstrap by decision week (resample whole weeks) because questions in the same week are correlated.

### 8.4 Dev vs test
Tune only `LESSON_ERROR_THRESHOLD`, `RECALL_LIMIT`, `RECALL_MAX_DISTANCE` using dev-split results (at most 3 tuning runs; log each in DECISIONS.md). The **headline numbers are always the test split** of the official run. Memory accumulated during the dev period carries forward into the test period — that is intended.

### 8.5 Memory influence
For every mem-arm forecast that cited at least one lesson: `shift = p_mem − p_nomem` and `brierGain = brier_nomem − brier_mem`. Aggregate per lesson: `timesCited`, mean `brierGain` when cited. This powers "which lessons actually helped".

---

## 9. Live mode (`live/daily.ts`) — forecasts committed before the outcome

Purpose: show the agent working forward in time with commitments that cannot be edited afterwards.

- Runs daily at 00:17 UTC via `.github/workflows/live.yml` (`cron: "17 0 * * *"`), plus `workflow_dispatch`.
- Steps:
  1. Fetch the latest closed daily candle for each asset (append to cache).
  2. Resolve live forecasts whose `resolveDate ≤ today`; for each bad miss write a lesson to `tuition.live.lessons`; write one calibration snapshot to `tuition.live.calibration` per day once ≥ 8 live forecasts are resolved.
  3. Create today's questions (both types, every asset; decision date = yesterday's UTC date, i.e. the last closed candle).
  4. Recall lessons from **all** namespaces in `LIVE_LESSON_NAMESPACES` plus `tuition.live.lessons`, merge client-side by distance (namespaces are exact-match and flat, so query each and merge).
  5. Forecast (mem arm only) and **write each forecast as a memory** to `tuition.live.forecasts` *before* exporting it. Forecast text body: `FORECAST (BREAKOUT, Asset C, made on sim day 2026-11-02, resolves 2026-11-09): P(YES)=0.63. Rationale: …` Header `kind=forecast` and include the real symbol in the header only (live forecasts are public commitments; anonymisation is for the LLM prompt, not for storage).
  6. Export and commit `web/public/data/live.json`.
- Workflow uses `actions/setup-node` with `node-version: "24"` and prints `node -v`; secrets come from GitHub repository secrets. The job commits with `git config user.name "tuition-bot"` and pushes only `web/public/data/` and `engine/state/live-*.json` and `engine/data/candles/`.
- Start live mode no later than **2026-11-01** so forecasts resolve before the deadline.

---

## 10. CLI commands (`engine/src/cli.ts`, exposed as npm scripts in `engine/package.json`)

| Script | Does |
|---|---|
| `probe:node`, `smoke:memwal`, `probe:ohlcv`, `probe:sui`, `probe:aggregator`, `probe:llm` | §4 |
| `candles` (`--refresh`) | Fetch/cache candles |
| `questions` | Print question counts per split/type and the BREAKOUT base rate |
| `replay --arms base,nomem,mem [--limit N] [--dry] [--official] [--resume runId]` | §7. `--limit N` uses the first N decision weeks for quick checks. `--dry` uses `InMemoryStore` and a stub LLM that returns 0.5 |
| `score --run runId` | §8, prints a summary table |
| `live` | §9 |
| `verify --run runId` | §11 |
| `export --run runId` | §12.1 |
| `memories --run runId` | Prints ledger counts per namespace and kind, plus the agent public key |

Root scripts: `npm run build`, `npm run typecheck`, `npm test`, `npm run dev` (web), `npm run engine -- <cmd>`.

---

## 11. Verification (`verify/proof.ts`) — uses Tatum Sui RPC

Produces `web/public/data/proof.json`:

1. Relayer `health()` result and timestamp.
2. **Account object via Tatum Sui RPC:** `sui_getObject(MEMWAL_ACCOUNT_ID, { showType, showOwner, showContent })` → record `objectId`, `version`, `digest`, `type`, `owner`. Check whether the delegate public key (`getPublicKeyHex()`) appears anywhere in the object content (search the JSON string, case-insensitive, with and without `0x`) and record `delegateKeyFound: boolean`.
3. **Blob availability:** for every lesson and calibration blob in the run ledger (and live forecasts), `GET {WALRUS_AGGREGATOR_URL}/v1/blobs/{blobId}` → record HTTP status, byte length, sha256 of the bytes. Rate-limit to 3 rps. Content is encrypted; never attempt to decrypt.
4. **Recall round-trip:** recall 3 random lessons by their own body text and confirm the same `blob_id` comes back first.
5. Counts: total memories written on mainnet by namespace and kind (from ledgers), and `MEMWAL_AGENT_ID`, `MEMWAL_ACCOUNT_ID`.
6. Explorer links: `https://suiscan.xyz/mainnet/object/{MEMWAL_ACCOUNT_ID}`; for blobs, link format from Walrus docs/explorer (confirm the URL pattern during Phase 0 and store it as a constant).

Never put secrets in `proof.json`. The private key must never be logged.

---

## 12. Web app (`web/`)

Static site. Dark theme, one accent colour, monospace for numbers and blob IDs, mobile-first (must work at 375 px wide). Use Recharts for charts. All data loads from `/data/*.json` with a loading and an error state.

### 12.1 Data files (written by `export`)
- `summary.json` — run id, dates, model names, counts, per-arm metrics (overall/dev/test/by type), bootstrap result, memory counts.
- `curve.json` — learning-curve points per arm.
- `reliability.json` — reliability bins per arm (test split).
- `questions.json` — every question with features, outcome, forecasts for all arms, cited lessons, shift and brierGain.
- `lessons.json` — every lesson with blobId, sim date, regime, text body, timesCited, mean brierGain when cited.
- `live.json` — live forecasts (pending and resolved) with blob IDs and timestamps, live metrics.
- `proof.json` — §11.

Define a zod schema for each file in `shared/src/schemas.ts` (mirroring the types in §5). `export` validates every file against its schema before writing, and the web app validates again on load (showing the error state on mismatch).

### 12.2 Pages (React Router)
1. **`/` Overview** — hero line "Same model. Same questions. One remembers." Three stat cards: Brier memory OFF, Brier memory ON, improvement with 95% CI (test split). Learning-curve chart (both arms + coin-flip line at 0.25). Short "how it works" in 4 steps. Counts: questions, lessons on Walrus, total memories on mainnet.
2. **`/calibration`** — reliability diagram (diagonal = perfect), both arms; ECE per arm; per-type table.
3. **`/lessons`** — searchable list; each card shows regime chips, lesson body, sim date, times cited, mean Brier gain when cited, blob ID (copy button) and explorer link. Sort by "most helpful".
4. **`/questions`** — filterable table (type, split, asset code, outcome, |shift|). Row → **`/questions/:id`**: rebased price chart for day −59..+7 with the decision point marked, the three forecasts side by side, the rationale of each LLM arm, the recalled memories with distance, and which ones were cited. Real ticker is shown here (after the fact) with a note that the model never saw it.
5. **`/live`** — today's committed forecasts (blob ID + commit timestamp), resolved live forecasts with outcomes, running live Brier.
6. **`/verify`** — everything in `proof.json`, plus "verify it yourself" instructions.
7. **`/method`** — renders a short methodology (leakage controls, arms, splits, metrics, honest limitations).

No page may import anything from `engine/`. Shared types come from `@tuition/shared`.

---

## 13. README (judge-facing, in this order)
1. One-sentence pitch and the headline result (test split Brier OFF vs ON, Δ with 95% CI) — filled from `summary.json`, never typed by hand.
2. Demo link, video link, blog link.
3. How memory is used (lessons, calibration, live commitments) with a diagram.
4. Hackathon requirements checklist: Walrus Memory writes on mainnet (count), ≥ 10 memories (count), Tatum RPC usage (Sui RPC verification) and Tatum Data API (OHLCV), blog post link.
5. Mainnet evidence table: `MEMWAL_ACCOUNT_ID`, `MEMWAL_AGENT_ID`, namespaces, counts, 5 sample blob IDs with links.
6. Methodology summary and honest limitations (small sample, crypto-only, LLM non-determinism, managed relayer sees plaintext).
7. Setup & reproduce: env, probes, `replay --official`, `score`, `verify`, `export`, `npm run dev`.

---

## 14. Blog post skeleton (`docs/BLOG_DRAFT.md`)
Title idea: "I gave an AI forecaster a memory on Walrus. Here's what it learned from being wrong." Sections: the problem (agents repeat mistakes), the experiment design, the leakage controls, results with the two charts, three real lessons it wrote, live commitments, what did not work, how to verify. The human author writes the final prose; the engine fills a results table placeholder.

---

## 15. Tests (vitest) — required to pass in CI
- `metrics.test.ts`: Brier, log loss, ECE, reliability bins on hand-computed examples; bootstrap is deterministic with a seed.
- `features.test.ts`: features on a synthetic candle series with known answers; regime labelling edges.
- `questions.test.ts`: outcomes for DIRECTION/BREAKOUT on synthetic paths; BREAKOUT threshold uses only windows ending ≤ decision day (construct a series where future data would change the threshold and assert it does not).
- `prompt.test.ts`: anonymisation assertions (§6.3).
- `format.test.ts`: header encode/decode round-trip; non-Tuition text → `null`; length cap.
- `leakage.test.ts`: dry replay on `InMemoryStore` for 6 weeks; every recalled memory has `createdSimDate ≤ decisionDate`; nomem arm never calls recall.
- `store.test.ts`: write idempotency via ledger (second write with same key does not call the client).
- `export.test.ts`: generated JSON validates against schemas.
- A CI guard script fails if any file under `web/src` references `MEMWAL_`, `TATUM_`, `ANTHROPIC_`, or `process.env`.

---

## 16. Build order and timeline (today is 2026-10-29)

| Day | Date | Deliverable | Exit check |
|---|---|---|---|
| 1 | Oct 29–30 | Repo scaffold, config, all Phase 0 probes, fixtures saved | `smoke:memwal` prints a blob ID and the agent public key |
| 2 | Oct 31 | Candles cached for all assets; features; questions; metrics + tests | `questions` prints counts; BREAKOUT base rate 0.4–0.6 |
| 3 | Nov 1 | Forecast + reflect + memory store + format; **start live job** | `live` runs green in Actions once |
| 4 | Nov 2 | Replay loop, checkpointing, `--dry` and `--limit 4` real run | Leakage test passes; 4-week real run writes lessons to mainnet |
| 5 | Nov 3 | Dev-split tuning (≤ 3 runs) | Chosen params logged in DECISIONS.md |
| 6 | Nov 4 | **Official full run** (`--official`) + score + export | `summary.json` exists with bootstrap CI |
| 7–8 | Nov 5–6 | Web app pages 1–4 | Deployed preview on Vercel |
| 9 | Nov 7 | Pages 5–7, verify + proof | `/verify` shows account object via Tatum RPC |
| 10 | Nov 8 | README, METHODOLOGY, blog draft data | All checklist items green |
| 11 | Nov 9 | Demo video (2–3 min), publish blog | Links in README |
| 12 | Nov 10 | Buffer; submit **before 17:00 UTC** | Form submitted |

If time runs short, cut in this order (last = cut first): page 7 → live calibration snapshots → page 6 extras → per-lesson helpfulness stats. **Never cut** the A/B experiment, the leakage controls, mainnet writes, or the verification of the account object via Tatum.

---

## 17. Definition of done (submission checklist)
- [ ] `smoke:memwal` output saved; `MEMWAL_AGENT_ID` and `MEMWAL_ACCOUNT_ID` recorded in README.
- [ ] Official run completed on mainnet; ≥ 10 memories (target 60+) written; ledger committed.
- [ ] `summary.json` has test-split metrics for all three arms and the bootstrap CI.
- [ ] Live job has run daily since ≤ Nov 1; at least one day of resolved live forecasts by submission.
- [ ] `proof.json` shows the account object fetched through Tatum Sui RPC and aggregator checks for blobs.
- [ ] All tests pass in CI; `npm run build` passes; no secrets in the web bundle (CI guard green).
- [ ] Web app deployed; all pages render on a 375 px screen.
- [ ] README complete; blog post published and linked; demo video linked.

---

## 18. Rules for the coding agent
- Work in the order of §16. Commit after each exit check passes with a message naming the step.
- Do not invent API fields. If unsure, run the relevant probe and read the fixture or the SDK's `.d.ts` files.
- Keep pure logic (features, questions, metrics, format, calibration, prompt rendering) free of I/O so it is testable.
- Every external call goes through `util/retry.ts` and the right rate limiter.
- Never write the same memory twice: always go through the ledger and idempotency key.
- Never log secrets; redact keys in error messages.
- Do not change the experiment design to make the numbers look better. If memory does not help, the README says so and explains why.
- Log every deviation from this file in `docs/DECISIONS.md` with the date and reason.