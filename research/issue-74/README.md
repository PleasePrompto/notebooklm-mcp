# research/issue-74 — reviewer materials for PR #75

**One-off, delete before merge:** `git rm -r research/issue-74`. Not referenced by
`src/`; excluded from `tsc`/`eslint` (both scoped to `src/`), so it does not affect CI.

Contents:
- **`2026-07-26-issue-74-answer-gathering-research.md`** — full analysis of issue
  #74, a walkthrough of the current extraction code, an evaluation of PR #75, and
  answers to the open questions.
- **`dom-audit.ts`** — a reproducible DOM probe that records how NotebookLM's answer
  turn evolves during generation, to settle the "structural skip vs. text heuristic"
  question with data instead of hand-picked class names.
- **`plan.example.json`** — the audit plan's shape: two notebooks with 6 grounded,
  shape-varied questions each (short / long / table / comparison / JA / PL). Copy it to
  `plan.json` and fill in your own notebook URLs — the real plan files are git-ignored,
  because a notebook URL is an access token.
- **`RUN-AUDIT.md`** — a self-contained runbook for a separate Claude session to
  execute the plan, read results **via subagents** (context-safe), aggregate a
  reliable verdict, and fold it back into the findings doc.

## Running the DOM probe

Prereqs: you have logged in once via the MCP (`setup_auth`), and the **MCP server is
stopped** (it holds the Chrome profile lock). Run from the repo root:

```bash
# THE planned audit (both notebooks, tailored questions, one aggregated REPORT):
npx tsx research/issue-74/dom-audit.ts --plan research/issue-74/plan.json --dry-run   # validate budget first
npx tsx research/issue-74/dom-audit.ts --plan research/issue-74/plan.json --headless --yes

# ad-hoc: active library notebook, default question set, visible browser
npx tsx research/issue-74/dom-audit.ts

# ad-hoc: specific notebook(s) + question(s)
npx tsx research/issue-74/dom-audit.ts \
  --notebook "https://notebooklm.google.com/notebook/XXXX" \
  --question "Summarise the main topic in one sentence." \
  --question "この資料の要点を3つ、日本語で。"
```

For an unattended, aggregated run driven by a separate Claude session, follow
**`RUN-AUDIT.md`** (it uses subagents to read the heavy per-question output).

Flags: `--plan <file>` (per-notebook tailored questions → one aggregated report),
`--dry-run` (validate the plan/budget, launch nothing), `--notebook <url>`
(repeatable), `--question <q>` (repeatable), `--all-notebooks`, `--hl <locale>`
(repeatable), `--headless` / `--show`, `--yes`/`-y` (skip the 5 s abort window),
`--out <dir>`.

Each run prints a plan with the **total NotebookLM call count** (free tier is
50/day) and waits 5 s to abort unless `--yes`.

## Output

Written to `dom-audit-runs/<timestamp>/` (git-ignored — it contains your notebook
answer text). Per question: `mutations.jsonl`, `timeline.jsonl`, `snapshots/*.html`,
`shots/*.png`, `summary.json`. Top level: `report.json` + **`REPORT.md`**.

Read `REPORT.md` first — it states the verdict on whether a structural skip is
viable as the primary fix, and whether the shipping extractor still mis-latches on
the thinking text (a live #74 reproduction).

> ⚠️ Raw output under `dom-audit-runs/` includes real answer text from your
> notebooks. It is git-ignored. If you want reviewers to see a sample, commit a
> **redacted** excerpt into this directory manually — don't commit the raw run.
