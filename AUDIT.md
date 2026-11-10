# Tuition: independent audit

Audited 2026-11-06 at commit `18ffd55`. Deadline: 2026-11-10 17:00 UTC. Official run: `r-20261106-1001-f2a8`.

Terms: the **mem** arm is memory ON. **nomem** is memory OFF. **nomem2** is a second identical memory-OFF pass, an A/A test. Δ is Brier(reference) minus Brier(candidate), so a positive Δ favours the candidate.

How this was done: every number below was recomputed by a script that imports nothing from the project, or read directly from the cited file. Build gates ran in a fresh clone in a scratch folder. See Appendix B for exactly what was touched.

---

## 1. Verdict

**No, this is not submittable today.** There is no published blog post, no deployed site and no demo video: the README links are all "to be added" and `docs/links.json` holds three nulls. A serious defect also undercuts what the project says it tested: from 2026-04-20 onward the memory arm received the same frozen calibration snapshot every week, including all 20 weeks of the test split, while the README, the methodology and the prompt itself call it the "latest" snapshot. The numbers themselves are honest, and they reproduce exactly. **Memory did not demonstrably improve results:** the headline gain is +0.0089 with a 95% CI of [−0.0134, +0.0325], memory only ties a no-LLM base rate, and two identical no-memory passes show a stronger P(Δ>0) than memory does (0.96 vs 0.77). Security, leakage controls, mainnet evidence and live commitments all passed real checks, so this is recoverable in the four days left, but the freeze must be disclosed either way.

---

## 2. Blockers

### B1. No public blog post, and the README does not link one

- **Evidence:** `README.md:20-22` reads "Demo / Video / Blog post: _to be added_". `docs/links.json` is `{"demo":null,"video":null,"blog":null}`. `README.md:61` is an unticked box. `docs/BLOG_DRAFT.md` exists and is a good draft, but its own header says it must be rewritten by the author.
- **Why it matters:** AGENT.md's header and §17 list a public blog post as a submission requirement. It is the only listed requirement that is unmet.
- **Fix:** Finish and publish the post, add the URL to `docs/links.json`, then run `export --docs`. Update the post for B3 first, because its "what did not work" section is missing the biggest thing that did not work.

### B2. No deployed site and no demo video

- **Evidence:** `gh api repos/valeriusxix/Tuition/deployments` returns 0. The repo homepage is null, no commit status exists, and no `vercel.app` URL appears anywhere in the repo. I cannot rule out a Vercel project with no GitHub link, but no URL exists for a judge to find. `demo` and `video` are null.
- **Why it matters:** §17 requires a deployed app and a linked video. Every "see `/verify`" pointer in the README leads nowhere for a judge today. The whole "verify it yourself" story depends on this.
- **Fix:** `vercel.json` is ready, and the build passes on a clean clone, so importing the repo should take minutes. Record the video after B3 is settled.

### B3. The memory arm ran on a frozen calibration snapshot for the whole test split

This is the most important finding in the audit.

- **What happened:** The memory arm is supposed to read the newest calibration snapshot each week. It wrote 32 snapshots to mainnet, but from 2026-04-20 onward it recalled the same one every week. For 25 straight weeks, including all 20 test weeks, it received that n=56 snapshot after newer ones existed, even when the true latest held n=256. Only 6 of the 32 snapshots ever reached a prompt.

| Decision week | Should have received | Actually received |
|---|---|---|
| 2026-04-06 | n=40 | n=40 |
| 2026-04-13 | n=48 | n=40 (stale) |
| 2026-04-20 | n=56 | n=56 |
| 2026-04-27 to 2026-10-12 | n=64 to n=256 | **n=56, every week, up to 25 weeks stale** |

- **Evidence, from the checkpoint:** each mem forecast's `recalled` field in `engine/state/run-r-20261106-1001-f2a8.json`, mapped week by week against `calibrations[]`. Tuning runs T1 and T3 show the same freeze, stuck at 2026-04-06.
- **Evidence, live on mainnet (read-only):**

```
limit 1, sort recent   -> newest returned 2026-04-20 (n=56)    <- the call as shipped
limit 5, sort recent   -> newest returned 2026-10-12 (n=256)
limit 100, sort recent -> all 32 snapshots, newest first
```

