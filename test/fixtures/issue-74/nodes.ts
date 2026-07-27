/**
 * Issue #74 — reference DOM fixtures for the answer-extraction tests.
 *
 * # Provenance
 *
 * The shapes below were read out of the DOM audit snapshots captured for issue
 * #74 (`dom-audit-runs/`, git-ignored — they contain real notebook answers).
 * Only the *structure* is reproduced here; every piece of text is synthetic, so
 * nothing private is committed. Verified against 36 snapshots (12 questions ×
 * generating / streaming / settled) on the 2026-07 NotebookLM build:
 *
 *   .to-user-container                            ← Selectors.chat.answerContainer
 *     mat-card.to-user-message-card-content
 *       mat-card-content.message-content
 *         div.message-text-content.mat-body-medium   ← Selectors.chat.answerText
 *           ├─ GENERATING  <thinking-animation class="ng-star-inserted">
 *           │                 div.thinking-animation-container
 *           │                   ├─ div.thinking-animation[lottie-animation]  (svg shimmer)
 *           │                   └─ div.thinking-message.is-changing  "Parsing the data..."
 *           │
 *           ├─ SETTLED     <labs-tailwind-doc-viewer class="ng-star-inserted">
 *           │                 element-list-renderer
 *           │                   labs-tailwind-structural-element-view-v2
 *           │                     paragraph-element-view
 *           │                       div.paragraph.normal → span/i/b + button.citation-marker
 *           │
 *           └─ REASONING SUMMARY (its own assistant card)
 *                            <div class="md3-body-text" role="heading" aria-level="3">
 *                              <p><strong>Finalizing the Scope</strong></p>
 *                              <p>I've just focused on …</p>
 *
 * # Two things worth knowing
 *
 * 1. The reasoning **component** (`thinking-animation`) is a direct-child
 *    SIBLING of the answer node, so `extractStructuredAnswer()` excludes it
 *    structurally — that is the primary fix.
 * 2. The reasoning **summary** is NOT part of that component: it renders as a
 *    plain `div.md3-body-text[role="heading"]`, indistinguishable by tag, class
 *    or wording from ordinary content. No *filter* can see it — but it is never
 *    inside the answer viewer, and the reply always is (33/33 settled captures
 *    vs 9/9 summaries), so the acceptance gate holds it on that alone.
 *    `reasoningSummaryRoot` below pins that contract down.
 *
 * The reasoning labels and the summary prose stream in **English regardless of
 * the notebook/answer locale** (audit finding OQ3), so the locale variants below
 * differ only in the answer text.
 */
import type { AnswerRootLike } from "../../../src/notebooklm/chat.js";

export type Locale = "en" | "ja" | "pl";

/** Synthetic stand-ins for real answers — same shape, no private content. */
export const ANSWERS: Record<Locale, string> = {
  en: "The sources recommend visiting between April and October, when the nights are coolest and the skies stay clear [1].",
  ja: "資料によると、訪問に最適な時期は4月から10月で、夜間の気温が下がり空も晴れています [1]。",
  pl: "Źródła zalecają wizytę między kwietniem a październikiem, gdy noce są chłodniejsze, a niebo pozostaje bezchmurne [1].",
};

/** The `.thinking-message` label — English on every locale (OQ3). */
export const THINKING_LABEL = "Parsing the data...";

/** Gemini's extended-thinking summary — English on every locale (OQ3). */
export const REASONING_SUMMARY =
  "Finalizing the Scope\nI've just focused on adding the missing detail, and I'm now " +
  "re-reviewing the output to make sure every constraint is met.";

const node = (tagName: string, className: string, innerText: string) => ({
  tagName,
  className,
  innerText,
});

/** Form 1, generating: the reasoning component is the only child. */
export const generatingRoot: AnswerRootLike = {
  children: [node("THINKING-ANIMATION", "ng-star-inserted", THINKING_LABEL)],
  innerText: THINKING_LABEL,
};

