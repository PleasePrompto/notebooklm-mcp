# Phase 2 hand-off — implement the production fix for issue #74

**For:** `/create_plan`. This is the planning brief. Phase 1 (investigation) is **done and
committed**; Phase 2 = **implement the real answer-extraction fix in `src/`** so
`ask_question` returns the *settled answer* and never Gemini's extended-thinking trace.

Read `research/issue-74/2026-07-26-issue-74-answer-gathering-research.md` (the findings doc)
for full evidence — this brief is the actionable summary + code map. Don't re-derive the DOM
facts below; they're confirmed by audit.

---

## 1. Scope

**In scope (Phase 2):** change the answer capture path in `src/notebooklm/` so all three
observed "thinking" surface forms are handled, without hanging on rate-limits and without
breaking citation extraction. Add unit tests over redacted DOM fixtures.

**Out of scope / non-goals:**
- Timing changes (`timeout_ms`, `stablePolls`, `pollIntervalMs`) — **confirmed not the fix**
  (findings OQ6). Do not "fix" via timing.
- The `research/issue-74/` tooling (`dom-audit.ts`, `plan*.json`, `run-*.sh`) — it's a
  **one-off PR artifact slated for deletion before merge**; it ships nothing. Use it only as a
  regression harness (§6).
- Dual-host auth work (`auth-manager.ts`, `notebook-domain.ts`) — unrelated (findings OQ7).
  Keep Phase 2 on the #74 branch line only.

---

## 2. What Phase 1 established (build on these — confirmed by audit)

- **The bug is a classification bug, not timing.** Gemini renders a reasoning block that the
  capturer returns as the answer. Three surface forms (findings §1):
  1. **Expanded reasoning prose** ("Defining the Scope\nI'm now…") — caught by PR #75's
     `isThinkingStep()`.
  2. **Collapsed header** — DOM `"Thoughts\nexpand_more"` → sanitized to bare `"Thoughts"` —
     **NOT caught**.
  3. **Prefix contamination** — settled answer with a `"Thoughts\n"` prefix — **NOT caught**.
- **Reasoning-node lifecycle (the structural signal): CONFIRMED.** The reasoning is a
  **distinct, named component** — `thinking-animation` / `thinking-animation-container` /
  `.thinking-message` on the current build (the older `thinking-chain-view` / `.thinking-chain`
  did not appear; treat the selector list as auto-discovered, not hard-coded). It is present
  while generating (12/12) and **gone by settle (12/12, ground-truth)**; textarea is `enabled`
  at settle. It is a **structurally separate node from `.message-text-content`**.
- **Two-phase caveat (why structural-alone is unsafe):** the component vanishes *before* the
  answer settles; then English gerund/first-person **summary prose can stream into
  `.message-text-content`** while the textarea is **still `disabled`** — that's the real
  contamination surface. So "reasoning-component absent ⇒ answer is final" mis-latches on
  phase-2 prose. Structural skip is viable **only paired with a generation-gate**.
- **Localization:** on the audited build the reasoning surfaced as a **language-independent
  component** — no localized header *text* for JA/PL; the `.thinking-message` labels and the
  summary prose were **English regardless of prompt/answer language**. A tag-based structural
  read sidesteps localization entirely; a text/regex heuristic is fighting a multilingual,
  moving target.
- **Current-branch status:** with PR #75's `isThinkingStep()` present, the audit's shadow
  replay returned THINKING **0/12** and settled-answer contamination was ~0 — i.e. #74 does not
  reproduce on the measured builds. **This is not proof of robustness** (build/locale-specific);
  it means the fix should be layered defense-in-depth, not that no fix is needed.

Evidence: findings doc; audit run on commit `ffccbcb`; parallel A/B verification + tooling in
commit `f4d22b6` (this branch). Run folders `dom-audit-runs/A-body/`, `dom-audit-runs/B-turn/`
(git-ignored, local only).

---

## 3. Recommended fix — layered (findings OQ5). Plan should implement 1→2, keep 3, decide 4.

1. **PRIMARY — structural read.** Extract `innerText` of the **answer-paragraph nodes only**,
   excluding the reasoning component (tag-based, locale-independent). Read-time *filtering*, not
   DOM mutation. `[confirmed viable by audit]`
2. **GATE — soft generation-complete gate.** Prefer accepting only when
   `textarea.query-box-input` is **not `disabled`**; but **bounded/soft** so a rate-limited
   `disabled` state can't spin to timeout (findings OQ2). `[code-reasoned]`
