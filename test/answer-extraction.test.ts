/**
 * Issue #74 — answer extraction: form 1/2/3 × EN/JA/PL.
 *
 * Gemini 2.5 surfaces its reasoning in three shapes, and the fix answers each
 * with a different layer (see the plan's layer table):
 *
 *   form 1  reasoning COMPONENT (`thinking-animation`) shares the answer
 *           selector as a direct-child sibling  → excluded structurally
 *   form 2  collapsed header leaked as text ("Thoughts\nexpand_more")
 *           → stripped via the language-agnostic Material toggle icon
 *   form 3  same header, followed by the real answer
 *           → header stripped, answer kept
 *   plus    the extended-thinking SUMMARY, which renders as ordinary content
 *           (`div.md3-body-text`) with no marker of its own → held by the
 *           acceptance gate, because it is the one thing that never comes out
 *           of the answer viewer
 *
 * `jsdom` does not implement `innerText` (no layout), so these tests run the
 * pure helpers over the node fixtures in `fixtures/issue-74/nodes.ts` — the same
 * functions `readLatestAnswer()` calls on the real DOM. The live `innerText`
 * path is covered by the plan's §6 harness.
 *
 * Run: `npm test`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isReasoningNode,
  extractStructuredAnswer,
  answerIsSettled,
  sanitizeAnswer,
  isPlaceholder,
} from "../src/notebooklm/chat.js";
import type { AnswerNodeLike } from "../src/notebooklm/chat.js";
import {
  ANSWERS,
  THINKING_LABEL,
  REASONING_SUMMARY,
  COLLAPSED_HEADERS,
  CONVERSATIONAL_ANSWER,
  SHORT_CONVERSATIONAL_ANSWER,
  generatingRoot,
  settledRoot,
  mixedRoot,
  reasoningSummaryRoot,
  conversationalAnswerRoot,
  emptyViewerWithSummaryRoot,
} from "./fixtures/issue-74/nodes.js";
import type { Locale } from "./fixtures/issue-74/nodes.js";

const LOCALES: Locale[] = ["en", "ja", "pl"];

const el = (tagName: string, className: string, innerText = ""): AnswerNodeLike => ({
  tagName,
  className,
  innerText,
});

// ---------------------------------------------------------------------------
// Form 1 — the reasoning component, excluded structurally.
// ---------------------------------------------------------------------------

test("form 1: no answer is returned while only the reasoning component is mounted (#74)", () => {
  const result = extractStructuredAnswer(generatingRoot);
  assert.equal(result.text, null, "the reasoning trace must never surface as the answer");
  assert.equal(result.reasoningPresent, true);
});

test("form 1: the reasoning sibling is excluded from a streaming answer, in any locale (#74)", () => {
  for (const locale of LOCALES) {
    const result = extractStructuredAnswer(mixedRoot(locale));
    assert.equal(result.text, ANSWERS[locale], `answer only (${locale})`);
    assert.equal(result.reasoningPresent, true);
    assert.ok(!result.text?.includes(THINKING_LABEL), `no reasoning label (${locale})`);
  }
});

test("the settled answer is returned unchanged, in any locale (#74)", () => {
  for (const locale of LOCALES) {
    const result = extractStructuredAnswer(settledRoot(locale));
    assert.equal(result.text, ANSWERS[locale], `settled answer (${locale})`);
    assert.equal(result.reasoningPresent, false);
  }
});

test("extractStructuredAnswer joins multiple answer children", () => {
  const root = {
    children: [el("DIV", "paragraph", "First paragraph."), el("DIV", "paragraph", "Second.")],
    innerText: "First paragraph.\nSecond.",
  };
  assert.equal(extractStructuredAnswer(root).text, "First paragraph.\nSecond.");
});

test("extractStructuredAnswer falls back to root innerText for text-node-only builds", () => {
  const result = extractStructuredAnswer({ children: [], innerText: ANSWERS.en });
  assert.equal(result.text, ANSWERS.en, "builds without an answer element must still return text");
  assert.equal(result.reasoningPresent, false);
});

test("extractStructuredAnswer never falls back to root innerText while reasoning is present", () => {
  const root = {
    children: [el("THINKING-ANIMATION", "ng-star-inserted")],
    innerText: THINKING_LABEL,
  };
  assert.equal(extractStructuredAnswer(root).text, null);
});

test("isReasoningNode matches every known and future reasoning component (#74)", () => {
  const reasoning: AnswerNodeLike[] = [
    // 2026-07 build, verified in the audit snapshots.
    el("THINKING-ANIMATION", "ng-star-inserted"),
    el("DIV", "thinking-animation-container"),
    el("DIV", "thinking-message is-changing ng-star-inserted"),
    // Older build.
    el("THINKING-CHAIN-VIEW", ""),
    el("DIV", "thinking-chain"),
    // Hypothetical future renames — caught by the family pattern alone.
    el("THINKING-FOOBAR", ""),
    el("DIV", "thinking_summary"),
    el("SOME-WRAPPER", "gemini-thinking-panel"),
  ];
  for (const n of reasoning) {
    assert.ok(isReasoningNode(n), `should be reasoning: <${n.tagName} class="${n.className}">`);
  }
});

test("isReasoningNode rejects answer nodes", () => {
  const answers: AnswerNodeLike[] = [
    el("LABS-TAILWIND-DOC-VIEWER", "ng-star-inserted"),
    el("DIV", "paragraph normal ng-star-inserted"),
    el("MAT-CARD-CONTENT", "mat-mdc-card-content"),
    el("SPAN", ""),
    el("BUTTON", "citation-marker"),
    // Prose that merely mentions thinking is not a reasoning component.
    el("DIV", "paragraph", "The document explains rethinking of the approach."),
  ];
  for (const n of answers) {
    assert.ok(!isReasoningNode(n), `should NOT be reasoning: <${n.tagName} class="${n.className}">`);
  }
});

// ---------------------------------------------------------------------------
// The extended-thinking SUMMARY. It renders as `div.md3-body-text`, i.e. as
// ordinary content: no class, tag or wording marks it as reasoning, and it is
// NOT inside the answer viewer. That last fact is the only thing separating it
// from a reply, and it is what the gate keys on. These tests pin the division
// of labour so a future "just filter it structurally" refactor fails loud.
// ---------------------------------------------------------------------------

test("the reasoning summary reads as ordinary content — no filter can see it (#74)", () => {
  const result = extractStructuredAnswer(reasoningSummaryRoot);
  assert.equal(result.text, REASONING_SUMMARY, "no class/tag marks it as reasoning");
  assert.equal(result.reasoningPresent, false);
  assert.ok(!isPlaceholder(REASONING_SUMMARY), "and no wording marks it either");
  // What *does* mark it: it did not come out of the answer viewer.
  assert.equal(result.fromAnswerViewer, false);
});

test("the summary is held by the gate for the whole reasoning window (#74)", () => {
  const held = (streak: number) =>
    !answerIsSettled({
      stableStreak: streak,
      stablePolls: 3,
      generating: true,
      fromAnswerViewer: false,
      gateExtraPolls: 8,
      summaryHoldPolls: 16,
    });
  // Longest reasoning window in the issue reports was ~6 s ≈ 8 polls.
  assert.ok(held(3), "not accepted at the ordinary stability streak");
  assert.ok(held(12), "still held well past the observed reasoning window");
  assert.ok(!held(19), "…but bounded — a renamed viewer must not hang the poll");
});

test("the reasoning label read from a partially rendered turn is a placeholder (#74)", () => {
  assert.ok(isPlaceholder(THINKING_LABEL));
});

// ---------------------------------------------------------------------------
// Soft generation gate (#74). `generating` = the chat textarea is still
// disabled, which NotebookLM does for the duration of a turn. The gate prefers
// an enabled textarea but is BOUNDED, so a silently rate-limited turn (textarea
// stays disabled, no error text) can never spin to the timeout.
// ---------------------------------------------------------------------------

const gate = (stableStreak: number, generating: boolean, gateExtraPolls = 8) =>
  answerIsSettled({
    stableStreak,
    stablePolls: 3,
    generating,
    // The answer viewer is mounted — this is the reply, still streaming.
    fromAnswerViewer: true,
    gateExtraPolls,
    summaryHoldPolls: 16,
  });

test("answerIsSettled accepts a stable answer once the textarea is enabled (#74)", () => {
  assert.ok(gate(3, false), "enabled textarea settles at stablePolls");
  assert.ok(gate(9, false));
});

test("answerIsSettled holds back while the textarea is still disabled (#74)", () => {
  assert.ok(!gate(3, true), "disabled textarea must not settle at stablePolls");
  assert.ok(!gate(10, true), "still inside the extra-poll grace window");
});

test("answerIsSettled is bounded — a stuck disabled textarea cannot hang the poll (#74)", () => {
  assert.ok(gate(11, true), "accepted after stablePolls + gateExtraPolls");
  assert.ok(gate(3, true, 0), "gateExtraPolls=0 disables the gate entirely");
});

test("answerIsSettled never accepts before the stability streak is met", () => {
  for (const generating of [false, true]) {
    for (const streak of [0, 1, 2]) {
      assert.ok(!gate(streak, generating), `streak ${streak} < stablePolls must not settle`);
    }
  }
});

// ---------------------------------------------------------------------------
// Forms 2 & 3 — collapsed header leaked as text. The strip keys on the
// `expand_more`/`expand_less` Material icon, never on the header word, so it is
// locale-independent by construction.
// ---------------------------------------------------------------------------

test("form 2: a collapsed header plus its toggle sanitises to nothing (#74)", () => {
  for (const header of COLLAPSED_HEADERS) {
    assert.equal(sanitizeAnswer(`${header}\nexpand_more`), "", `form 2 leak: ${header}`);
    assert.equal(sanitizeAnswer(`${header}\nexpand_less`), "", `form 2 leak: ${header}`);
  }
});

test("form 3: the header prefix is dropped and the answer kept, in any locale (#74)", () => {
  for (const header of COLLAPSED_HEADERS) {
    for (const locale of LOCALES) {
      assert.equal(
        sanitizeAnswer(`${header}\nexpand_more\n${ANSWERS[locale]}`),
        ANSWERS[locale],
        `form 3: ${header} / ${locale}`
      );
    }
  }
});

test("form 3: consecutive collapsed headers are all dropped (#74)", () => {
  const raw = `Thoughts\nexpand_more\nRefining the scope\nexpand_more\n${ANSWERS.en}`;
  assert.equal(sanitizeAnswer(raw), ANSWERS.en);
});

test("sanitizeAnswer never truncates an answer line followed by a stray toggle (#74)", () => {
  const raw = "First paragraph of the answer.\nSecond paragraph of the answer.\nexpand_more";
  assert.equal(
    sanitizeAnswer(raw),
    "First paragraph of the answer.\nSecond paragraph of the answer.",
    "only a LEADING header region may be stripped — answer prose must survive"
  );
});

test("sanitizeAnswer retains its pre-#74 behaviour", () => {
  // Isolated Material-icon labels are dropped, inline mentions are not.
  assert.equal(sanitizeAnswer(`${ANSWERS.en}\nmore_vert`), ANSWERS.en);
  assert.equal(sanitizeAnswer(`${ANSWERS.en}\n1\nmore_vert`), ANSWERS.en);
  assert.equal(
    sanitizeAnswer("Click expand_more to reveal the rest."),
    "Click expand_more to reveal the rest.",
    "inline icon words are answer prose"
  );
  assert.equal(sanitizeAnswer("  padded answer  "), "padded answer");
  assert.equal(sanitizeAnswer(`${ANSWERS.en}\n\n\n`), ANSWERS.en);
});

test("isPlaceholder does not flag a bare header unless configured (#74)", () => {
  // REASONING_HEADERS ships EMPTY: no localized word list by default. The
  // configured path is covered in test/reasoning-headers.test.ts.
  for (const header of COLLAPSED_HEADERS) {
    assert.ok(!isPlaceholder(header), `inert by default: ${header}`);
  }
});

// ---------------------------------------------------------------------------
// The answer-viewer signal, which is what tells a reply apart from a reasoning
// summary once neither tag, class nor wording can. It also has to hold for a
// real answer that *reads* like a thought: 1 of 33 settled answers in the audit
// captures opens "I am thrilled to …", and any shape-matching rule discards it
// — which fails the call with a timeout while the reply sits on screen. This
// implementation does no shape matching at all, and these tests pin that.
// ---------------------------------------------------------------------------

test("the answer viewer is a positive signal that the text is the answer (#74)", () => {
  for (const locale of LOCALES) {
    assert.equal(extractStructuredAnswer(settledRoot(locale)).fromAnswerViewer, true);
    // The reasoning sibling is excluded, so what remains is still viewer text.
    assert.equal(extractStructuredAnswer(mixedRoot(locale)).fromAnswerViewer, true);
  }
  assert.equal(
    extractStructuredAnswer(reasoningSummaryRoot).fromAnswerViewer,
    false,
    "the summary card is not the answer viewer"
  );
  assert.equal(
    extractStructuredAnswer(generatingRoot).fromAnswerViewer,
    false,
    "no text at all ⇒ no signal"
  );
});

test("an EMPTY answer viewer never vouches for a reasoning summary beside it (#74)", () => {
  const result = extractStructuredAnswer(emptyViewerWithSummaryRoot);
  assert.equal(result.text, REASONING_SUMMARY, "the summary is the only text present");
  assert.equal(
    result.fromAnswerViewer,
    false,
    "the signal must require that the VIEWER produced the text"
  );
  // …so the gate still holds it while the turn runs.
  assert.ok(
    !answerIsSettled({
      stableStreak: 5,
      stablePolls: 3,
      generating: true,
      fromAnswerViewer: result.fromAnswerViewer,
      gateExtraPolls: 8,
      summaryHoldPolls: 16,
    })
  );
});

test("an answer that reads like a thought is still accepted, at any length (#74)", () => {
  for (const answer of [SHORT_CONVERSATIONAL_ANSWER, CONVERSATIONAL_ANSWER]) {
    const result = extractStructuredAnswer(conversationalAnswerRoot(answer));
    assert.equal(result.fromAnswerViewer, true, "it came out of the answer viewer");
    assert.ok(!isPlaceholder(answer), "no wording rule may veto it");
    assert.ok(
      answerIsSettled({
        stableStreak: 3,
        stablePolls: 3,
        generating: false,
        fromAnswerViewer: true,
        gateExtraPolls: 8,
        summaryHoldPolls: 16,
      }),
      "a settled turn returns it at the ordinary streak"
    );
  }
  // Both fixtures open with planning language — that is the whole point.
  assert.ok(SHORT_CONVERSATIONAL_ANSWER.startsWith("I am"));
  assert.ok(CONVERSATIONAL_ANSWER.startsWith("I am"));
});

test("loading text is caught wherever it renders, viewer or not (#74)", () => {
  // The viewer signal governs the gate, never the placeholder rules — loading
  // text renders inside the viewer too and must keep the poller waiting.
  for (const text of ["Loading...", THINKING_LABEL, "回答を生成しています"]) {
    assert.ok(isPlaceholder(text), `placeholder regardless of origin: ${text}`);
  }
});

test("a real answer is never mistaken for reasoning, in any locale (#74)", () => {
  for (const locale of LOCALES) {
    assert.ok(!isPlaceholder(ANSWERS[locale]), `must settle (${locale})`);
    assert.equal(
      extractStructuredAnswer(settledRoot(locale)).fromAnswerViewer,
      true,
      `recognised as the reply (${locale})`
    );
    assert.equal(sanitizeAnswer(ANSWERS[locale]), ANSWERS[locale], `untouched (${locale})`);
  }
});
