#!/usr/bin/env bash
#
# Run B — issue #74 token-scope A/B comparison.
#   Probe variant : FIXED  (--token-scope turn = answer-turn-only walk)
#   Notebooks     : your 2 OTHER notebooks (plan-b.json — fill in the URLs first!)
#   Output        : dom-audit-runs/B-turn/<runId>/REPORT.md
#
# Expected (fixed) headline metrics:  seenEnabled ~0/12,  gone@settle ~12/12.
#
# Runs in an ISOLATED, CLONED Chrome profile so it can execute IN PARALLEL with
# run-a.sh without both fighting over the base profile's Chrome lock. Auth is
# inherited from the saved state (state.json) + the cloned profile.
#
# PREREQ: the MCP server must be stopped (it holds the base profile lock, which
# would corrupt the clone). Auth must already exist (setup_auth run once).
# PREREQ: edit research/issue-74/plan-b.json and replace the two placeholder URLs.
#
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

if grep -q "REPLACE-WITH-YOUR-NOTEBOOK-ID" research/issue-74/plan-b.json; then
  echo "❌ plan-b.json still has placeholder URLs — edit it and add your 2 notebook URLs first." >&2
  exit 1
fi

export NOTEBOOK_PROFILE_STRATEGY=isolated
export NOTEBOOK_CLONE_PROFILE=true

npx tsx research/issue-74/dom-audit.ts \
  --plan research/issue-74/plan-b.json \
  --token-scope turn \
  --out dom-audit-runs/B-turn \
  --headless --yes \
  2>&1 | tee research/issue-74/run-b.log