3. **FALLBACK — `isThinkingStep()`** (already at `chat.ts:201`). Keep as a last-resort text
   heuristic; **unproven — must be battle-tested**, prone to false-pos on genuine gerund answers
   and false-neg on localized/collapsed headers. `[unproven]`
4. **DEFENSE-IN-DEPTH — strip a leading reasoning-header line in `sanitizeAnswer()`** (kills
   form 3). Needs per-locale header words; **none appeared as text on the audited build**, so
   this is low-priority defense, not a must-have. `[recommendation]`

---

## 4. Code map (current branch `research/issue-74-dom-audit` — verify before editing)

| Concern | Location | Note |
|---|---|---|
| Stability loop (add soft gate) | `src/notebooklm/chat.ts:272` `waitForStableAnswer()` | rate-limit/error returns *before* stability accept (~`chat.ts:284-286`) — the gate must not break that path |
| Answer read (make structural) | `src/notebooklm/chat.ts:355` `readLatestAnswer()` | currently reads `selectors.ts:34` `latestAnswerText` = `.to-user-container:last-child .message-text-content` — same selector for thinking + answer, no separation |
| Selectors | `src/notebooklm/selectors.ts:32-34` (answer) + add a **reasoning-node selector set** (`thinking-*` / `.thinking-message`) | keep it a *list*, auto-discovery showed the name changes over time |
| Header/label strip | `src/notebooklm/chat.ts:374` `sanitizeAnswer()` + `selectors.ts:382` `uiControlLabels` (has `expand_more`) | `sanitizeAnswer` collapses `"Thoughts\nexpand_more"`→`"Thoughts"`; no rule drops a leading `"Thoughts"` line (form 3) |
| Fallback heuristic | `src/notebooklm/chat.ts:201` `isThinkingStep()`, `:216` `isPlaceholder()`, `:28` `PLACEHOLDER_SNIPPETS` | `PLACEHOLDER_SNIPPETS` has `"thinking"` but **not `"thoughts"`** |
| Disabled-textarea signal (reuse for gate) | `src/session/browser-session.ts` `detectRateLimitError()` (findings §2 cites ~694-703) | already reads `textarea.query-box-input.disabled` — reuse, don't reinvent |
| Citations (don't break) | `src/notebooklm/citations.ts:40` `extractCitations()`; runs *after* `ask()` (findings cites `handlers.ts:151`) | citations found via `button.citation-marker` inside the latest answer, independent of text read. If you hide/restore DOM, **restore before** `extractCitations`; prefer read-time filter + `innerText` (not clone+`textContent`, which loses paragraph breaks) |

---

## 5. Decisions the plan must resolve

1. **Answer-node identification.** Exact DOM relationship between the reasoning component and the
   answer paragraphs (sibling? ancestor?) so the structural read reliably excludes reasoning and
   keeps the answer. Source ground truth from captured snapshots (§6), not guesswork.
2. **Filter vs hide/restore.** Findings favors read-time filtering (no DOM mutation). Confirm and
   pick one; if hide/restore, guarantee restore-before-citations.
3. **Soft-gate bound.** Concrete rule: e.g. "accept only when enabled; if still `disabled`, accept
   after K extra stable polls / a max-wait so rate-limit can't hang." Define K, the max, and the
   interaction with the existing early rate-limit return.
4. **How much text-layer to keep.** Extend `PLACEHOLDER_SNIPPETS` (add `"thoughts"`?) and/or the
   `sanitizeAnswer` header strip — vs relying on the structural read. Decide localized-header scope
   (none observed as text ⇒ likely defer, but keep a hook).
5. **Fixtures & tests.** Add form-2 / form-3 coverage (currently missing). Fixtures must be
   **REDACTED** — `dom-audit-runs/` snapshots contain real answer text and are git-ignored; do not
   commit them raw. Decide how to source small redacted `.html` fixtures (findings §4 / snapshots).

---

## 6. Verification / success criteria

- `ask_question` returns the settled answer for **all three forms**; never the reasoning trace;
  no leading `"Thoughts\n"` prefix.
- Does **not hang** on a rate-limited/disabled state (soft gate bounded); existing rate-limit
  detection still fires.
- **Citations still extracted** unchanged.
- `npm test` passes; **new unit tests** for the extractor over redacted fixtures covering form
  1/2/3 × EN/JA/PL.
- **Regression harness:** re-run `npx tsx research/issue-74/dom-audit.ts --plan … --headless`
  (now defaults to the correct `--token-scope turn`); expect `shadow returned THINKING = 0` and
  `finalWasThinking = 0`. (MCP server must be stopped; ~12 calls; free tier 50/day.)

---

## 7. Guardrails

- Stay on the #74 branch line (builds on PR #75 `fix/issue-74-thinking-step`); keep the fix
  isolated from unrelated auth work (OQ7).
- Never commit `dom-audit-runs/` (real notebook answers) or the `run-*.log` files — git-ignored.
- The fix lives in `src/`; the `research/issue-74/` dir is deleted before merge — don't build the
  production fix to depend on it.

---

## 8. Needed files (reference manifest)

Paths/lines verified on branch `research/issue-74-dom-audit` (HEAD `f4d22b6`) — re-confirm before
editing, line numbers drift.

### Edit — the fix
- **`src/notebooklm/chat.ts`** — the core. `waitForStableAnswer()` :272 (add the soft
  generation-gate), `readLatestAnswer()` :355 (make the read structural), `sanitizeAnswer()` :374
  + `PLACEHOLDER_SNIPPETS` :28 (form-3 header strip / snippet list), `isThinkingStep()` :201 &
  `isPlaceholder()` :216 (fallback layer — already present from PR #75).
- **`src/notebooklm/selectors.ts`** — `answerContainer`/`answerText`/`latestAnswerText` :32-34;
  `uiControlLabels` :382 (has `expand_more`). Add a **reasoning-node selector set** (`thinking-*`
  / `.thinking-message`) here.

### Edit-likely / read-and-guard
- **`src/notebooklm/citations.ts`** — `extractCitations()` :40. Must keep working; if the read
  hides/restores DOM, restore before this runs. Prefer read-time filter + `innerText`.
- **`src/session/browser-session.ts`** — `ask()` :363 (answer-capture entry that calls
  `waitForStableAnswer`), `extractCitations()` :531 (**runs after `ask()` returns** → the DOM
  must be restored by then), and `detectRateLimitError()` (reads
  `textarea.query-box-input.disabled` — **reuse for the soft gate**, don't reinvent).

### Read — context / call path (probably no edits)
- **`src/tools/handlers.ts`** — `handleAskQuestion()` :58 (orchestrates ask → citations; confirms
  ordering).
- **`src/index.ts`** — :246 dispatches `handleAskQuestion` (MCP tool wiring; check the tool
  description/return shape isn't affected).

### Tests
- **`test/chat.test.ts`** — the existing PR #75 unit tests (`isThinkingStep`/`isPlaceholder`/
  `sanitizeAnswer`). **Extend here** (or add `test/answer-extraction.test.ts`) with form-1/2/3 ×
  EN/JA/PL cases over **redacted** DOM fixtures.
- **Runner:** `npm test` → `node --import tsx --test test/*.test.ts` (see `package.json` :15). New
  files must match `test/*.test.ts`.

### Evidence / context (read-only — do not modify as part of the fix)
- **`research/issue-74/2026-07-26-issue-74-answer-gathering-research.md`** — full findings, OQ1–OQ7,
  the A/B tooling-regression proof. The authority for the DOM facts in §2 above.
- **`research/issue-74/RUN-AUDIT.md`** — how to run the audit / the parallel A/B harness (§6
  regression step).
- **`research/issue-74/dom-audit.ts`** + `plan.json` / `plan-b.json` / `run-a.sh` / `run-b.sh` —
  the regression harness (defaults to the correct `--token-scope turn`). Tooling only; ships
  nothing; deleted before merge.
- Redacted DOM fixtures for tests come from `dom-audit-runs/*/snapshots/*.html` — **redact before
  copying any into `research/issue-74/` or `test/`** (they contain real answers).

### External
- **Issue #74** (bug), **PR #75** (branch `fix/issue-74-thinking-step`, added `isThinkingStep`).
- Commits: **`ffccbcb`** (audit probe + first run) and **`f4d22b6`** (A/B harness + `--token-scope`
  fix + folded verdict).

### Do NOT touch / git-ignored
- **`dom-audit-runs/`** (real notebook answers) and **`research/issue-74/*.log`** — never commit.
- Timing knobs and the dual-host auth files (§1 non-goals).

**Invoke:** `/create_plan` with this file as the brief (`research/issue-74/PHASE-2-HANDOFF.md`).
