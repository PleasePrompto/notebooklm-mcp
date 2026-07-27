# RUN-AUDIT — execution runbook for a separate Claude daemon

**Mission.** Execute the issue-#74 DOM audit against the two planned notebooks,
then produce a reliable aggregate verdict on **open question #1** (does the Gemini
reasoning node exist while generating and vanish once settled → is a *structural
skip* viable as the primary fix?), and fold the confirmed verdict back into
`research/issue-74/2026-07-26-issue-74-answer-gathering-research.md`.

You are a fresh session. Everything you need is in `research/issue-74/`. Work from
the **repo root**. **Read this whole file before acting.**

> **Two ways to run.** §2–§6 = a single audit (default probe). **§8 = the parallel
> A/B comparison** (`run-a.sh` + `run-b.sh`) that verifies the `--token-scope`
> fix — read §8 if that's what you're here for.

---

## 0. Context-budget rule (READ FIRST)

The audit writes large per-question artifacts (`timeline.jsonl`, `mutations.jsonl`,
`snapshots/*.html` — some HTML files are 100 KB+). **Do NOT read those into your own
context.** Your own reads are limited to the compact aggregates: `REPORT.md` and
`report.json`. For anything deeper (per-question verification, capturing localized
header strings, extracting an HTML fixture), **delegate to a subagent** via the Task
/ Agent tool and consume only its short returned summary. Concrete subagent prompts
are in §4. This keeps your window small enough to finish the whole job in one pass.

---

## 1. Hard prerequisites (a human must ensure these)

1. **The MCP server is stopped.** It holds the Chrome profile lock; the audit
   launches its own persistent context on the same profile. If it's running, the
   script falls back to a fresh (unauthenticated) profile and step 2 will abort.
2. **Auth exists.** The user has logged in at least once via the MCP (`setup_auth`)
   so the profile has valid Google cookies.

You cannot perform login yourself (2FA/interactive). If step 2 aborts with
"Not authenticated", STOP and report exactly that to the human — do not try to
automate login.

Also confirm you're on the branch that carries these files (the probe imports the
PR's exported `isThinkingStep`/`isPlaceholder`, so it must sit on top of PR #75):

```bash
git branch --show-current      # expect research/issue-74-dom-audit (or the PR branch)
ls research/issue-74/plan.json research/issue-74/dom-audit.ts
```

---

## 2. Pre-flight + execute

**Pre-flight (no browser, no quota):**
```bash
npx tsx research/issue-74/dom-audit.ts --plan research/issue-74/plan.json --dry-run
```
Expect: `TOTAL NotebookLM calls: 12` and a per-notebook breakdown (6 + 6). If the
count differs, inspect `plan.json` before continuing.

**Execute (real run — 12 NotebookLM calls, ~10–20 min).** Run in the background so
you're not blocked, and tee a log:
```bash
npx tsx research/issue-74/dom-audit.ts --plan research/issue-74/plan.json --headless --yes \
  2>&1 | tee research/issue-74/last-run.log
```
Run this with the Bash tool's `run_in_background: true`. The harness re-invokes you
when it exits. While waiting, do nothing that assumes results exist.

- Free tier is 50 queries/day; 12 is safe. If you see a rate-limit message in the
  log, the remaining questions will still be attempted — note which succeeded.
- If answers come back empty or many rows show `TIMEOUT`, the headless render may be
  the cause: re-run with `--show` instead of `--headless`.

Completion looks like: `✅ Done. Report: <…>/dom-audit-runs/<runId>/REPORT.md`.
Capture that `<runId>` path — call it `$OUT` below.

---

## 3. Reliability checks (before you trust the aggregate)

