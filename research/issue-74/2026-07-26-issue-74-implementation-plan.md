# Issue #74 — Phase 2 Implementation Plan (answer-extraction fix)

**Branch:** `fix/issue-74-answer-extraction`, cut from `main` (50b3e7f, v2.0.0). Self-contained:
it does **not** depend on PR #75 (`fix/issue-74-thinking-step`), which is still unmerged — see
Phase 7 for why that dependency was dropped and what replaced it.
**Scope:** implement the production answer-extraction fix in `src/notebooklm/` so `ask_question`
returns the *settled answer* and never Gemini's extended-thinking trace — for **all three**
observed surface forms, **locale-independently**, **without removing any existing logic**, and
without hanging on a rate-limited/disabled state or breaking citation extraction.

> Source briefs (read-only authority): `research/issue-74/PHASE-2-HANDOFF.md`,
> `research/issue-74/2026-07-26-issue-74-answer-gathering-research.md`. DOM facts below were
> re-verified against the captured snapshots in `dom-audit-runs/` (git-ignored).

---

## Overview

The bug is a **classification bug, not a timing bug** (findings §1, OQ6). Gemini 2.5 renders a
reasoning block through the **same** selector the final answer uses
(`.to-user-container:last-child .message-text-content`, `selectors.ts:34`), so
`readLatestAnswer()` (`chat.ts:355`) returns the reasoning text.

We fix it with a **layered, defence-in-depth stack in which every layer keys on structure or on
language-agnostic Material icons — never on localized header words, and never on the *wording* of
the reasoning text**. The existing text heuristics on `main` (`PLACEHOLDER_SNIPPETS`,
`isPlaceholder`, `sanitizeAnswer`) are **retained unchanged in behaviour**.