- **Cause:** `engine/src/replay/run.ts:187` calls `recall({ limit: 1, sort: "recent" })`, exactly as AGENT.md §7.9 prescribes. The SDK says `recent` means "newest-among-matches" from an over-fetched semantic window (`memwal/dist/types.d.ts:217-221`). That window is not the whole namespace. Later snapshots are longer (about 437 characters early, about 965 later) and sit further from the query "calibration snapshot". An over-fetch window of about 5 × `limit` fits every observed week: on 04-06 the newest snapshot was 5th-nearest and was returned; on 04-13 it was 6th-nearest (0.598 vs 0.597) and was missed; on 04-20 it re-entered the top 5 and was returned, which also rules out indexing lag; at `limit: 5` today the newest is 21st by distance and is returned. The behaviour is observed. The window size is my inference.
- **Same call in live:** `engine/src/live/daily.ts:150`. It cannot bite before the deadline: live writes its first snapshot on Nov 8, so at most 3 exist by Nov 10, inside the window.
- **Tuning was affected too:** T1 and T3 ran with the same freeze, so the D38 to D44 "defaults kept" decisions were made on a broken calibration loop. That is relevant to any rerun, because those settings would carry over.
- **Why no test caught it:** `InMemoryStore` sorts strictly by write order (`store.ts:203`), which the real relayer does not do, so `store.test.ts:127` passes while production fails. Mutation testing confirms it: changing the sort at `run.ts:187` breaks no test.
- **Why it matters to judges:**
  - `README.md:30`, `docs/METHODOLOGY.md:23` and the prompt text at `engine/src/prompt/render.ts:112` all say "latest". The site shows this data, so anyone opening a September question sees "after 56 resolved forecasts".
  - The test split therefore measures "lessons plus one static April note", not the designed learning loop.
  - The note is the likely source of the whole gain. The 36 test BREAKOUT forecasts whose rationale mentions calibration gained +0.0505 each, the other 44 lost 0.0090 each, and DIRECTION gained nothing. Those 36 hold more than 100% of the test-split gain. This is correlational, not proof.
  - The cost is visible. The frozen note's top line says BREAKOUT was "too LOW by 0.26". The real final snapshot says BREAKOUT was too HIGH by 0.31 in up/high and 0.18 in up/normal. Memory raised P(YES) in all 9 BREAKOUT regimes, overshot the observed rate (0.413 vs 0.375), and lost in exactly those two regimes (gain −0.039 and −0.017). The model never saw that feedback.
  - D46 and the README say the design "cannot separate" lessons from calibration, and they float calibration as the possible source of the gain, without knowing it was frozen.
- **Fix:**
  1. Disclose it now in the README, METHODOLOGY, `/method` and the blog, and log it in `docs/DECISIONS.md`. **Do this regardless of step 3.**
  2. Fix the replay call site: recall with `limit: 100`, parse each header, take the newest `sim ≤ D`. Log the deviation from §7.9. Add a run-time check that fails or warns when the snapshot's `sim` is older than the previous week. Make the same change in live after the deadline.
  3. **Owner decision:** whether to run a corrected second run. See F6 in section 6. `official.yml` refuses a second run on purpose, and `README.md:133`, `Method.tsx:51` and `BLOG_DRAFT.md` all promote that fact, so a rerun must be pre-registered, labelled and published alongside this run, never in place of it.

---

## 3. Serious issues

### S1. Memory did not demonstrably improve results, and the evidence is weaker than the published text suggests

The published text is honest that the result is not significant. It still understates how weak the signal is.

| Comparison (test split, 160 questions, 20 weeks) | Δ | 95% CI | P(Δ>0) |
|---|---:|---:|---:|
| mem vs nomem (headline) | +0.0089 | −0.0134, +0.0325 | 0.77 |
| mem vs nomem2 | +0.0037 | −0.0174, +0.0261 | 0.61 |
| mem vs both no-memory passes pooled (my calculation) | +0.0063 | −0.0153, +0.0302 | 0.69 |
| mem vs base rate (no LLM) | +0.0010 | −0.0306, +0.0321 | 0.52 |
| **nomem2 vs nomem (identical arms)** | **+0.0052** | **−0.0005, +0.0116** | **0.96** |