Run these directly (they're tiny):
```bash
OUT="dom-audit-runs/<runId>"                       # from the Done line
find "$OUT" -name error.txt                          # any failed questions?
python3 -c "import json;d=json.load(open('$OUT/report.json'));print('rows',len(d))"  # expect 12
grep -c '"timedOut": true' "$OUT/report.json" 2>/dev/null || true
```
- **error.txt present** for a question → that call failed (e.g., chat input not
  found). Re-run just that notebook: copy `plan.json` to a temp file with only the
  failing notebook/question and `--plan` that, or re-run the whole plan if several
  failed. Merge is by run folder; simplest is to re-run the whole plan if >2 failed.
- **rows < 12** → some questions never produced a summary; treat as failures above.
- **timedOut true** on a row → that answer never settled; the row's verdict fields
  are unreliable, exclude it from the verdict and note it.

Do not proceed to §5 until every non-excluded row has a `summary.json`.

---

## 4. Read results — via subagents (context-safe)

**You read directly:** `$OUT/REPORT.md` (the human-readable aggregate) and, if you
need raw numbers, `$OUT/report.json`. Nothing else.

**Delegate everything heavier.** Spawn these with the Task/Agent tool
(`general-purpose`), one per bullet, and keep only the short return:

- **Per-notebook digest** (run once per notebook; saves you reading 6 summaries each):
  > Read every `summary.json` under `<$OUT>/<slug>*__*/` (Australia: `australia-travel*`,
  > China: `china-travel*`). Do NOT read `timeline.jsonl`/`mutations.jsonl`/snapshots
  > unless a summary field is missing or self-contradictory. Return a markdown table:
  > `question(≤48c) | settledMs | thinkingEverSeen | thinkingSeenWhileEnabled |
  > thinkingGoneAtSettle | shadow.returned & wasThinking | observedThinkTags`.
  > Then 3 lines: (a) was any thinking node present while `disabled===false`?
  > (b) did the thinking node vanish by settle in every question? (c) did the shadow
  > extractor ever return thinking text? Return ONLY the table + those 3 lines.

- **Localized header capture (OQ3)** — for the JA and PL questions only:
  > For the Japanese and Polish questions (their `summary.json` has non-Latin
  > `question`), report the exact localized reasoning-header token(s): read
  > `summary.json`→`observedThinkTags`; if empty, read the first ~60 lines of that
  > question's `timeline.jsonl` and collect distinct `thinkTokens`. Return only:
  > `locale → header token(s) observed`, one line per question.

- **Fixture extraction (only if §5 concludes the text heuristic must stay as a
  fallback)** — for one JA question that shows the collapsed form:
  > In `<$OUT>/<that-qDir>/snapshots/`, find the snapshot whose filename contains
  > `true` for disabled and a thinking node present, read it, and return ONLY the
  > `outerHTML` of the reasoning node (`thinking-chain-view` / `.thinking-chain` /
  > whatever tag is present) and its immediate answer-paragraph sibling — trimmed to
  > <1500 chars. This becomes a regression-test fixture.

---

## 5. Aggregate verdict (the deliverable)

Compute from `report.json` (REPORT.md already states these; confirm them):

> **⚠️ token-scope caveat.** Check `REPORT.md`'s header line `token-scope: …`. The probe
> now defaults to `turn` (correct). Only with `token-scope: body` (legacy; opt-in via
> `--token-scope body`) are `thinkingSeenWhileEnabled` and
> `thinkingGoneAtSettle` **known false positives** (the `thinkTokens` walk sweeps
> persistent out-of-turn chrome — see §8 / findings-doc OQ1). Do NOT read those two
> fields at face value on a `body` run: cross-check ground truth via the last line of
> each `timeline.jsonl` (`present["thinking-animation"]`/`[".thinking-message"]` == 0
> at settle ⇒ node genuinely gone), or re-run with `--token-scope turn`.

**Structural skip is viable as the PRIMARY fix iff, across all non-excluded rows:**
- `thinkingSeenWhileGenerating` is true for every row **that saw a thinking node**, AND
- `thinkingSeenWhileEnabled` is **false for every row** (the node never lingers after
  the textarea re-enables), AND
- `thinkingGoneAtSettle` is true for every row.

Decision:
- **All three hold** → structural skip = **primary**; PR #75's `isThinkingStep()` is a
  *fallback only* (and per the findings doc, still unproven — needs battle-testing).
- **`thinkingSeenWhileEnabled` true anywhere** → a pure "node-absent ⇒ final" rule is
  unsafe → structural skip must be paired with the soft generation-gate (OQ2), and the
  text heuristic stays a real fallback.
- **Thinking node never detected at all on some builds** → the reasoning must be
  streaming outside a distinct component there → the text heuristic can't be dropped.

Also record, as the live bug evidence:
- count of rows where `shadow.returned && shadow.wasThinking` (= #74 reproduced on
  this branch), and
- count where `finalWasThinking` (= contamination of the settled answer).

---

## 6. Write the verdict back

Edit `research/issue-74/2026-07-26-issue-74-answer-gathering-research.md`:
- **OQ1** — replace the `[evidence → audit]` tag with `[confirmed by audit YYYY-MM-DD]`
  and state the verdict + the three counts above and the `observedThinkTags` actually
  seen. Keep it factual.
- **OQ3** — append the localized header tokens captured per locale (JA/PL) from §4.
- Add a one-line pointer at the top of §5 (open-question answers) to the run folder
  name and the git commit the run was executed on (`git rev-parse --short HEAD`).

Keep confidence tags honest: only mark things `[confirmed by audit]` that the data
actually shows; anything the run didn't cover stays flagged.

---

## 7. Guardrails

- **Never commit `dom-audit-runs/`** — it's git-ignored and contains real notebook
  answer text. If the human wants a shareable sample, put a **redacted** excerpt into
  `research/issue-74/` by hand.
- Only commit the findings-doc update if the human asks; otherwise leave it as a
  working-tree change and report what you changed.
- If you must re-run, prefer re-running the whole plan into a fresh `$OUT` over
  merging partial folders.

---

## 8. Parallel A/B comparison — token-scope fix verification

**Why.** The OQ1 audit found a probe regression: the think-ish class histogram
(`thinkTokens`) is collected over the whole `document.body`, which sweeps in
PERSISTENT out-of-turn chrome (`mat-form-field-animations-enabled`,
`ng-animate-disabled`, `emoji-keyboard__loading-message`) that `THINK_TOKEN_RE`
matches on `animat`/`loading`. That pins `thinkPresent` true forever, so
`thinkingSeenWhileEnabled` and `thinkingGoneAtSettle` read as false positives. The
fix scopes the walk to the answer turn. `dom-audit.ts` takes **`--token-scope body|turn`**;
following the 2026-07-26 A/B verification below, **`turn` is now the default** — pass
`--token-scope body` only to reproduce the legacy/buggy false readings. This section runs
both variants in parallel and compares them (both scripts pass the flag explicitly, so the
default change does not alter what they do).

| Script | Probe | Scope flag | Plan | Output |
|---|---|---|---|---|
| `run-a.sh` | current / buggy | `--token-scope body` | `plan.json` (Australia+China) | `dom-audit-runs/A-body/<runId>/` |
| `run-b.sh` | **fixed** | `--token-scope turn` | `plan-b.json` (**your 2 notebooks**) | `dom-audit-runs/B-turn/<runId>/` |

### Before running
1. **Fill `plan-b.json`** — replace the two `REPLACE-WITH-YOUR-NOTEBOOK-ID-*` URLs with
   your 2 notebooks (any topic; keep the 6 question shapes). `run-b.sh` refuses to start
   until you do.
2. **MCP server stopped** and **auth exists** (§1). Both scripts launch an ISOLATED,
   CLONED profile (`NOTEBOOK_PROFILE_STRATEGY=isolated NOTEBOOK_CLONE_PROFILE=true`), so
   they don't fight over the base Chrome lock — but the base profile must be **idle at
   launch** (MCP stopped), else the clone copies live lock files. Each clone is ~138 MB
   and auto-prunes on shutdown.
3. **Quota:** each run = 12 calls → **24 total**. Free tier is 50/day; mind other runs
   already made today. Trim `plan-b.json` (and/or `plan.json`) to fewer questions if close
   to the cap — the metric flip shows on any single question.

### Run them (parallel)
Launch each in its own background shell (Bash tool `run_in_background: true`) or two
terminals — order doesn't matter, they're isolated:
```bash
./research/issue-74/run-a.sh    # tees research/issue-74/run-a.log
./research/issue-74/run-b.sh    # tees research/issue-74/run-b.log
```
Each ends with `✅ Done. Report: …/A-body/<runId>/REPORT.md` (resp. `B-turn`). Run §3's
reliability checks on each `<runId>` before trusting it.

### Compare
Read only each run's `REPORT.md` (header prints `token-scope: body|turn`). Decisive rows:

| Signal | Run A (`body`) expected | Run B (`turn`) expected |
|---|---|---|
| Seen while ENABLED | **12/12 ⚠️ (false +)** | **~0/12** |
| Gone at settle | **0/12 (false −)** | **~12/12** |
| Reasoning node ever seen · while generating | 12/12 · 12/12 | 12/12 · 12/12 |
| shadow returned THINKING · finalWasThinking | 0/12 · 0/12 | 0/12 · 0/12 |

If Run B flips the first two rows while the named-component and shadow rows stay
identical, the regression is confirmed as a **pure tooling artifact** and `turn` is the
fix. Runs A and B use DIFFERENT notebooks, so read this as "does the scope change the
metric class" (structural, notebook-independent) — not a same-notebook diff.

> **Ground-truth cross-check** (independent of the aggregate, works on either run): the
> reasoning component is truly gone at settle iff the LAST line of each question's
> `timeline.jsonl` has `present["thinking-animation"]` / `present[".thinking-message"]`
> == 0. That bypasses the `thinkTokens` bug entirely. (Delegate the `tail`-and-parse to a
> subagent per §0 if you want to stay context-safe.)

### Guardrails
- `dom-audit-runs/` stays git-ignored (§7) — never commit A-body/B-turn outputs or the
  `run-*.log` files (they contain real answer text; the logs hold questions + metrics).
- Stale isolated clones (if a run is killed) live under
  `~/Library/Application Support/notebooklm-mcp/chrome_profile_instances/instance-*`.
```
