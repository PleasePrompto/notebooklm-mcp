# Issue #74 — answer gathering: findings & open-question answers

> **One-off PR artifact.** This directory (`research/issue-74/`) exists to give
> reviewers of PR #75 the full context and a reproducible DOM probe. Intended to
> be **deleted before merge** (`git rm -r research/issue-74`). Nothing in `src/`
> imports it; it is excluded from `tsc`/`eslint` (both scoped to `src/`).

- **Issue:** #74 — `ask_question` returns Gemini's extended-thinking text instead of the final answer.
- **PR under review:** #75 — adds `isThinkingStep()` text heuristic.
- **Repo commit at time of writing:** branch `fix/issue-74-thinking-step` (PR #75 head).

---

## 1. What actually breaks

Gemini 2.5 renders an **extended-thinking block into the same
`.to-user-container .message-text-content`** element that later holds the real
answer. The capturer, `waitForStableAnswer()` in `src/notebooklm/chat.ts`,
returns whatever text is unchanged across `stablePolls` (3) polls of 750 ms
(~2.25 s). The thinking block is "stable" far longer than that while the model
reasons, so it is returned as the answer.

**This is a classification bug, not a timing bug.** Raising `timeout_ms` cannot
fix it — the thinking text is stable *by the time the timer would matter*.

### Three observed surface forms (this is the crux for evaluating any fix)

| # | Form | What `ask_question` returns | Caught by PR #75? |
|---|------|------------------------------|-------------------|
| 1 | **Expanded reasoning prose** — `"Defining the Scope\nI'm now zeroing in on…"` | the reasoning prose | ✅ yes |
| 2 | **Collapsed header** — DOM text is `"Thoughts\nexpand_more"`; `sanitizeAnswer()` strips `expand_more` → bare `"Thoughts"` | the word `"Thoughts"` | ❌ **no** |
| 3 | **Prefix contamination** — capture lands after the answer renders, text is `"Thoughts\n<answer>"` | correct answer **with** a `"Thoughts\n"` prefix (reported 10/10 answers) | ❌ **no** |

Reporters: original (`alexlee0213`, form 1), `lazydive` (form 2, with an
instrumented 750 ms probe + DOM tree), `kkubikowski` (form 2/3, tested patch).

---

## 2. Current-code walkthrough (file:line)

Call path: `handlers.ts:handleAskQuestion` → `browser-session.ts:ask()` →
`chat.ts:waitForStableAnswer()` → `citations.ts:extractCitations()`.

- `src/notebooklm/chat.ts:227-304` — `waitForStableAnswer()`. The **only** lever
  that makes the loop wait longer is classifying the current text as a placeholder
  (`chat.ts:275-280`, resets streak & continues). Errors/rate-limits return
  immediately (`chat.ts:284-286`); otherwise N stable polls → return
  (`chat.ts:288-296`).
- `src/notebooklm/chat.ts:310-321` — `readLatestAnswer()` reads
  `.to-user-container:last-child .message-text-content` (`selectors.ts:34`).
  **The thinking block and the answer are read through the same selector** — no
  separation.
- `src/notebooklm/chat.ts:28-104,175-182` — `PLACEHOLDER_SNIPPETS` + `isPlaceholder()`.
  Contains `"thinking"` but **not `"thoughts"`**; short-text rule only fires on
  `length < 50 && endsWith("...")`. So bare `"Thoughts"` slips through (form 2).
- `src/notebooklm/chat.ts:329-358` — `sanitizeAnswer()` strips `uiControlLabels`
  lines incl. `expand_more` (`selectors.ts:382-397`) — which is *how*
  `"Thoughts\nexpand_more"` collapses to `"Thoughts"`. It has **no** rule to drop a
  `"Thoughts"` header line (form 3).
- `src/session/browser-session.ts:694-703` — `detectRateLimitError()` already reads
  `textarea.query-box-input`'s `disabled` state (for rate-limit detection). So the
  "textarea disabled ⇒ still generating" signal the reporters propose is already
  observable in the codebase, just used elsewhere.
- `src/notebooklm/citations.ts:85-116` — citation markers are found via
  `button.citation-marker` inside the latest `.message-text-content`, independent of
  chat text extraction.

---

## 3. Evaluation of PR #75

PR #75 adds `isThinkingStep()` (gerund-title + first-person planning regex, or a
first-person opener) into `isPlaceholder()`, plus real tests and an `npm test`
runner. It **reliably fixes form 1**. Verified: `npm test` → 4/4 pass; build clean.