Design decisions (locked with the project owner):
- **Reasoning-node match = generic family + named list.** Exclude any element whose tag *or*
  class matches `/thinking[-_]/i`, **plus** an explicit, extensible named list in `selectors.ts`
  (rename-resistant; matches the repo's `queryInput`/`submitButton` list pattern).
- **Localization escape-hatch = code constant + env override.** An empty-by-default
  `REASONING_HEADERS` set in `selectors.ts`, overridable at runtime via
  `NOTEBOOKLM_REASONING_HEADERS`. It is a *fallback hook only*; the icon-anchored strip handles
  the common collapsed-header case with no word list.

## Current State Analysis

Confirmed by reading the code and the captured DOM snapshots:

- **Shared selector, sibling nodes.** During generation, the latest `.message-text-content`
  contains a `<thinking-animation>` element as a **direct child**; at settle that node is gone
  and the answer sibling `<labs-tailwind-doc-viewer> → … → <div class="paragraph">` is present.
  Verified DOM (redacted):
  ```
  .to-user-container > mat-card > mat-card-content > .message-text-content
      ├─ (generating)  <thinking-animation class="ng-star-inserted"> … .thinking-message …
      └─ (settled)     <labs-tailwind-doc-viewer> … <div class="paragraph"> spans + button.citation-marker
  ```
  Reasoning node and answer node are **siblings** under `.message-text-content` — so reading the
  `innerText` of the non-reasoning element children excludes the reasoning node without any DOM
  mutation. (`dom-audit-runs/.../snapshots/00-*.html` vs `02-settled.html`; settled snapshots
  contain **0** `thinking` occurrences.)
- **`.thinking-message` labels are English regardless of locale** ("Looking for clues…") on
  JA/PL questions — confirming a tag-based read sidesteps localization (findings OQ3).
- **Textarea gate signal exists.** `textarea.query-box-input` is `disabled` while generating and
  `enabled` at settle (12/12). `browser-session.ts:703` already reads this for rate-limiting.
- `readLatestAnswer()` (`chat.ts:355`) reads the shared selector's `innerText` — no separation.
- `waitForStableAnswer()` (`chat.ts:272`) returns after N stable polls; rate-limit/error text
  returns **early** (`chat.ts:329-331`) *before* any stability accept — the gate must not break
  that path (OQ2).
- `sanitizeAnswer()` (`chat.ts:374`) strips `uiControlLabels` lines incl. `expand_more`
  (`selectors.ts:382`) — which is *how* `"Thoughts\nexpand_more"` collapses to `"Thoughts"`.
- Citations (`citations.ts:40`, called from `browser-session.ts:531` **after** `ask()` returns)
  run their own `page.evaluate` over `button.citation-marker`; they never touch chat text and are
  unaffected as long as we do **not** mutate the DOM.
- `test/` is **not** under `tsc` (`rootDir: ./src`, `include: src/**/*`); tests run via `tsx`
  (`node --import tsx --test test/*.test.ts`). New `test/*.test.ts` files just work.
- `dom-audit-runs/` and `*.log` are git-ignored (real notebook answers). Fixtures must be redacted.

### Key Discoveries
- **NEW (found while building the Phase 5 fixtures, 36 snapshots re-read):** the reasoning
  **component** and the reasoning **summary** are two different things.
  - Component (form 1): `<thinking-animation class="ng-star-inserted">` → `div.thinking-animation-container`
    → `div.thinking-animation[lottie-animation]` (svg shimmer) + `div.thinking-message.is-changing`
    ("Parsing the data…"). Direct child of `.message-text-content` ⇒ **filtered structurally** ✅
    (all three names in `Selectors.chat.reasoningNode` verified present:
    `observedThinkSelectorsPresent: [".thinking-message", "thinking-animation"]`).
  - Summary (the gerund + first-person prose): renders as **`div.md3-body-text[role="heading"][aria-level="3"]`**
    containing `<p><strong>Header</strong></p><p>prose</p>`, in its own assistant card
    (`.to-user-container[jslog="295957"]`). **No `thinking*` tag or class anywhere on it** ⇒ the
    structural layer *cannot* see it. The gate is therefore the only defence — it holds on the
    one thing that IS structural about the summary: it is not inside the answer viewer (Phase 7).
  - Not added to `reasoningNode`: `md3-body-text` is also the element ordinary short content uses,
    so excluding it structurally would risk blanking real answers (a far worse failure than the
    original bug). Documented + pinned by a test instead.
- The audit's answer cards use `labs-tailwind-doc-viewer → element-list-renderer →
  labs-tailwind-structural-element-view-v2 → paragraph-element-view → div.paragraph.normal`.
- Reasoning node is a **direct-child sibling** of the answer node inside `.message-text-content`
  → read-time filtering (no mutation) is viable — `chat.ts:355`, snapshots.
- Reasoning labels + summary prose stream in **English regardless of locale** → structural/icon
  reads are the only locale-safe primary — findings OQ3.
- `expand_more`/`expand_less` is a **language-agnostic Material symbol** already tracked in
  `uiControlLabels` (`selectors.ts:382`) → it anchors the collapsed-header strip for forms 2/3
  with no localized word list.
- `jsdom` does **not** implement `innerText` (no layout) → it cannot faithfully test the exact
  paragraph-break behaviour we rely on. Unit tests therefore exercise **pure** filter/join/text
  helpers over redacted fixture data; the live `innerText` path is covered by the §6 harness.

## Desired End State

`ask_question` returns the settled answer for **all three forms**, in **any locale**, with:
- no reasoning trace and no leading `"Thoughts\n"`-style prefix;
- no hang on a rate-limited/disabled textarea (bounded soft gate); existing rate-limit detection
  still fires;
- citations extracted unchanged;
- **every existing function preserved** (no removed behaviour — this PR is additive/hardening);
- `npm run check` and `npm test` green, with a new fixture-backed test matrix covering
  form 1/2/3 × EN/JA/PL and the gate decision;
- the §6 live regression harness returning `shadow returned THINKING = 0` and `finalWasThinking = 0`.

## What We're NOT Doing

- **No timing changes** — `timeout_ms`, `stablePolls`, `pollIntervalMs` are not the fix (OQ6).
- **No DOM mutation** — no hide/restore; read-time filtering only (OQ4), so citations are safe.
- **No enumerated localized header word lists shipped as defaults** — the `REASONING_HEADERS`
  hook ships **empty**; localization is solved structurally/by icon, not by guesswork.
- **No changes to the dual-host auth files** (`auth-manager.ts`, `notebook-domain.ts`) — OQ7.
- **No dependency on `research/issue-74/` tooling** — the fix lives entirely in `src/`; the audit
  dir is deleted before merge. **No new npm dependencies** (no jsdom).
- **No change to the MCP tool contract** — `handleAskQuestion` return shape (`handlers.ts:58`) and
  `index.ts:246` wiring are untouched.

## Implementation Approach

Five layers, primary→fallback. Layers 1–3 are locale-independent by construction; layer 4 is the
retained text fallback; layer 5 is the generic extensibility hook.

| Layer | Mechanism | Locale-safe? | Status |
|---|---|---|---|
| 1 PRIMARY | Structural read — exclude any reasoning node (`/thinking[-_]/i` + named list) from the answer read | ✅ tag-based | new |
| 2 GATE | Soft acceptance gate on `textarea.query-box-input[disabled]` **and** on whether the text came out of the answer viewer, **both bounded** | ✅ attribute + tag | new |
| 3 COLLAPSED-HEADER | Strip/ignore the collapsed header via its adjacent `expand_more`/`expand_less` toggle | ✅ icon-based | new |
| 4 FALLBACK | `PLACEHOLDER_SNIPPETS` + `isPlaceholder()` + `sanitizeAnswer()` | wording-based | **retained, unchanged behaviour** |
| 5 HOOK | Empty-by-default `REASONING_HEADERS` (const + `NOTEBOOKLM_REASONING_HEADERS`) exact-match | configurable | new, inert by default |

TDD throughout: each phase adds **pure, exported helpers** with tests written first, then wires
them into the browser path. The browser `page.evaluate` glue mirrors the pure predicate inline
(it cannot import) with a comment linking the two as the shared contract.

---

## Phase 1: Selectors, config plumbing & extensibility hooks (no behaviour change)

### Overview
Add the reasoning-node selector family, the toggle-icon set, and the `REASONING_HEADERS` hook.
Pure registry additions; nothing wired yet.

### Changes Required

#### 1. Reasoning-node selectors + rename-resistant pattern
**File**: `src/notebooklm/selectors.ts`
**Changes**: extend `Selectors.chat` and add exported constants.
```ts
chat: {
  answerContainer: ".to-user-container",
  answerText: ".to-user-container .message-text-content",
  latestAnswerText: ".to-user-container:last-child .message-text-content",

  /**
   * Gemini 2.5 renders its reasoning block as a dedicated component that is a
   * DIRECT-CHILD SIBLING of the answer node inside `.message-text-content`
   * (issue #74). Google renames it over time — `thinking-chain-view`/`.thinking-chain`
   * (lazydive's build) → `thinking-animation`/`.thinking-message` (2026-07 build) —
   * so we key on BOTH an explicit list AND a family pattern (`reasoningClassPattern`).
   * Keep this a *list*: auto-discovery showed the name is a moving target.
   */
  reasoningNode: [
    "thinking-animation",
    "thinking-animation-container",
    ".thinking-message",
    "thinking-chain-view",
    ".thinking-chain",
  ],
  /** Family pattern → catches future renames without a code change. Built into /…/i. */
  reasoningClassPattern: "thinking[-_]",
  /**
   * Language-agnostic Material-Symbols toggle on the collapsible reasoning
   * header. Used to identify + strip a leaked collapsed header (forms 2/3)
   * WITHOUT any localized header word. Subset of `uiControlLabels`.
   */
  reasoningToggleIcons: ["expand_more", "expand_less"] as const,
  queryInput: [ /* … unchanged … */ ],
  submitButton: [ /* … unchanged … */ ],
},
```
Add, near the bottom of the file (exported):
```ts
/**
 * Localization escape-hatch for a leaked *collapsed reasoning header* (forms 2/3)
 * on builds where the header is plain text with NO adjacent toggle icon and NO
 * following planning prose — the only case the icon-anchor + shape fallback miss.
 *
 * EMPTY BY DEFAULT: the icon-anchored strip (chat.ts) handles the common case
 * locale-independently. Extend at runtime via `NOTEBOOKLM_REASONING_HEADERS`
 * (comma-separated, case-insensitive) or by adding words here. Exact whole-line
 * match only — never a substring — so a real answer containing the word is safe.
 */
export const REASONING_HEADERS: readonly string[] = [];
```

### Success Criteria
#### Automated Verification:
- [x] Type checking + lint + build pass: `npm run check` — `lint` (0 errors) and `build` green.
      `format:check` fails on **6 files that already fail on HEAD** (`selectors.ts:341`,
      `sources.ts`, `tools/definitions/{ask-question,notebook-management,sources}.ts`,
      `tools/handlers.ts`) — pre-existing, unrelated, left untouched. Nothing this phase added is
      prettier-dirty.
- [x] Existing tests still pass: `npm test` (4/4)

#### Manual Verification:
- [ ] `Selectors.chat.reasoningNode` and `REASONING_HEADERS` are importable and correctly typed.

**Implementation Note**: pause for confirmation after `npm run check` is green before Phase 2.

---

## Phase 2: PRIMARY — structural answer read (TDD)

### Overview
Extract a **pure** structural-selection helper (tested first over redacted fixtures), then wire
it into `readLatestAnswer()` via a single `page.evaluate` that also reports the reasoning-present
and generating (textarea-disabled) flags. Read-time filter, **no DOM mutation**.

### Changes Required

#### 1. Pure extractor + reasoning predicate (test-first)
**File**: `src/notebooklm/chat.ts`
**Changes**: add exported pure helpers.
```ts
/** Node abstraction shared by the browser DOM and the unit fixtures. */
export interface AnswerNodeLike { tagName: string; className: string; innerText: string; }
export interface AnswerRootLike { children: AnswerNodeLike[]; innerText: string; }

const REASONING_CLASS_RE = new RegExp(Selectors.chat.reasoningClassPattern, "i");

/** True if a node is (part of) the reasoning component. Generic family + named list. */
export function isReasoningNode(node: { tagName: string; className: string }): boolean {
  const tag = (node.tagName || "").toLowerCase();
  const cls = node.className || "";
  if (REASONING_CLASS_RE.test(tag) || REASONING_CLASS_RE.test(cls)) return true;
  for (const sel of Selectors.chat.reasoningNode) {
    if (sel.startsWith(".")) { if (cls.split(/\s+/).includes(sel.slice(1))) return true; }
    else if (tag === sel) return true;
  }
  return false;
}

/**
 * PRIMARY structural read (issue #74). Returns the answer text with the reasoning
 * sibling excluded, plus whether a reasoning node is present. Pure — the browser
 * path in `readLatestAnswer` mirrors this predicate inline.
 */
export function extractStructuredAnswer(root: AnswerRootLike): {
  text: string | null;
  reasoningPresent: boolean;
} {
  const children = root.children ?? [];
  const reasoningPresent = children.some(isReasoningNode);
  const answerEls = children.filter((el) => !isReasoningNode(el));
  let text = answerEls.map((el) => el.innerText || "").join("\n").trim();
  // Fallback: some builds render answer text as direct text nodes of root.
  if (!text && !reasoningPresent) text = (root.innerText || "").trim();
  return { text: text.length ? text : null, reasoningPresent };
}
```

#### 2. Wire structural read into the browser path
**File**: `src/notebooklm/chat.ts` — replace the body of `readLatestAnswer()` (`chat.ts:355`).
`readLatestAnswer` now returns a richer result so the gate (Phase 3) can see `generating`.
```ts
interface LatestAnswer { text: string | null; reasoningPresent: boolean; generating: boolean; }

async function readLatestAnswer(page: Page): Promise<LatestAnswer> {
  try {
    const raw = await page.evaluate(
      ({ answerSel, reasoningList, reasoningPattern, queryInputSel }) => {
        const nodes = document.querySelectorAll(answerSel);
        const root = nodes.length ? (nodes[nodes.length - 1] as HTMLElement) : null;
        const ta = document.querySelector(queryInputSel) as HTMLTextAreaElement | null;
        const generating = !!ta && (ta.disabled || ta.hasAttribute("disabled"));
        if (!root) return { text: null, reasoningPresent: false, generating };
        const re = new RegExp(reasoningPattern, "i");
        // MIRRORS isReasoningNode() in this module — keep in sync.
        const isReasoning = (el: Element) => {
          const tag = el.tagName.toLowerCase();
          const cls = typeof el.className === "string" ? el.className : "";
          if (re.test(tag) || re.test(cls)) return true;
          for (const sel of reasoningList) {
            if (sel[0] === ".") { if (el.classList.contains(sel.slice(1))) return true; }
            else if (tag === sel) return true;
          }
          return false;
        };
        const kids = Array.from(root.children);
        const reasoningPresent = kids.some(isReasoning);
        let text = kids.filter((el) => !isReasoning(el))
          .map((el) => (el as HTMLElement).innerText || "").join("\n").trim();
        if (!text && !reasoningPresent) text = (root.innerText || "").trim();
        return { text: text || null, reasoningPresent, generating };
      },
      {
        answerSel: Selectors.chat.answerText,
        reasoningList: Selectors.chat.reasoningNode as unknown as string[],
        reasoningPattern: Selectors.chat.reasoningClassPattern,
        queryInputSel: "textarea.query-box-input",
      }
    );
    const cleaned = raw.text ? sanitizeAnswer(raw.text) : "";
    return {
      text: cleaned.length ? cleaned : null,
      reasoningPresent: raw.reasoningPresent,
      generating: raw.generating,
    };
  } catch {
    // Legacy fallback (never regress if the evaluate path fails): old innerText read.
    try {
      const legacy = await page.locator(Selectors.chat.latestAnswerText).last().innerText({ timeout: 2_000 });
      const cleaned = sanitizeAnswer(legacy);
      return { text: cleaned.length ? cleaned : null, reasoningPresent: false, generating: false };
    } catch {
      return { text: null, reasoningPresent: false, generating: false };
    }
  }
}
```
Update the one caller (`waitForStableAnswer`) to consume `.text` (Phase 3 uses the rest).

> **Implemented deviation (ponytail review):** the plan's "mirror the predicate inline inside
> `page.evaluate`" step was dropped. `page.evaluate` now only *reads* the DOM into plain node data
> (`{children:[{tagName,className,innerText}], innerText}` + `generating`) and the **already-pure
> `extractStructuredAnswer()` runs in Node on that data**. One implementation instead of two copies
> joined by a "keep in sync" comment, ~25 fewer lines, and the unit tests now cover the code that
> actually ships. Cost: the reasoning text crosses the bridge (a few KB per poll); still one
> `page.evaluate` per poll.

### Success Criteria
#### Automated Verification:
- [x] New pure tests pass (form 1 → reasoning-only ⇒ `text=null,reasoningPresent=true`; settled ⇒ answer text; phase-2 gerund answer ⇒ answer text with `reasoningPresent=false`): `npm test` (12/12)
- [x] `npm run check` passes — `lint` (0 errors) + `build` green, `chat.ts` prettier-clean; only the
      6 pre-existing `format:check` offenders remain (see Phase 1).

#### Manual Verification:
- [ ] Against a live notebook, `ask_question` returns the answer and never the shimmer/`.thinking-message` text (form 1) — spot-check via §6 harness or a real call.

**Implementation Note**: pause for confirmation before Phase 3.

---

## Phase 3: GATE — soft, bounded generation-complete gate (TDD)

### Overview
Prefer accepting only when the textarea is enabled; but bound it so a rate-limited **disabled**
state can't spin to timeout (OQ2). Keeps the existing early rate-limit/error return intact.

### Changes Required

#### 1. Pure gate decision (test-first)
**File**: `src/notebooklm/chat.ts`
```ts
/**
 * Soft generation gate (issue #74, OQ2). Accept a stable answer when the textarea
 * is enabled; if still disabled (possible silent rate-limit), accept after
 * `gateExtraPolls` MORE stable polls so we can never hang to the timeout.
 */
export function answerIsSettled(o: {
  stableStreak: number; stablePolls: number; generating: boolean; gateExtraPolls: number;
}): boolean {
  if (o.stableStreak < o.stablePolls) return false;
  if (!o.generating) return true;
  return o.stableStreak >= o.stablePolls + o.gateExtraPolls;
}
```

#### 2. Wire the gate + reasoning-only placeholder into the poll loop
**File**: `src/notebooklm/chat.ts` — `waitForStableAnswer()` (`chat.ts:272`).
- Add `gateExtraPolls` to `AskOptions` (default `8` ≈ 6 s at 750 ms; env
  `NOTEBOOKLM_GATE_EXTRA_POLLS` optional, read where `CONFIG` is assembled or defaulted locally).
- Read the richer `readLatestAnswer` result each tick; keep the latest `generating` flag.
- **Reasoning-only state** (`reasoningPresent && !text`) → treat exactly like a placeholder
  (reset streak, `safeSleep`, continue) — the pure-generation window.
- Keep `isPlaceholder`, `isErrorMessage`, `isRateLimitText`, echo/prior checks **unchanged**.
- Replace the accept test `if (stableStreak >= stablePolls) return candidate;` with
  `if (answerIsSettled({ stableStreak, stablePolls, generating, gateExtraPolls })) return candidate;`.
```ts
const { /* … */ stablePolls = 3, gateExtraPolls = 8 } = options;
// …
const latest = await readLatestAnswer(page);
const candidate = latest.text;
const generating = latest.generating;
if (latest.reasoningPresent && !candidate) {            // pure reasoning phase → wait
  stableStreak = 0; lastSeen = null;
  await safeSleep(page, Math.min(pollIntervalMs, 400)); continue;
}
// … existing placeholder / error / rate-limit / echo / prior handling unchanged …
if (candidate === lastSeen) {
  stableStreak++;
  if (answerIsSettled({ stableStreak, stablePolls, generating, gateExtraPolls })) return candidate;
} else { lastSeen = candidate; stableStreak = 1; }
```

> **Implemented deviation (ponytail review):** `answerIsSettled()` is a single expression —
> `stableStreak >= stablePolls + (generating ? max(0, gateExtraPolls) : 0)` — instead of the
> plan's three-branch ladder. Behaviourally identical, negative-safe, still an exported pure
> function so the gate keeps its own unit tests.

### Success Criteria
#### Automated Verification:
- [x] Gate tests pass: enabled ⇒ accept at `stablePolls`; disabled ⇒ not accepted at `stablePolls`, accepted at `stablePolls + gateExtraPolls`; below `stablePolls` ⇒ never: `npm test` (16/16)
- [x] `npm run check` passes — `lint`/`build` green, `chat.ts` prettier-clean (same pre-existing
      `format:check` offenders as Phase 1).

#### Manual Verification:
- [ ] A normal call still returns promptly (textarea enables at settle — no added latency).
- [ ] A rate-limited run does **not** hang; `detectRateLimitError()` still fires afterward
      (`browser-session.ts:439`).

**Implementation Note**: pause for confirmation before Phase 4.

---

## Phase 4: COLLAPSED-HEADER handling — icon-anchored, locale-independent (TDD)

### Overview
Handle forms 2 & 3 on builds where the header leaks as **text** (not a component), using the
`expand_more`/`expand_less` toggle as the language-agnostic anchor. Retain every existing
`sanitizeAnswer`/`isPlaceholder` rule; only add.

### Changes Required

#### 1. Icon-anchored header strip in `sanitizeAnswer()`
**File**: `src/notebooklm/chat.ts` — `sanitizeAnswer()` (`chat.ts:374`).
Before/while filtering: if a line is immediately followed by a `reasoningToggleIcons` line, that
line is a collapsed reasoning header → drop it too (the toggle line is already dropped by the
existing `uiControlLabels` rule). Handles form 2 (header+toggle ⇒ empties out ⇒ poller waits) and
form 3 (header+toggle+answer ⇒ header removed, answer kept). No localized words.
```ts
const toggles = new Set<string>(Selectors.chat.reasoningToggleIcons);
// inside the loop, before `kept.push(line)`:
if (toggles.has(lines[i + 1] ?? "")) continue;   // this line is the collapsed reasoning header
```

#### 2. Exact-match header hook in `isPlaceholder()`
**File**: `src/notebooklm/chat.ts` — `isPlaceholder()` (`chat.ts:216`), add at top of function
body (before existing checks, which remain):
```ts
const bare = text.trim().toLowerCase();
if (bare && REASONING_HEADERS_SET.has(bare)) return true;   // whole-line exact match only
```
Where, at module load:
```ts
const REASONING_HEADERS_SET = new Set(
  [...REASONING_HEADERS, ...(process.env.NOTEBOOKLM_REASONING_HEADERS ?? "").split(",")]
    .map((s) => s.trim().toLowerCase()).filter(Boolean)
);
```
`REASONING_HEADERS` is empty by default ⇒ this is inert unless configured.

> **Implemented deviation (hardening):** the icon-anchored rule fires only in the **leading header
> region** — `REASONING_TOGGLES.has(next) && (kept.length === 0 || REASONING_TOGGLES.has(prev))`.
> The plan's unguarded `if (toggles.has(lines[i+1])) continue;` would also delete a *real answer's
> last line* if NotebookLM ever rendered a toggle right after it, which would be a regression of
> existing behaviour the plan forbids. The guard still covers form 2, form 3, and consecutive
> multi-step headers (a header directly after another toggle), all locale-independently.
>
> The env-hook test lives in its own file (`test/reasoning-headers.test.ts`) because
> `REASONING_HEADERS_SET` is built at module load: the env var must be set before the module is
> evaluated, so that file sets it and then `await import`s. `node --test` isolates each file in its
> own process, so it cannot leak into the other tests.

### Success Criteria
#### Automated Verification:
- [x] `sanitizeAnswer` drops a header line anchored by `expand_more`/`expand_less` (form 2 ⇒ "",
      form 3 ⇒ answer only) and still passes all existing sanitize behaviour: `npm test`
- [x] With `NOTEBOOKLM_REASONING_HEADERS="thoughts"`, `isPlaceholder("Thoughts")` is true and a
      real answer containing "thoughts" mid-sentence is **not** flagged: `npm test` (25/25)
- [x] `npm run check` passes — `lint`/`build` green, `chat.ts` prettier-clean (same pre-existing
      `format:check` offenders as Phase 1).

#### Manual Verification:
- [ ] No leading `"Thoughts\n"` prefix on any real answer (spot-check via §6).

**Implementation Note**: pause for confirmation before Phase 5.

---

## Phase 5: Fixtures & full test matrix (retain existing)

### Overview
Add redacted reference fixtures and a comprehensive matrix (form 1/2/3 × EN/JA/PL) consuming the
pure helpers. (The four PR-#75 tests this phase planned to keep left with the #75 dependency in
  Phase 7; `test/chat.test.ts` does not exist on `main`.)

### Changes Required

#### 1. Redacted fixtures (provenance) + fixture node-arrays
**Files**: `test/fixtures/issue-74/*.html` (small, **redacted** — real answer text replaced with
`[REDACTED ANSWER]`, real citation labels removed) sourced from `dom-audit-runs/*/snapshots/`;
and `test/fixtures/issue-74/nodes.ts` exporting the corresponding `AnswerRootLike` fixtures
(reasoning-only / settled / phase-2, for EN/JA/PL). Rationale: `jsdom` lacks `innerText`, so the
`.html` files are documentation of shape; tests consume the TS node-arrays.

#### 2. New test file
**File**: `test/answer-extraction.test.ts` (matches `test/*.test.ts`).
Cover:
- `extractStructuredAnswer`: reasoning-only ⇒ `{text:null,reasoningPresent:true}`; settled ⇒
  answer text, reasoning excluded; phase-2 gerund-in-answer ⇒ answer text returned (defence is the
  gate, asserted separately).
- `isReasoningNode`: matches `thinking-animation`, `.thinking-message`, a hypothetical
  `thinking-foobar` (family pattern), and the older `thinking-chain-view`; rejects `paragraph`,
  `labs-tailwind-doc-viewer`.
- `answerIsSettled`: the three gate cases.
- `sanitizeAnswer`: icon-anchored header strip for form 2/3 (EN/JA/PL header words behind a
  toggle line — locale-independent since it keys on the icon, not the word).
- `isPlaceholder` with `NOTEBOOKLM_REASONING_HEADERS` set (form-2 exact match) + negative
  (mid-sentence "thoughts" not flagged).

> **Implemented deviations:**
> 1. **No `.html` fixture files.** The plan itself notes no test can consume them (`jsdom` has no
>    `innerText`), so they would be committed-but-unread files carrying redaction risk. The DOM
>    skeleton they were meant to document now lives as a comment block at the top of
>    `test/fixtures/issue-74/nodes.ts`, re-derived from the snapshots. Nothing reads the audit dir.
> 2. **Fixture text is synthetic, not redacted-real.** Same shapes, invented sentences — provably
>    free of private content (`grep -riE "lonely planet|dove lake|…" test/` → no matches) instead of
>    relying on a careful redaction pass.
> 3. **Extra coverage the plan didn't specify:** `reasoningSummaryRoot` pins the layer contract for
>    the `div.md3-body-text` summary — structural read *keeps* it (nothing marks it as reasoning),
>    the gate holds it because it is not viewer text — so a future "make it all structural"
>    refactor fails loudly instead of regressing.

### Success Criteria
#### Automated Verification:
- [x] Full suite green: `npm test` (29/29 after Phase 7 — 26 in `answer-extraction.test.ts`,
      3 in `reasoning-headers.test.ts`)
- [x] `npm run check` passes — `lint`/`build` green; `chat.ts` prettier-clean (pre-existing
      `format:check` offenders only, see Phase 1).
- [x] No raw (unredacted) snapshot committed: `grep -riE "lonely planet|dove lake|great ocean
      road|red centre|bondi|tasmania|australia|china|vietnam" test/` → **no matches**; fixture text
      is synthetic by construction.

#### Manual Verification:
- [ ] Fixtures reviewed to confirm redaction (no real answer/source text).

**Implementation Note**: pause for confirmation before Phase 6.

---

## Phase 6: Live regression verification (manual)

### Overview
Run the §6 harness against real notebooks to confirm the fix end-to-end. Live-only; not automated
(burns free-tier quota, needs the MCP server stopped).

### Steps
1. Stop the MCP server.
2. `npx tsx research/issue-74/dom-audit.ts --plan research/issue-74/plan.json --headless`
   (defaults to `--token-scope turn`). ~12 calls; free tier 50/day.
3. Read `dom-audit-runs/<ts>/REPORT.md`.

### Success Criteria
#### Manual Verification:
- [ ] `shadow returned THINKING = 0` and `finalWasThinking = 0`.
- [ ] Citations still populated on a `source_format="footnotes"` call.
- [ ] A JA and a PL question both return the localized answer, no reasoning text, no prefix.

---

## Phase 7: Drop the PR-#75 dependency; hold the summary structurally

### Overview
Added after `/validate_plan` (2026-07-27) replayed the shipped pipeline over **all 108 captured
snapshots offline** (real Chromium + `page.setContent`, so `innerText` is genuine; harness kept out
of the repo). Results: structural read 0 leaks, 33/33 settled answers returned, and the 9 snapshots
that caught the real `div.md3-body-text` summary state were held by the gate + `isThinkingStep` —
the layering works exactly as designed.

**But the replay also found a defect in the retained layer 4** (pre-existing, from PR #75
`ec84338`, shipping here as the fallback): `THINKING_OPENER` matched a **real settled answer** that
opens `"I am thrilled to …"` — 3401 chars, 77 lines, inside the answer viewer, textarea enabled.
`isPlaceholder()` vetoed it, so the poller never accepted it and `ask_question` threw
`"Timeout waiting for response from NotebookLM"` after the full 10 minutes with the reply on
screen. Rate: **1 in 33 real answers (3%)**; 3 more contain first-person phrasing, so Shape 1 was
one gerund heading away from firing too. A false *negative* is a cosmetic bug; this false
*positive* is a hard failure, so it had to be fixed before merge.

**Then a second problem surfaced: PR #75 is not merged and may never be.** It sat at the base of
the working branch, which meant our PR would have shipped another contributor's unmerged commit
inside our diff, and both halves of the fix above patched code that does not exist on `main`. So
the dependency was dropped and layer 4's shape-matching was replaced by the structural signal it
was propping up.

### Changes Required

#### 1. Positive structural signal — `answerViewerNode`
**Files**: `src/notebooklm/selectors.ts`, `src/notebooklm/chat.ts`.
Measured discriminators: real summaries render in `div.md3-body-text` (194–425 chars, n=9); real
answers render in `labs-tailwind-doc-viewer` (158–6661 chars, **33/33**). So structure decides:
`extractStructuredAnswer()` also returns `fromAnswerViewer`, true only when *every* child that
contributed text is an answer viewer — an empty viewer mounted beside a summary vouches for
nothing, which is precisely how the summary reaches us.

#### 2. The gate holds on that signal instead of on wording
**File**: `src/notebooklm/chat.ts` — `answerIsSettled()` takes `fromAnswerViewer` and
`summaryHoldPolls`. While the turn is still running, text from the viewer needs `gateExtraPolls`
(8 ≈ 6 s, it is the reply still streaming); text from anywhere else needs `summaryHoldPolls`
(16 ≈ 14 s, it is probably the summary). Both bounded, so neither a stuck-disabled textarea nor a
renamed viewer component can hang the poll. The hold is generous because releasing early returns
the wrong text while holding only costs latency; the longest reasoning window in the issue reports
is ~6 s.

**Removed with the #75 dependency:** `isThinkingStep()`, `THINKING_TITLE`,
`THINKING_FIRST_PERSON`, `THINKING_OPENER`, the `isPlaceholder` shape branch, and
`THINKING_MAX_CHARS` — 47 lines of `chat.ts` plus 58 test lines. Nothing in the fix now looks at
the *wording* of the reasoning text, so the false-positive class is gone by construction rather
than patched. `package.json`'s `test` script is wired to the node test runner by this branch
(on `main` it still runs the server).

### Success Criteria
#### Automated Verification:
- [x] `npm test` — 29/29 on a branch cut straight from `main`, no third-party commits
- [x] `npm run check` — **fully green** (`format:check` included; the 6 pre-existing offenders were
      cleaned in the same pass, see below)
- [x] Offline replay of the shipped code over all 108 real snapshots: **settled answers accepted
      33/33**, **reasoning summaries held 9/9**, zero problems — identical coverage to the
      #75-dependent version it replaces, with 105 fewer lines and no wording rules.

#### Manual Verification:
- [ ] A live answer that opens with first-person phrasing returns instead of timing out.
- [ ] A live turn whose reasoning window exceeds ~14 s still returns the answer, not the summary
      (the one case the bound trades away; unobserved in 108 captures).

### Also folded in (validation report recommendations 2 & 3)
- `NOTEBOOKLM_GATE_EXTRA_POLLS` and `NOTEBOOKLM_REASONING_HEADERS` documented in
  `docs/configuration.md` (new "Answer extraction" section) and the `README.md` highlights table —
  they existed in code but appeared in no table, unlike every other env var.
- `npm run format` applied to `src`, clearing the 6 pre-existing prettier offenders
  (`selectors.ts:347`, `sources.ts`, `tools/definitions/{ask-question,notebook-management,sources}.ts`,
  `tools/handlers.ts`). `npm run check` is green for the first time on this branch.

---

## Issue-#74 aspect coverage (all 17 — findings §7)

| Aspect | Covered by |
|---|---|
| 1 Core bug (returns thinking trace) | Phase 2 structural read |
| 2 `isPlaceholder`/snippets miss new shape | Phases 2–4 (structural + gate + icon), fallback retained |
| 3 Text heuristic + multilingual | Phase 4 icon-anchor + Phase 7 viewer signal — no wording rules at all |
| 4 Key off DOM class + selector audit | Phase 1 `reasoningNode` + `reasoningClassPattern` |
| 5 Require prior placeholder | Subsumed by Phase 3 gate + retained `isPlaceholder` |
| 6 Form 2 bare "Thoughts" (PL) | Phase 4 strip + hook |
| 7 snippets lack "thoughts" | Phase 4 `REASONING_HEADERS` hook (exact match) |
| 8 Timeout doesn't help | Respected — no timing change |
| 9 Anchored header regex | Phase 4 icon-anchored (stronger than word regex) |
| 10 Soft gate on textarea[disabled] | Phase 3 |
| 11 Strip leaked header in sanitize | Phase 4 |
| 12 Header is locale-bound | Phases 1–4 avoid header words entirely |
| 13 "Thoughts"/expand_more collapse | Phase 4 uses the toggle as the anchor |
| 14 Dedicated reasoning component | Phase 2 exclusion |
| 15 Structural skip; innerText not textContent | Phase 2 (children `innerText`, no clone/mutation) |
| 16 Collapsed form vs #75; structural covers both | Phases 2+4; #75 retained as fallback |
| 17 Header leaks into settled answers | Phase 4 strip |

## Testing Strategy

### Unit Tests (pure, no browser, no new deps)
- `extractStructuredAnswer`, `isReasoningNode`, `answerIsSettled`, `sanitizeAnswer` (icon strip),
  `isPlaceholder` (hook) — form 1/2/3 × EN/JA/PL.
- Retained `main` behaviour (`isPlaceholder` snippets, `sanitizeAnswer`) stays green — proves the
  existing fallback is untouched.

### Integration / Manual
- §6 live harness (Phase 6): shadow `THINKING=0`, `finalWasThinking=0`, citations intact, JA/PL.

## Performance Considerations

- Structural read is one `page.evaluate` per poll (replaces one `locator.innerText`) — same order
  of cost; also folds in the textarea-disabled read (saves a call vs. a separate gate probe).
- Soft gate adds **zero** latency on the common path (textarea enabled at settle); worst case adds
  `gateExtraPolls × pollIntervalMs` ≈ 6 s only in a silent-disabled edge, strictly bounded.

## Migration Notes

- Additive only; no schema/state/DB. `readLatestAnswer`'s return type changes (internal, one
  caller). No MCP contract change. New env vars (`NOTEBOOKLM_REASONING_HEADERS`,
  `NOTEBOOKLM_GATE_EXTRA_POLLS`) are optional with safe defaults.

## References
- Handoff: `research/issue-74/PHASE-2-HANDOFF.md`
- Findings: `research/issue-74/2026-07-26-issue-74-answer-gathering-research.md`
- Harness how-to: `research/issue-74/RUN-AUDIT.md`
- Code: `src/notebooklm/chat.ts` (`readLatestAnswer:355`, `waitForStableAnswer:272`,
  `sanitizeAnswer:374`, `isPlaceholder:216`),
  `src/notebooklm/selectors.ts` (`answerText:33`, `uiControlLabels:382`),
  `src/notebooklm/citations.ts` (`extractCitations:40`),
  `src/session/browser-session.ts` (`ask:363`, `extractCitations:531`, `detectRateLimitError:649`),
  `src/tools/handlers.ts` (`handleAskQuestion:58`)
- Redacted fixtures sourced from `dom-audit-runs/*/snapshots/*.html` (git-ignored; redact before copy)