/** Settled: reasoning component gone, answer viewer mounted. */
export const settledRoot = (locale: Locale): AnswerRootLike => ({
  children: [node("LABS-TAILWIND-DOC-VIEWER", "ng-star-inserted", ANSWERS[locale])],
  innerText: ANSWERS[locale],
});

/** Transition: the reasoning component and a streaming answer coexist. */
export const mixedRoot = (locale: Locale): AnswerRootLike => ({
  children: [
    node("THINKING-ANIMATION", "ng-star-inserted", THINKING_LABEL),
    node("LABS-TAILWIND-DOC-VIEWER", "ng-star-inserted", ANSWERS[locale]),
  ],
  innerText: `${THINKING_LABEL}\n${ANSWERS[locale]}`,
});

/**
 * The reasoning summary card. Structurally identical to answer content except
 * for one thing: it is not the answer viewer. The gate catches it on that.
 */
export const reasoningSummaryRoot: AnswerRootLike = {
  children: [node("DIV", "md3-body-text ng-star-inserted", REASONING_SUMMARY)],
  innerText: REASONING_SUMMARY,
};

/**
 * A REAL answer that opens with first-person planning language.
 *
 * Shape observed in the audit captures (1 of 33 settled answers): a long,
 * grounded reply beginning "I am thrilled to …". Any rule that recognises a
 * reasoning summary by its *wording* discards this — the poller then never
 * accepts it and `ask_question` fails on a full timeout with the answer sitting
 * on screen. The structural read has no such rule; these fixtures come in a
 * long and a short variant so neither length nor phrasing can be leaned on.
 */
export const CONVERSATIONAL_ANSWER = [
  "I am thrilled to walk you through what the sources actually say about planning a trip in the shoulder season, because the guidance is more nuanced than a single date range [1].",
  "The first consideration is weather: the sources describe a dry window that opens in late April and closes in early October, with the clearest skies concentrated in the middle of that period [1].",
  "The second consideration is cost. Accommodation rates are quoted as roughly a third lower outside the December peak, and the same chapter notes that internal transport is easier to book on short notice [2].",
  "The third consideration is crowding at the headline sights, which the sources treat as the main argument for travelling midweek wherever an itinerary allows it [2].",
  "A fourth, quieter point runs through the regional chapters: the guidance assumes two nights minimum at each base, on the grounds that a single night rarely survives a delayed connection [3].",
  "Taken together the material supports a simple rule: aim for the middle of the dry window, book the two or three fixed points of the route early, and leave the rest flexible so the plan can absorb a weather day [3].",
].join("\n\n");

/** Same opener, short enough that only the answer-viewer signal can save it. */
export const SHORT_CONVERSATIONAL_ANSWER =
  "I am happy to report that the sources agree on the April-to-October window [1].";

/** A conversational answer as the DOM presents it — inside the answer viewer. */
export const conversationalAnswerRoot = (text = CONVERSATIONAL_ANSWER): AnswerRootLike => ({
  children: [node("LABS-TAILWIND-DOC-VIEWER", "ng-star-inserted", text)],
  innerText: text,
});

/**
 * Guard case: the answer viewer is mounted but still EMPTY while a reasoning
 * summary holds the only text. The viewer signal must NOT fire here, or the
 * summary would be waved through as the answer.
 */
export const emptyViewerWithSummaryRoot: AnswerRootLike = {
  children: [
    node("LABS-TAILWIND-DOC-VIEWER", "ng-star-inserted", ""),
    node("DIV", "md3-body-text ng-star-inserted", REASONING_SUMMARY),
  ],
  innerText: REASONING_SUMMARY,
};

/**
 * Collapsed-header leak, as `innerText` reads it (issue #74 forms 2 & 3).
 * SYNTHETIC: the audited build rendered the header as a component
 * (`collapsedObserved: false` in every run), so these reproduce the shape from
 * the issue report — a header line, the Material toggle, then optionally the
 * answer. Header words in four locales prove the strip keys on the icon.
 */
export const COLLAPSED_HEADERS = ["Thoughts", "思考プロセス", "Myśli", "Gedanken"];