Gaps (why it's a good first iteration but not complete):

1. **Form 2 not caught** — `"Thoughts"` is neither a gerund header nor a
   first-person opener. `lazydive` checked this against the PR's own regexes.
2. **Form 3 not stripped** — the PR touches neither `sanitizeAnswer()` nor the
   snippet list, so the `"Thoughts\n"` prefix still rides on real answers.
3. **English/gerund-centric** — the reasoning header/prose is **localized** (see
   OQ3), so PR #75's gerund + first-person *English* regex won't match localized
   thinking blocks at all; any wording heuristic here must cover every locale
   (harder than the substring snippet list) and is fighting a multilingual,
   moving target.
4. **Skips the two content-independent hardenings** both reporters recommend as
   *primary*, with the text heuristic as *fallback*: a **structural skip** of the
   reasoning node, and a **generation-complete gate** on the disabled textarea.

---

## 4. The DOM probe (`dom-audit.ts`) — what it measures & why

Hand-listing class names is error-prone and misses transient nodes. The probe
instead **records the DOM as it changes**, keyed to tag names/classes
(language-independent) and correlated with the generation state:

- `mutations.jsonl` — every element add/remove + class-flip inside the answer turn
  and every textarea `disabled` flip, timestamped (a `MutationObserver`). Ground
  truth for *when a node appears / vanishes*.
- `timeline.jsonl` — a 250 ms existence-sampler: for each candidate node, present?
  collapsed? vs `textarea.disabled`, **plus an auto-discovered histogram of every
  descendant tag and every think-ish class token** — so a *renamed* node is caught
  without us naming it.
- `snapshots/*.html` + `shots/*.png` — the answer turn at each phase transition
  (collapsed / expanded / settled) → real fixtures for offline tests.
- `summary.json` per question + top-level `REPORT.md` — a **shadow replay** of the
  shipping extractor (`sanitizeAnswer`+`isPlaceholder`+`isThinkingStep` at the
  production 750 ms/3-poll cadence) that shows, per question, whether the current
  branch would still return thinking text (a live #74 repro) and whether the final
  captured text is still contaminated.

Default question set is designed to trigger all three forms (short, long-synthesis,
table-request, JA, PL). Reuses the app's auth/profile/stealth — no re-login.

See `README.md` for how to run.

---

## 5. Answers to the open questions

> **Audit run:** `dom-audit-runs/2026-07-26T08-34-45-383Z` — 12 questions × 2 notebooks
> (Australia + China), question set covering short/long-synthesis/table/comparison EN
> plus JA and PL. Executed 2026-07-26 on commit `a66ac11` (with a local, uncommitted
> tooling shim in `dom-audit.ts` — `tsx`/esbuild `keepNames` injects `__name(...)` into
> `page.evaluate` functions, undefined in the browser; the shim primes `window.__name`
> as a no-op after the app renders. No measurement logic changed.) 11/12 rows settled;
> the Australia table question timed out at 180 s and is excluded from the OQ1 verdict.
> See `REPORT.md` / `report.json` in that folder.
>
> **Corroborating re-run:** `dom-audit-runs/2026-07-26T09-55-45-415Z` — commit `ffccbcb`
> (current committed probe, no shim), headless, same 2 notebooks × 6 questions (EN/JA/PL).
> All **12/12 settled, 0 timeouts**. It reproduces OQ1's vanish-at-settle finding from the
> ground-truth timeline, **but two of its `report.json` lifecycle aggregates read backwards
> due to a probe regression** — see the OQ1 tooling caveat below before trusting that file.

Confidence tags: **[code]** = answerable now from the source; **[audit]** =
resolved by running `dom-audit.ts`; **[evidence]** = inferred from issue reporters'
data pending audit confirmation.

### OQ1 — Do `thinking-chain-view` / `.thinking-chain` / `thinking-animation` / `.thinking-message` reliably exist during generation and vanish once settled?
**CONFIRMED: YES — a structural skip is viable as the PRIMARY fix; PR #75's
`isThinkingStep()` drops to a fallback-only layer (and per §3/OQ5 still unproven).
[confirmed by audit 2026-07-26]**
`lazydive`'s instrumented probe (en-US, 2026-07) shows `thinking-chain-view`
(`div.thinking-chain[.--collapsed]`) present during generation, with the textarea
`disabled` throughout and `enabled` at settle; `kkubikowski` corroborates.
PR author (`chaki8923`) reports the *settled* turn has no such class — which is the
same claim viewed at the end state ("present while generating, gone once settled").
The apparent contradiction in the thread dissolves under that timing reading.
`dom-audit.ts` answered this definitively per notebook/locale via the
`thinkingSeenWhileGenerating` / `thinkingSeenWhileEnabled` / `thinkingGoneAtSettle`
verdicts, with rename detection via the tag/class histogram.

**Audit result** (12 questions across 2 notebooks × EN/JA/PL; the Australia table
question timed out at 180 s and is excluded from the verdict per the run's reliability
rules — its fields happened to agree anyway):

- Reasoning node **ever seen: 12/12**; **seen while generating (textarea `disabled`):
  12/12**; **seen while the textarea was ENABLED: 0/12**; **gone at settle: 12/12.**
  All three primary-viability conditions hold on every non-excluded row → the structural
  skip is confirmed as primary.
- **`observedThinkTags` actually seen — uniform across both notebooks and all locales:
  `thinking-animation`, `thinking-animation-container`, `thinking-message`.** The
  originally hypothesized `thinking-chain-view` / `.thinking-chain` did **not** appear on
  this build — Google renamed the reasoning node, and the probe's auto-discovery caught
  it. This is exactly why a hard-coded selector list is fragile: the structural skip must
  key on the auto-discovered reasoning component (any `thinking-*` node), not a fixed name.
- **Live-bug evidence:** shadow extractor returned THINKING text
  (`shadow.returned && shadow.wasThinking`) = **0/12** — #74 did **not** reproduce via the
  shadow replay on this branch. Final captured text still classified as thinking
  (`finalWasThinking`) = **1/12**, and that one row is the timed-out Australia table
  question (it never settled, so the captured text was still reasoning) — i.e.
  contamination-by-timeout, not settled-answer contamination. This reinforces OQ2: a soft
  generation-gate matters, because when generation does not settle within the window the
  captured text can still be reasoning.
- **Collapsed "Thoughts" text-header form: 0/12** — not reproduced on this build (see OQ3).
- **Important implementation caveat — the reasoning has TWO phases on this build, and the
  component vanishes BEFORE the answer settles.** (1) *Component phase:* the
  `thinking-animation`/`.thinking-message` node is present while `disabled=true` and gone
  by settle (what the metrics above measure). (2) *Summary-prose phase:* the component then
  disappears while the textarea is **still `disabled`**, and English gerund/first-person
  summary prose ("Selecting the Hiking Locations", "Defining the Objective", "Translating
  for Delivery") streams **into `.message-text-content`** — the same element the answer
  lands in, i.e. the actual #74 contamination surface (seen directly in the timed-out
  Australia table row, whose captured head is that prose). Consequence: a naive
  "reasoning-component absent ⇒ answer is final" rule is **unsafe** — it would latch on
  phase-2 prose. The structural skip is therefore primary **only when paired with the soft
  generation-gate on `textarea.query-box-input[disabled]`** (OQ5 layer 2 / OQ2): keep
  waiting while `disabled=true` regardless of the component, and PR #75's `isThinkingStep()`
  (which matches exactly this gerund/first-person prose) remains the fallback that catches
  phase-2 text if the gate is ever raced.

**Audit addendum — corroborating re-run 2026-07-26 (`dom-audit-runs/2026-07-26T09-55-45-415Z`,
commit `ffccbcb`, headless, 2 notebooks × EN/JA/PL, all 12 settled, 0 timeouts).
[confirmed by audit 2026-07-26]**
A second run on the *current committed* probe reproduces the vanish-at-settle result **and
exposes a probe regression that anyone re-running MUST heed**:

- **Ground truth (each question's `timeline.jsonl` settle sample): the NAMED reasoning
  component is absent at settle in 12/12** — `present["thinking-animation"]` and
  `present[".thinking-message"]` are both `0` at the settle sample, with the textarea
  `enabled` in 12/12 — while `reasoningComponentSeenWhileGenerating` = 12/12. So the reasoning
  node is present while generating and gone by settle, corroborating the primary run.
- **⚠️ Do NOT trust this run's `report.json` `thinkingSeenWhileEnabled` (reports 12/12) or
  `thinkingGoneAtSettle` (reports 0/12) — both are inverted false readings.** In commit
  `ffccbcb` the auto-discovery walk was widened to `document.body.querySelectorAll("*")`, and
  `thinkPresent`/`someThinkPresent` short-circuit on `thinkTokens.length > 0`. `THINK_TOKEN_RE`
  (`…|animat|loading|…`) therefore matches *permanent, non-reasoning* chrome that lives outside
  the answer turn — `mat-form-field-animations-enabled`, `ng-animate-disabled`,
  `ng-trigger-studioModalAnimation`, `emoji-keyboard__loading-message` — so the "thinking present"
  signal never clears. (The `a66ac11` primary run scoped the same walk to the answer turn, which
  is why its aggregates read correctly.) The same bug pins `reasoningInTextWhileDisabledSeen`
  (phase-2, gated on `!thinkPresent`) to always-false, so **this run's phase-2 = 0/12 is
  inconclusive, not evidence phase-2 is absent.** One-line fix if re-running: scope the
  `thinkTokens` walk to the answer turn, or tighten `THINK_TOKEN_RE` to `think|thought|reason|chain`.
- **Reliable counts (independent of the token bug):** shadow returned THINKING
  (`shadow.returned && shadow.wasThinking`) = **0/12** (#74 not reproduced on this branch);
  shadow returned a real ANSWER = 3/12, no-return = 9/12; **`finalWasThinking` = 0/12** and
  `finalHeaderPrefixDetected` = 0/12 (**no settled-answer contamination** — cleaner than the
  primary run, whose lone `finalWasThinking` was a timed-out row; here nothing timed out);
  `collapsedObserved` = 0/12; `placeholderEverSeen` = 12/12.
- **`observedThinkTags` actually seen (reasoning-specific):** `thinking-animation`,
  `thinking-animation-container`, `thinking-message` — same as the primary run;
  `thinking-chain-view` / `.thinking-chain` again did not appear. **Net: the
  structural-skip-as-primary-*paired-with*-the-soft-generation-gate conclusion stands, with PR
  #75's `isThinkingStep()` as fallback.** The re-run neither confirms nor refutes the two-phase
  contamination surface (its detector was disabled by the bug above), so that caveat is retained.

**Tooling regression — empirically confirmed by a parallel A/B run 2026-07-26.
[confirmed by audit 2026-07-26]**
`dom-audit.ts` gained a `--token-scope body|turn` flag and two runs were executed in parallel
(each in its own cloned, isolated Chrome profile): **A** = `--token-scope body` (whole-document
walk, the buggy default) on Australia+China → `dom-audit-runs/A-body/`; **B** = `--token-scope
turn` (answer-turn walk, the fix) on 2 different notebooks (Peru+Vietnam) → `dom-audit-runs/B-turn/`.
Result — the fix flips exactly the two poisoned metrics and nothing else:

| Signal | A (`body`, 12/12) | B (`turn`, 9/9 ok) |
|---|---|---|
| Seen while ENABLED | **12/12** (false +) | **0/9** |
| Gone at settle | **0/12** (false −) | **9/9** |
| ever seen · while generating · componentWhileGen | 12/12 · 12/12 · 12/12 | 9/9 · 9/9 · 9/9 |
| shadow returned THINKING · finalWasThinking | 0/12 · 1/12 | 0/9 · 0/9 |
| `observedThinkTags` union | 8 tags incl. `mat-form-field-animations-enabled`, `ng-animate-disabled`, `ng-trigger-studioModalAnimation`, `emoji-keyboard__loading-message(__icon)` | 3 tags — only `thinking-animation(-container)`, `thinking-message` |
| REPORT top-line verdict | ⚠️ NOT unconditionally | ✅ YES |

Two clinchers: (1) **in Run A's OWN `timeline.jsonl` settle samples the named component is absent
at settle in 12/12**, yet A's `gone@settle` metric reports 0/12 — the false negative caught inside
the buggy run's own data; B reads `gone@settle 9/9`, matching ground truth. (2) The 5 generic
Angular/Material/emoji classes present in A's tag union **vanish entirely** from B's — direct proof
the `body` walk was the thing collecting persistent out-of-turn chrome. Everything the scope should
NOT affect (shadow, named-component, while-generating) is identical across A and B. Under `turn`
scope the previously-dead phase-2 detector was live and read `reasoningInTextWhileDisabled` **0/9**
— a real (small-sample, different-notebook) measurement: no phase-2 contamination detected here,
though the two-phase caveat still stands pending a same-notebook, larger-N check. (Run B lost its
last 3 questions — LP-Vietnam q10–12, "chat input not found" — to daily-quota rate-limiting, not a
measurement fault; it stays conclusive on 9/9.) **Fix applied: `dom-audit.ts` now defaults to
`--token-scope turn`; pass `--token-scope body` only to reproduce the legacy false readings.**

### OQ2 — Would a generation-gate on the disabled textarea hang when rate-limited?
**Safe on the common path, but the gate MUST be soft/bounded. [code]**
In `waitForStableAnswer` the error/rate-limit check returns *before* any stability
accept (`chat.ts:284-286`), so a rate-limit that renders recognizable text is
returned regardless of a disabled-gate. The only risk is a rate-limited state where
the input is `disabled` but the container shows **no** matching error/rate-limit
text — a hard "don't accept unless enabled" gate would then spin to the 600 s
timeout, and `detectRateLimitError()` (which runs *after* `waitForStableAnswer`)
would never fire. Mitigation: make it a **soft gate** — prefer enabled, but still
accept text that has been stable for K extra polls even while disabled. The audit's
`disabled` trace (and a deliberate rate-limit run) will show whether that state
exists in practice.

### OQ3 — Is the collapsed header always English `"Thoughts"` or localized?
**Localized — the header follows the UI/answer language, NOT always English. Leave
the exact per-locale handling as an implementation-phase problem. [confirmed by project owner]**
Some issue-thread data points read as English-only, but the project owner confirms
the reasoning header **is localized** across NotebookLM's locales. This makes any
wording/regex heuristic — including a `"Thoughts"`-style header regex — fragile: it
would need per-locale coverage like `PLACEHOLDER_SNIPPETS` and would still break on
any unlisted locale. It strengthens the case for a **tag-based structural skip**,
which never reads the header text and so sidesteps localization entirely. Do not
block the structural approach on enumerating header strings; if a text fallback is
kept, collecting the localized headers (the audit's `thinkTokens` histogram + `--hl`
sweep helps) is an **open task for the implementation phase**.

**Audit addendum (2026-07-26 run, JA + PL questions). [confirmed by audit 2026-07-26]**
On the current Gemini Notebook build the reasoning surfaced as a *language-independent
component* — `thinking-animation` → `.thinking-animation-container` →
(`.thinking-animation` Lottie spinner + `.thinking-message`) — and **no localized header
text was surfaced for either locale**:
- **JA → no localized reasoning header/label.** The `.thinking-message` label was English
  from a rotating pool (e.g. "Examining the specifics…", "Processing material…",
  "Gathering the facts…") and the extended-thinking summary prose that streams next was
  **also English** (e.g. "Defining the Objective", "Translating for Delivery",
  "Finalizing Shanghai Details") before flipping to the localized final answer at settle.
- **PL → no localized reasoning header/label.** Same English rotating pool (e.g. "Scanning
  the text…", "Parsing the data…", "Sifting through pages…") + English gerund summary
  prose (e.g. "Defining the Itinerary", "Integrating Polish Suggestions").

So on this build the reasoning text is English regardless of prompt/answer language, and
the collapsed **"Thoughts"** text-header form this OQ is about was **not reproduced** — the
project owner's localization note is therefore neither confirmed nor refuted by the audit
(likely a different UI state/build). Net effect either way: the reasoning node is a
distinct, language-independent component, so the **tag-based structural skip sidesteps
localization entirely.** If the text fallback is kept, note the reasoning prose observed
here is English gerund/first-person text — exactly PR #75's target shape — so
`isThinkingStep()` would catch the forms *this* run produced; enumerating localized
*collapsed-header* strings remains an open implementation-phase task (none appeared here to
sample). Reasoning-node fixture for tests (captured `china-travel__def__q07` snapshot):
`thinking-animation > .thinking-animation-container > (.thinking-animation[Lottie] +
.thinking-message.is-changing "…")`.

**OQ3 corroboration — re-run 2026-07-26 (`dom-audit-runs/2026-07-26T09-55-45-415Z`, commit
`ffccbcb`). [confirmed by audit 2026-07-26]**
Both Japanese and both Polish questions again surfaced **no localized reasoning-header text** —
the reasoning appeared only as the language-independent component (`thinking-animation` /
`thinking-animation-container` / `thinking-message`). Across all four localized questions, every
captured token in both `summary.json`→`observedThinkTags` and the timeline `thinkTokens` field was
a CSS class/element name (e.g. `thinking-message`), **never** a Japanese or Polish label. Per-locale
header tokens observed: `JA → (none — class-based component only)`, `PL → (none — class-based
component only)`. Reconfirms: the tag-based structural skip sidesteps localization; no
collapsed-header strings appeared to sample on this build.

### OQ4 — Does a structural skip interfere with citation extraction?
**No, if implemented as read-time filtering rather than DOM mutation. [code]**
Citations are discovered independently in `citations.ts:85-116` via
`button.citation-marker` inside the answer paragraphs
(`labs-tailwind-structural-element-view-v2`), not inside the reasoning block. Two
implementation notes: (a) extract answer text by reading only the answer-paragraph
nodes / excluding the reasoning node — do **not** mutate/remove DOM nodes, or if you
do (the "hide then restore" approach), restore **before** `extractCitations` runs
(citations run after `ask()` in `handlers.ts:151`); (b) `lazydive` notes cloning a
node and reading `textContent` loses `innerText` paragraph breaks, so prefer
`innerText` on the retained nodes.

### OQ5 — Should the fix be layered?
**Yes — recommendation. [recommendation]**
Both reporters frame the text heuristic as a *fallback*. Suggested layering:
1. **Primary:** structural read — extract `innerText` of the answer-paragraph nodes
   only, excluding the reasoning node (tag-based, locale-independent). *(Gate on
   OQ1 audit result.)*
2. **Gate:** soft generation-complete gate on `textarea.query-box-input[disabled]`
   (bounded per OQ2).
3. **Fallback (unproven — must be battle-tested before relying on it):** PR #75's
   `isThinkingStep()` for builds where reasoning streams outside the component. Treat
   it as a *candidate* layer, not a confirmed one — it's a text-shape heuristic that
   can be flaky: false positives on genuine gerund-headed / first-person answers,
   false negatives on localized or collapsed headers (OQ3). Only promote it to
   fallback after validating against a corpus of real answers + captured thinking
   samples across notebooks and locales (the audit's `snapshots/*.html` and the
   shadow-replay `wasThinking` results are the test material).
4. **Defense-in-depth:** strip a leading reasoning-header line in `sanitizeAnswer()`
   (kills form 3 even if 1–3 miss) — but note the header is localized (OQ3), so this
   needs the per-locale header words, an implementation-phase task.

### OQ6 — Are timing changes needed?
**No. [code + evidence]** All three reporters agree raising `timeout_ms` does not
help; `stablePolls`/`pollIntervalMs` are not the problem. Do not "fix" via timing.

### OQ7 — Branch/scope hygiene.
**The #74 fix must stay on its own branch. [code]** The dual-host auth work
(`auth-manager.ts`, `browser-session.ts`, `utils/notebook-domain.ts`, branch
`fix/notebook-google-com-host`) is unrelated to #74. PR #75's branch
`fix/issue-74-thinking-step` is correctly isolated; keep any follow-up there.

---

## 6. Suggested next step

Run `dom-audit.ts` against 2–3 real notebooks with the default question set (and
`--hl ja --hl pl`), read `REPORT.md`, and use `thinkingSeenWhileEnabled` to decide
whether the structural skip can be **primary** (with PR #75 as fallback) or must
stay a **fallback** behind the text heuristic. Either way, add form-2/form-3
coverage (currently missing) using the captured `snapshots/*.html` as fixtures.

---

## 7. Issue-#74 aspect coverage

Cross-check of every aspect raised in issue #74 (body by `alexlee0213`, plus the
`kkubikowski` and `lazydive` comments) and in PR #75, against this analysis + the
DOM audit. All aspects are addressed; the audit-v2 metrics that back the three
formerly-open items are noted below the table.

| # | Aspect raised in the issue / PR | Source | Addressed — where |
|---|---|---|---|
| 1 | Core bug: `ask_question` returns the thinking trace, not the answer | issue body | ✅ §1 |
| 2 | Root cause: `isPlaceholder`/`PLACEHOLDER_SNIPPETS` miss the new shape | issue body | ✅ §1, §2 |
| 3 | Text heuristic (title + first-person) **+ multilingual** coverage | issue body | ✅ §3, OQ3, OQ5 (implemented by PR #75) |
| 4 | **Key off a DOM class + fresh selector audit** | issue body | ✅✅ the DOM audit itself — OQ1, §4 |
| 5 | Require a **prior placeholder** state before accepting "stable" | issue body | ✅ note A below (v2: `placeholderEverSeen`, `priorPlaceholderGate`) |
| 6 | Form 2: bare collapsed **"Thoughts"** header (PL locale) | kkubikowski | ✅ §1 form 2 |
| 7 | `PLACEHOLDER_SNIPPETS` has `"thinking"` but not `"thoughts"` | kkubikowski | ✅ §2 |
| 8 | Raising `timeout_ms` doesn't help (classification, not timing) | kkubikowski | ✅ §1, OQ6 |
| 9 | Anchored `THINKING_HEADER_RE` for the bare header | kkubikowski | ✅ §3 gap 1, OQ5 L4 |
| 10 | Soft generation-gate on `textarea[disabled]` | kkubikowski + lazydive | ✅✅ OQ2, OQ5 L2 (audit: `thinkingSeenWhileEnabled` = 0/12) |
| 11 | Strip the leaked header line in `sanitizeAnswer()` | kkubikowski | ✅ OQ5 L4, note C below |
| 12 | Header text is **locale-bound** | kkubikowski + lazydive | ✅ OQ3 + audit addendum |
| 13 | Single-word "Thoughts" / `expand_more` collapse mechanism | lazydive | ✅ §1, §2 |
| 14 | A **dedicated reasoning component** exists (vs answer paragraphs) | lazydive | ✅✅ OQ1 + note B below (v2: `reasoningComponentSeenWhileGenerating`) |
| 15 | Skip components **structurally**; hide/restore; `innerText` not clone+`textContent` | lazydive | ✅✅ OQ4, OQ5 L1 |
| 16 | Relation to #75: collapsed form not matched by `isThinkingStep()`; structural covers both; #75 = fallback | lazydive | ✅✅ §3 gap 1, OQ5 |
| 17 | Header leaks into **settled** answers ("Thoughts\n<answer>", 10/10) | lazydive | ✅ note C below (v2: `finalHeaderPrefixDetected`) |

**Note A — issue suggestion #3 (require a prior placeholder). [confirmed by audit 2026-07-26]**
A placeholder/loading state was observed (appeared then went away) in the run, and
the audit-v2 shadow that *only* accepts after a placeholder has been seen
(`priorPlaceholderGate`) returned thinking text in the same count as the base shadow
(0 on the measured build). So suggestion #3 is a cheap, harmless defensive add but is
**not sufficient on its own** and is **not needed** once the structural skip + soft
generation-gate are in place — the gate subsumes it. `placeholderEverSeen` /
`priorPlaceholderGate` in `report.json` quantify this on any future run.

**Note B — PR #75's premise is refuted. [confirmed by audit 2026-07-26]**
PR #75 states *"there is no dedicated CSS class for the thinking block — so it must be
detected by shape."* The audit contradicts this: a **named dedicated component element
was present throughout generation** (`reasoningComponentSeenWhileGenerating` = 12/12) —
`thinking-animation` / `.thinking-message` / `thinking-animation-container` on this
build, `thinking-chain-view` / `.thinking-chain` in `lazydive`'s earlier build. The
component merely *renamed* over time (which the probe's auto-discovery caught). This
directly strengthens the case for the **structural skip as primary** over PR #75's
shape-only heuristic, and shows a hard-coded selector list would be brittle.

**Note C — form-3 settled-answer contamination not reproduced on this build. [confirmed by audit 2026-07-26]**
`lazydive` reported the `"Thoughts\n"` prefix on **10/10** settled answers. The audit
found **0** settled rows contaminated (`finalWasThinking`/`finalHeaderPrefixDetected` =
0 across the 11 settled rows; the single `finalWasThinking` = 1/12 was the timed-out
Australia-table row, i.e. contamination-by-timeout, not settled-answer contamination).
So form 3 appears **build-specific / already mitigated** on the current Gemini Notebook
build. OQ5 layer 4 (leading-header strip) therefore drops to cheap defense-in-depth
rather than a must-have — but keep it, since the form was real on other reporters' builds
and header text is localized (OQ3). Audit-v2 records `finalHeaderPrefixDetected` +
`finalFirstLine` per question so a re-run flags any regression.