- **Identical arms look more "real" than memory.** The A/A row beats the headline on P(Δ>0). One A/A result at 0.96 is about a 1-in-20 event, so it does not prove the interval is too narrow, but it shows how easily a gap this size appears. Two sources of uncertainty also sit outside the CI: how the memory arm's early lessons shape everything after them, and which noise draw serves as the reference (Δ is +0.0089 against nomem, +0.0037 against nomem2). The site shows the A/A gap but not its CI or P.
- **Same settings, opposite sign.** T1 and the official run use identical settings on identical dev questions. T1 scored Δ −0.0085, the official run +0.0091. Across all four full dev replays, Δ was −0.0085, −0.0022, −0.0081 and +0.0091, a mean of −0.0024. `docs/METHODOLOGY.md:70` says run-to-run variation in the memory arm is "unmeasured", but the repo holds this measurement. The blog mentions the dev losses. The README and site do not.
- **The project's own noise rule would reject the headline.** The eight no-memory dev passes span 0.2426 to 0.2566, a range of 0.0140, which exceeds 0.0089. The D38 rule only applied to tuning, and this yardstick is the extreme of eight draws on dev while the headline is on test, so it is a rough comparison. A judge can still make it. The README quotes only one noise figure, +0.0052.
- **The gain is two weeks.** Memory won 8 test weeks and lost 12. Drop the best week and Δ falls to +0.0028. Drop the best two and it is −0.0020.
- **There is no learning curve.** Gain vs nomem by third of the run is 0.0095, 0.0087, 0.0086, while the lesson stock grew from zero to 181. That is a level shift, not learning. The Overview chart is still titled "Learning curve", as AGENT.md §8.2 names it.
- **No arm discriminates.** Correlation of forecast with outcome on the test split is negative or zero everywhere: BREAKOUT base −0.218, nomem −0.101, nomem2 −0.039, mem −0.001; DIRECTION −0.10 to −0.13. Mem's mean BREAKOUT p is 0.412 when YES happens and 0.413 when it does not. DIRECTION gain is +0.00007. On BREAKOUT, every LLM arm loses to arithmetic (base 0.245, mem 0.262).
- **Why it matters:** judges reward honesty, and this project already leads with it. A sharp reviewer will find these facts, so it is better that you say them first.
- **Fix:** add three lines to the generated headline: the A/A P(Δ>0), the four-run dev Δ values, and the top-two-weeks result. Correct `METHODOLOGY.md:70`. Consider retitling the chart "Rolling Brier". Do not change the experiment.

### S2. No live forecast that used memory can resolve before the deadline

- **Evidence:** All 48 live commitments have `recalled: []` and `citedBlobIds: []`, and `state.calibrations` is empty (`engine/state/live-forecasts.json`). The official lessons were connected at 16:01 UTC on Nov 6, after the last scheduled run. The first forecast able to use them is decision day Nov 6, resolving Nov 13. By submission, at most 24 forecasts can have resolved (decision days Oct 31 to Nov 2), and all 24 were memoryless. The Nov 3 forecasts resolve Nov 10, but the job that scores them runs Nov 11.
- **Why it matters:** `/live` will show a "Live Brier" beside the pitch of a memory agent, but that score measures no memory at all. `Live.tsx:95` says those forecasts "did not recall the replay's lessons". That is true and incomplete, because they recalled nothing.
- **Also:** the live lesson path first runs on real data on Nov 8, about 06:50 UTC, two days before the deadline. It has unit tests but has never run in Actions.
- **Fix:** say it plainly on `/live` and in the blog: "All forecasts resolving before submission were made with no memory; memory-informed forecasts begin with decision day Nov 6." Check the Nov 8 run yourself the same morning.

### S3. "Cannot be edited" and "Nothing here needs trust" claim more than a judge can check

