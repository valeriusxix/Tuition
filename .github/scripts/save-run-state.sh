#!/usr/bin/env bash
# Snapshot replay checkpoints and ledgers to a state branch, so an interrupted runner never loses the
# record of what it wrote to mainnet (AGENT.md §7.7, §7.11). Force-push: the branch only ever holds the
# latest snapshot of this job, and main is untouched until the job's final commit.
set -euo pipefail
branch="$1"
shopt -s nullglob
files=(engine/state/run-*.json engine/state/ledger-*.jsonl)
[ "${#files[@]}" -gt 0 ] || exit 0
git add -- "${files[@]}"
if git diff --cached --quiet; then
  echo "state unchanged"
  exit 0
fi
git commit -q -m "run state snapshot $(date -u +%FT%TZ)"
git push -q --force origin "HEAD:refs/heads/${branch}"
echo "state saved to ${branch}"
