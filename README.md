# Tuition

*The market charges tuition. Tuition keeps the notes.*

Tuition is an AI crypto forecaster that learns from its own mistakes. After each wrong call it writes a lesson to
Walrus Memory on Sui mainnet, then recalls matching lessons before new forecasts. A memory ON vs OFF A/B test on the
same questions measures the real gain in Brier score. Powered by Tatum.

Entry for the Total Recall hackathon (Tatum × Walrus), Track 1: Markets & Sports Prediction.

> **Status:** Day 1, scaffold and Phase 0 probes. The judge-facing README (§13) replaces this file once results exist.

## Setup

Requires Node **24.22.1+** (or 22.23.4+).

```bash
npm install
cp .env.example .env      # fill in the four secrets; everything else has defaults
npm test                  # unit tests, no keys needed
```

## Phase 0 probes

Each probe saves the raw response to `engine/fixtures/`.

```bash
npm run probe:node        # Node version gate
npm run smoke:memwal      # Walrus Memory: health, one mainnet write, recall, agent public key
npm run probe:ohlcv       # Tatum OHLCV batch call
npm run probe:sui         # account object via Tatum Sui RPC
npm run probe:aggregator  # smoke blob via the Walrus aggregator
npm run probe:llm         # Claude model IDs and request settings
```

See `AGENT.md` for the full design and `docs/DECISIONS.md` for every deviation from it.
