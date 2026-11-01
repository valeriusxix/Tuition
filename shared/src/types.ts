// All cross-package types (AGENT.md §5). Fields added beyond §5 are marked
// "added" and logged in docs/DECISIONS.md.

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
  skipped?: string;                     // added: reason the question is excluded (e.g. a candle gap, §6.1)
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
  createdSimDate?: string;              // added: simulated date of the write (§7.4 leakage test)
}