- **Evidence:** Blobs are encrypted (mean 7.77 bits per byte of entropy, no plaintext markers in any of 485). A judge can confirm that a blob exists and its hash. They cannot confirm its content, who wrote it or when. The ledger linking a blob to a forecast is self-reported. Claims at `README.md:42`, `Live.tsx:77`, `BLOG_DRAFT.md:87`.
- **What does hold:** I rebuilt all 48 commitment texts from `live-forecasts.json`, and their SHA-256 matches the ledger 48 of 48. The ledger is committed by the Actions bot, so GitHub's commit record does support timing. That is decent evidence, but it rests on GitHub and the repo, not on Walrus, and the site never explains it.
- **Friction on `/verify`:**
  - The page prints the agent ID in hex, but the object stores it as base64 (`CESHVC4r…`). It does say "Yes (base64)", yet it never gives the base64 value or the conversion, so a judge following "find the delegate key" (`Verify.tsx:115`) gets no direct match.
  - It requires a Tatum key, though the public `graphql.mainnet.sui.io` endpoint works with no key. I confirmed that with the same query.
  - The recall round-trip needs your private key, so a judge cannot repeat it.
- **An unused strength:** all 40 blobs I sampled start with `00` plus the MemWal package ID `e7c16fbe…`, and carry the account owner's address `eeae7821…` in the public header. With no decryption, that shows a blob is encrypted under this account owner's Seal policy. It does not prove who wrote it, because anyone can encrypt to that identity. The page does not mention it.
- **Fix:** soften the wording to what is true, for example "the hash of each commitment is committed to git before the outcome, and the ciphertext is on Walrus". Show the base64 key beside the hex one, add the keyless endpoint, and add the header check as a third verification step. Change "Nothing here needs trust". Publishing `textSha256` in `live.json` would make the commitment check possible from the site alone.

### S4. Three published statements are false

| Claim | Where | Reality |
|---|---|---|
| "not deterministic even at temperature 0" | `README.md:100`, `METHODOLOGY.md:69`, `Method.tsx:68` | No `temperature` parameter is sent at all (D17, `agent/forecast.ts`). |
| "so about half resolve yes" | `Method.tsx:23` | 49 of 132, or 37.1% (dev 36.5%, test 37.5%). D20 records this, but no public page states it. |
| Run-to-run variation is "unmeasured" | `METHODOLOGY.md:70` | T1 and the official run measure it on dev. See S1. |

- **Why it matters:** each is small, but this project's value is its accuracy, and each is easy to check against your own decision log.
- **Fix:** one-line edits. State the 37% figure and link D20. The model's system prompt also says "roughly half" (`render.ts:16`), so mention that too, because it is a plausible reason every LLM arm under-performed base on BREAKOUT. Leave the prompt unchanged for the existing run.

### S5. Recall surfaces a small, loosely matched slice of the lessons

- **Evidence, official run:** only 65 of 181 lessons were ever recalled, and 116 never reached a prompt. Ten lessons account for 50% of all recalls. Only 15.2% of recalled lessons match the question's exact regime (98.0% match its type). Distances run 0.30 to 0.49, so the 0.8 cutoff filters nothing (known, D37). Only 36 lessons were ever cited. Of the 22 cited at least 3 times, 14 have a negative mean gain, 5 positive and 3 near zero. Forecasts that cited nothing moved further (mean |shift| 0.064) than those that did (0.041).
- **Why it matters:** `README.md:40` says "the lessons closest to the current market regime". That is true by embedding distance and weak in practice. This is a Best Walrus Memory entry, so judges will look at how well memory is used.
- **Fix:** do not change the design now. Report these figures. If you do a corrected run, keep every setting that was fixed before results were seen, and name any change as new.

### S6. Tests are real, but the fake store hides relayer behaviour

- **Evidence:** 231 tests across 25 files pass, with no `.skip`, no `.only` and no empty tests. Of 26 valid mutations I injected, 19 were caught, including ticker, date and raw-price leaks, a future-data threshold, removing the outcome date gate, and removing the ledger. **Seven survived:**

