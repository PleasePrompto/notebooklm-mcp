#!/usr/bin/env bash
#
# Run A — issue #74 token-scope A/B comparison.
#   Probe variant : CURRENT / buggy  (--token-scope body = whole-document walk)
#   Notebooks     : Australia + China (plan.json)
#   Output        : dom-audit-runs/A-body/<runId>/REPORT.md
#
# Expected (buggy) headline metrics:  seenEnabled 12/12,  gone@settle 0/12.
#
# Runs in an ISOLATED, CLONED Chrome profile so it can execute IN PARALLEL with
# run-b.sh without both fighting over the base profile's Chrome lock. Auth is
# inherited from the saved state (state.json) + the cloned profile.
#
# PREREQ: the MCP server must be stopped (it holds the base profile lock, which
# would corrupt the clone). Auth must already exist (setup_auth run once).
#
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

export NOTEBOOK_PROFILE_STRATEGY=isolated
export NOTEBOOK_CLONE_PROFILE=true

npx tsx research/issue-74/dom-audit.ts \
  --plan research/issue-74/plan.json \
  --token-scope body \
  --out dom-audit-runs/A-body \
  --headless --yes \
  2>&1 | tee research/issue-74/run-a.log