| Surviving mutation | What it means |
|---|---|
| Calibration `sort` removed | This is B3. |
| Forecast runs before reflect and calibrate | §7.4's order is not asserted. The mutation is safe in direction, but the rule is untested. |
| `usableAt` stops checking run ID | Cross-run contamination is untested. Fresh namespaces still protect it. |
| Live recall stops filtering future `sim` | The live leakage guard has no test. |
| Block bootstrap replaced by per-question bootstrap | §8.3's core property is not pinned. My recomputation shows the real code is correct. |
| Saved-forecast filter removed | Resume within a partly finished week is untested. |
| Lesson recall no longer sorted by distance | Low risk. |

- **Why it matters:** "tests pass" did not catch the worst bug in the project, because the fake was more correct than the real service.
- **Fix:** make the test store mimic the relayer (sort only inside a small nearest window), and add tests for the first four rows.

### S7. Tatum "RPC" is one GraphQL read, a possible rules risk

- **Evidence:** Tatum's OHLCV Data API is core and clearly used (`tatum/ohlcv.ts`; Actions log: `fetched candles symbol=BTC …`). Tatum's Sui gateway is used through GraphQL, not JSON-RPC, because JSON-RPC returns HTTP 404 (`fixtures/sui-getObject-account.json`; D14). The call sits in `tatum/sui.ts:67-79`, runs once per `verify`, and its result is in `proof.json`.
- **Verdict:** CAN'T VERIFY whether this meets the rule. I could not find the official rules page, so I relied on AGENT.md. D14 is well justified technically.
- **Why it matters:** if the rule says "use Tatum RPC", a strict reader may want more than a single verification read.
- **Fix:** check the wording yourself. Name the gateway and the reason for GraphQL in the README's requirements block.

---

## 4. Minor issues

| # | Issue | Evidence | Why it matters | Fix |
|---|---|---|---|---|
| M1 | "+0.0089" sits beside a falling Brier with no explanation of the sign | Overview card, `README.md:8` | Readers may read a plus as worse | Say "lower Brier by 0.0089" |
| M2 | README never defines Brier, Δ or P(Δ>0) | `README.md:8` | Costs seconds in a 60-second read | One clause: "0.25 = coin flip, lower is better" |
| M3 | At 375 px the Calibration scores table hides its Brier column off-screen with no hint | `375_calibration.png` | The key figure is invisible on mobile | Drop the Type column on mobile, or add a scroll hint |
| M4 | "decision" label clipped on the question chart at 375 px; "coin flip" label overlaps the lines | `375_questions_…png`, `375_.png` | Polish | Anchor the labels inside the chart |
| M5 | 47 of 181 lessons contain a truncation "…", some mid-thought ("so this was…") | Checkpoint `lessons[].text`, D34 | `/lessons` is a showcase page | Cannot change written memories; note the cut or trim the display |
| M6 | Repo description says it "measures the real gain" and "learns from its own mistakes" | `gh repo view` | Conflicts with the honest README | Reword |
| M7 | README never names the models, and no public page names the Orbio gateway | `grep`; `/method` names the forecast model, D16 records Orbio | Reproducers should know | One line under Setup |
| M8 | A failed live recall proceeds silently and the record does not note it | `live/daily.ts:129-133` | A "memory" forecast could have had none | Add a flag to the record |
| M9 | The ledger hit returns the old blob without comparing text | `store.ts:80-81` | A rerun after a crash could pair a new forecast with an old blob. Narrow window; not seen in practice | Compare `textSha256` and fail loudly |
| M10 | Stale or unsafe memories drop silently | `run.ts:183,188` | The freeze left no warning in any log | Log it (see B3 fix) |
| M11 | "One official run" is enforced only by the workflow; the CLI has no guard | `official.yml`, `commands/replay.ts` | The claim is slightly stronger than the mechanism | Word it precisely |
| M12 | Test-split base rates were seen on Day 2 (D20), and outcomes were always in the cache | D20, D42 | Disclosed; no setting was chosen from them. A strict reviewer may raise it | Keep it disclosed |
| M13 | Every page has the same `<title>`. `/lessons` is about 97,000 px tall at 375 px and `/questions` about 10,000, with no pagination | Browser run | Hard to browse on a phone | Per-route titles, a "show more" |
| M14 | The namespace counts on `/verify` are off-screen at 375 px | `375_verify.png` | The per-namespace evidence is hidden on mobile | Show the count first or wrap |

---

## 5. What is genuinely solid

- **The numbers.** All 264 outcomes, all 132 BREAKOUT thresholds and all feature values rebuild from raw candles truncated at the decision date, with zero mismatches. Brier for every arm, split and type, computed from both the checkpoint and `questions.json`, matches `summary.json` within 5e-7. An independent bootstrap reproduces the headline CI. `score` and `export` run with no keys and reproduce all five data files identically.
- **Leakage control.** 528 real prompts scanned: zero tickers, dates, months, weekdays or volumes. All 1,536 recalled memories are dated on or before their decision, none from another run, none about the same question, and every blob was written before the forecast that used it, by wall clock. Across 33 weeks no write landed out of order. The rationales and lessons contain no tickers, asset names or dates.
- **Arm integrity.** Same model on 264 of 264 in all three LLM arms, same question set, same system prompt, and memory prompts identical to the no-memory prompt up to the memory block.
- **Pre-registration.** D38 was committed before T1 started. D42 was checked against the abandoned checkpoint and is exactly right: 40 test forecasts in nomem, 0 in nomem2 and mem.
- **Single official run.** One checkpoint has mode `official`. Actions run 42199428492 logged `MODE: official` and no resume. The bot wrote the checkpoint, and it is byte-identical on `main` and `official-state`. The log table matches.
- **Mainnet.** 485 unique blobs with zero duplicates, all HTTP 200 from the mainnet aggregator. A sample of 3 returns 404 on testnet. All 261 hashes in `proof.json` match. The account object and delegate key are confirmed on public Sui GraphQL, with no Tatum involved.
- **Security.** All three real secrets: zero hits across full history on every branch, all tracked files, four Actions logs and the bundle. `.env` was never committed. No key-shaped strings anywhere. Workflows use `secrets.*` and never echo them.
- **Honest reporting.** The README leads with "not statistically significant", explains why, and owns its mistake in D42. The verdict text is generated from the interval. This is unusual in a hackathon entry, and it is your strongest asset.
- **The site.** All 7 pages and both not-found states render at 375 px with no horizontal scroll, no console errors, no failed requests and working charts and filters. All 261 blob links are covered by the 485-blob aggregator sweep, and the 2 other external links (Suiscan, GitHub) returned 200.

---

## 6. Fix list, by impact per hour

Hour estimates are mine. F1 to F4 and F7 and F8 are required. F5, F6 and later are your call.

| # | Fix | Finding | Est. | Note |
|---|---|---|---:|---|
| F1 | Deploy to Vercel, add the URL to `docs/links.json`, `export --docs` | B2 | 0.5h | Unlocks everything judges see |
| F2 | Disclose the calibration freeze everywhere; add a DECISIONS entry | B3 | 0.75h | Non-negotiable, whatever you decide on F6 |
| F3 | Correct the three false statements | S4 | 0.5h | |
| F4 | Fix the replay recall call; add the staleness check and a relayer-like test store | B3, S6 | 1.5h | Needed before F6. Leave live code alone until after the deadline: it cannot hit this bug by then, and the first real live lesson write is Nov 8 |
| F5 | Fix `/verify`: base64 key, keyless endpoint, header check, softer claims | S3 | 1h | High value for "Best Walrus Memory" |
| F6 | **Decide:** corrected second run | B3 | ~3h, mostly waiting | See below |
| F7 | Rewrite and publish the blog, leading with the freeze as a finding | B1 | 3h | A bug found by audit is a better story than a clean one |
| F8 | Record the demo video | B2 | 2h | After F6 settles the numbers |
| F9 | Add the noise lines to the headline; state the live memoryless fact on `/live` | S1, S2 | 1h | |
| F10 | Add the remaining missing tests | S6 | 1h | |
| F11 | Confirm the Tatum wording in the official rules | S7 | 0.25h | Do this early; cheap |
| F12 | Check the Nov 8 live run the same morning | S2 | 0.25h | First real lesson write in Actions |
| F13 | Minor polish | M1 to M14 | 1h | Last |

**F6, the decision.** The published run is valid as a record of what ran, but it did not test the design.

- **Recommended: run a corrected second run.** It costs about $1.34 and 90 minutes in Actions, and writes about 213 more mainnet memories. Before starting, commit to `docs/DECISIONS.md`: the single code change, that all settings stay the same, that all arms rerun, which run is primary, and that both will be published whichever way they land. Keep `r-20261106-1001-f2a8` visible. State that the test split is no longer untouched, because its results have been seen. The guard in `official.yml` and the "refuses a second run" claims must change openly.
- **Alternative: no rerun, disclosure only.** This is cheaper and safer against the charge of rerunning until it looks good. The cost is that the headline stays a test of something other than the design.

Either is defensible. Silently leaving the word "latest" in place is not. Do not rerun more than once.

---

## Appendix A. Check-by-check verdicts

### 1. Hackathon requirements

| Check | Verdict | Evidence |
|---|---|---|
| Real writes on Sui mainnet | **PASS** | Checkpoint `MEMWAL_SERVER_URL` = `relayer.memory.walrus.xyz`; health `mode: production`; `config.ts:92` rejects staging; 485 of 485 blobs on the mainnet aggregator, sample 404 on testnet |
| At least 10 memories | **PASS** | 485 unique blob IDs across 8 ledgers; 213 in the official run (181 lessons, 32 snapshots); 0 duplicate keys or blobs |
| Tatum RPC called | **PASS**, rules wording **CAN'T VERIFY** | `tatum/sui.ts`; `proof.json`; Actions log `account: *** v1062994194`. GraphQL, not JSON-RPC (S7) |
| Tatum price data used | **PASS** | `tatum/ohlcv.ts`; `fixtures/ohlcv-batch-BTC-1d.json`; cache `source: tatum:…`; 449 days per asset, 0 gaps |
| Blog exists and README links it | **FAIL** | Draft exists, not published, not linked (B1) |
| Account ID and agent key recorded | **PASS** | `README.md:69-70`; `proof.json`; key found on the object via public Sui GraphQL |

### 2. Experiment integrity

| Check | Verdict | Evidence |
|---|---|---|
| Prompt can carry ticker, date, raw price | **PASS** | Read `render.ts`; rendered 4 real prompts with the project's renderer, read one in full and three in part; machine-scanned all 528 (264 questions, ON and OFF). The sampled numeric matches were feature values coinciding with SUI's low price range (e.g. 0.93), not leaks |
| Recall surfaces a later memory | **PASS** | 0 of 1,536 by header; 0 by wall clock; loop order `run.ts:259-262` |
| BREAKOUT thresholds past-only | **PASS** | 132 of 132 rebuilt from truncated candles |
| Arms identical except memory | **PASS** | Same model, template, questions; verified on all 264 |
| Temperature 0 | **FAIL** vs spec | Not sent (D17). Same across arms, so no bias, but public text is wrong (S4) |
| Memory arm did what is described | **FAIL** | Calibration frozen (B3) |
| Headline from test split, single run | **PASS** | `pickHeadline`; one official checkpoint. Unrecorded local runs: **CAN'T VERIFY**, nothing suggests any |
| Recompute Brier from questions.json | **PASS** | All 264 rows match the checkpoint; Brier for every arm, split and type within 5e-7 of `summary.json`; headline Δ 0.008919 |
| Recompute bootstrap CI | **PASS** | Mine +0.00892 [−0.0134, +0.0332], P 0.77; published +0.0089 [−0.0134, +0.0325], P 0.77 |
| README and site numbers trace to summary.json | **PASS**, with exceptions | Generated blocks trace. Hand-typed figures (0.04, 100 cited, 31 of 181, 20, 16, −0.015, 1,536) are correct, but will drift after any rerun. "About half" is false (S4) |

### 3. Correctness

| Check | Verdict | Evidence |
|---|---|---|
| `npm ci` | **PASS** | Exit 0, clean clone, 0 vulnerabilities (Node 26.13.0, npm 12.0.2) |
| `npm run typecheck` | **PASS** | Exit 0 |
| `npm test` | **PASS** | Exit 0, 231 of 231 in 25 files; leaves the tree clean |
| `npm run build` | **PASS** | Exit 0, no-secrets guard ran; CI also green on Node 24 |
| Tests assert something meaningful | **PASS**, with gaps | 19 of 26 mutants caught; 7 survived, including B3 (S6) |
| LLM failures defaulting to 0.5 | **PASS** | `forecast.ts` throws after two attempts; 0.5 appears only in the dry-run stub; 0 skips in the official run |
| Swallowed errors, silent failures | **FAIL**, narrow | No empty catches. `verify.ts:41` records null, which is fine. But the stale snapshot degraded silently, and live recall failures go unrecorded (M8, M10) |
| Skipped questions reported | **PASS** | 264 of 264 in every arm; `questions` lists skips |
| Resume does not double-write | **PASS** | T2 and T3 were really resumed, with 0 duplicate keys or blobs; mutation test catches removal. Theoretical window in M9 |

### 4. Security

| Check | Verdict | Evidence |
|---|---|---|
| Secrets in repo or history | **PASS** | Literal match of the 3 real values over `git log --all -p`: 0. Key-shape patterns: 0. `.env` commits: none |
| Secrets in web bundle | **PASS** | `dist/` has 0 real values and no `MEMWAL_`, `TATUM_` or `ANTHROPIC_` strings; `vite.config.ts` loads nothing |
| Workflows use secrets, never echo | **PASS** | Read all 3 workflows; 4 Actions logs have 0 matches |

### 5. Live mode

| Check | Verdict | Evidence |
|---|---|---|
| `live.yml` valid and running | **PASS** | 8 of 8 runs succeeded; scheduled daily since Nov 2; 6 consecutive decision days, 48 forecasts |
| Written before outcome known | **PASS** | Every commitment is at least 6 days before its resolve date; ledger time ≤ `committedAt`; 48 of 48 hashes match. Commits land 6.3 to 8.9 hours after the decision close. On replay data a BREAKOUT was decided on day +1 only 1.5% of the time, so this lag is a small risk and it is disclosed |
| Third party can prove it from Walrus alone | **FAIL** | Ciphertext only (S3) |
| Live forecasts used memory | **FAIL** | 0 of 48 recalled anything (S2) |

### 6. Judge experience

| Check | Verdict | Evidence |
|---|---|---|
| Pages at 375 px | **PASS** | All routes by script: no sideways scroll, 0 console errors, 0 failed requests. I viewed screenshots of Overview, Calibration, question detail, Live, Verify and Method. `/questions` and `/lessons` are too tall to read as images, so those two rest on the script checks. Mobile nits in M3, M4, M14 |
| Empty states, dead links, errors | **PASS** | Not-found states work; `/live` empty state reads well; all links tested return 200 |
| Deployed for judges | **FAIL** | B2 |
| Verify the account on-chain from the site | **PASS**, with friction | Suiscan link works; page gives the key in hex only, while the object stores base64 (S3) |
| Verify a blob on-chain from the site | **FAIL** | Aggregator HTTP 200 and hash only: no on-chain record, owner, content or time shown (S3) |
| README explains it in under 60 seconds | **PASS** | Pitch and result in the first 15 lines, about 340 words to the end of "why it did not help". Jargon in M2 |

---

## Appendix B. Scope and method

**Nothing in the repo was changed except this file.** `git status` was clean at every check.

- **Build gates, mutation tests, browser pass:** a fresh `git clone` in a scratch folder, because `npm ci` would have replaced your `node_modules`. Mutations touched only that clone.
- **`.env`:** read by a script to count literal matches of the three secrets and, for the recall check, to authenticate. No value was printed or written anywhere.
- **Network, all read-only:** Walrus aggregator GETs on all 485 blobs; a public Sui GraphQL query; GitHub API and Actions logs; four `recall` calls on the official calibration namespace, the only use of the Walrus credentials. No memory was written. No Anthropic or Tatum calls were made.
- **Not checked:** blob lifetime or expiry on Walrus; on-chain blob registration; the accuracy of Tatum's candles against a second source; each model's training cutoff against the replay window; hackathon rules beyond AGENT.md, as one web search found no official page.
- **Web run:** production build served locally in headless Edge at 375 and 1280 px, not a deployed site.
