/**
 * NotebookLM chat extraction with streaming-stability detection.
 *
 * Replaces the legacy `waitForLatestAnswer()` (issue #43). Old logic gated on
 * `div.thinking-message`, which Google removed; calls timed out even though
 * the answer was visible. New logic only relies on the answer container itself
 * and treats text as final once it has been *stable* across N consecutive
 * polls (default 3). That makes the wait robust to UI churn and Material-icon
 * leaks (`more_vert`, `more_horiz`, …) which would otherwise destabilise the
 * extracted text.
 *
 * Companion fixes:
 * - issue #14 / #27 — timeout is fully configurable per call
 * - issue #16    — bounded polls + sleep fallback to defuse zombie pages
 * - issue #28    — sanitisation strips UI-control labels before delivery
 * - issue #74    — the answer read is *structural*: Gemini 2.5's reasoning
 *   component shares the answer selector, so `readLatestAnswer()` reads only
 *   the non-reasoning children of `.message-text-content`, and text that did
 *   not come out of the answer viewer is not accepted while the turn is still
 *   running. Read-time filtering, never DOM mutation, so citation extraction
 *   stays intact; every rule keys on structure or on a Material icon, never on
 *   a localized word.
 */

import type { Page } from "patchright";
import { Selectors, REASONING_HEADERS } from "./selectors.js";
import { isRecoverable, pageIsAlive, safeSleep } from "../browser/watchdog.js";

/**
 * Loading-state phrases NotebookLM streams into the answer container before
 * the real response arrives. The stability detector would otherwise lock
 * onto these (they're "stable" while Gemini still thinks). Coverage spans
 * the eight major NotebookLM locales (EN, DE, FR, ES, PT, IT, NL, JA).
 */
const PLACEHOLDER_SNIPPETS = [
  // English
  "answer is being created",
  "answer is being generated",
  "creating answer",
  "generating answer",
  "getting the context",
  "getting the gist",
  "loading",
  "please wait",
  "looking for clues",
  "reading full chapters",
  "examining the specifics",
  "checking the scope",
  "opening your notes",
  "analyzing your files",
  "searching your docs",
  "scanning sources",
  "reviewing content",
  "processing request",
  "parsing the data",
  "gathering the facts",
  "thinking",
  "searching",
  // German
  "antwort wird erstellt",
  "antwort wird generiert",
  "wird erstellt",
  "wird generiert",
  "lädt",
  "wird geladen",
  "bitte warten",
  "quellen werden gescannt",
  "kontext wird abgerufen",
  "denke nach",
  // French
  "analyse en cours",
  "génération en cours",
  "réponse en cours",
  "chargement en cours",
  "veuillez patienter",
  "recherche en cours",
  // Spanish
  "generando respuesta",
  "creando respuesta",
  "cargando",
  "espere por favor",
  "buscando",
  "analizando",
  // Italian
  "generazione della risposta",
  "creazione della risposta",
  "caricamento",
  "attendere",
  "ricerca in corso",
  "analisi in corso",
  // Portuguese
  "gerando resposta",
  "criando resposta",
  "carregando",
  "por favor aguarde",
  "procurando",
  "analisando",
  // Dutch
  "antwoord wordt gegenereerd",
  "antwoord wordt gemaakt",
  "laden",
  "even geduld",
  "zoeken",
  "analyseren",
  // Japanese
  "回答を生成しています",
  "読み込み中",
  "お待ちください",
  "検索中",
  "分析中",
];

const ERROR_SNIPPETS = [
  // English
  "the system could not respond",
  "the system failed",
  "an error occurred",
  "try again later",
  // German
  "das system konnte keine antwort erstellen",
  "das system konnte nicht antworten",
  "es ist ein fehler aufgetreten",
  "versuche es später erneut",
  "versuchen sie es später erneut",
  // French
  "le système n'a pas pu répondre",
  "le système n'a pas réussi",
  "une erreur est survenue",
  "réessayez plus tard",
  // Spanish
  "el sistema no pudo responder",
  "ha ocurrido un error",
  "vuelve a intentarlo más tarde",
  "inténtalo de nuevo más tarde",
  // Italian
  "il sistema non è riuscito a rispondere",
  "si è verificato un errore",
  "riprova più tardi",
  // Portuguese
  "o sistema não pôde responder",
  "ocorreu um erro",
  "tente novamente mais tarde",
  // Dutch
  "het systeem kon niet reageren",
  "er is een fout opgetreden",
  "probeer het later opnieuw",
  // Japanese
  "システムが応答できませんでした",
  "エラーが発生しました",
  "後でもう一度お試しください",
];

const RATE_LIMIT_MESSAGES = [
  // English
  "daily discussion limit",
  "daily limit reached",
  "query limit reached",
  "rate limit exceeded",
  // German
  "tägliches diskussionslimit",
  "tageslimit erreicht",
  "ratenlimit überschritten",
  // French
  "vous avez atteint la limite quotidienne",
  "limite quotidienne de discussions",
  "limite quotidienne atteinte",
  // Spanish
  "límite diario alcanzado",
  "has alcanzado el límite diario",
  // Italian
  "limite giornaliero raggiunto",
  "hai raggiunto il limite giornaliero",
  // Portuguese
  "limite diário atingido",
  "você atingiu o limite diário",
  // Dutch
  "daglimiet bereikt",
  // Japanese
  "1日あたりの上限に達しました",
];

/**
 * Collapsed-reasoning-header words (issue #74 form 2) — the code default plus
 * `NOTEBOOKLM_REASONING_HEADERS`. EMPTY unless configured: the icon-anchored
 * strip in `sanitizeAnswer()` handles the common case without any word list, so
 * this is only the escape-hatch for builds that leak a bare header with no
 * toggle icon next to it.
 */
const REASONING_HEADERS_SET = new Set(
  [...REASONING_HEADERS, ...(process.env.NOTEBOOKLM_REASONING_HEADERS ?? "").split(",")]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export function isPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();
  // A bare collapsed reasoning header ("Thoughts") is a UI label, not an answer.
  // Whole-line exact match only — never a substring — so an answer that merely
  // contains the word mid-sentence is unaffected (issue #74).
  if (REASONING_HEADERS_SET.has(lower.trim())) return true;
  if (PLACEHOLDER_SNIPPETS.some((s) => lower.includes(s))) return true;
  // Short text ending with "..." is almost certainly a loading indicator;
  // real responses run well past 50 chars.
  if (text.length < 50 && text.trim().endsWith("...")) return true;
  return false;
}

function isErrorMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return ERROR_SNIPPETS.some((s) => lower.includes(s));
}

function isRateLimitText(text: string): boolean {
  const lower = text.toLowerCase();
  return RATE_LIMIT_MESSAGES.some((s) => lower.includes(s));
}

/**
 * Extra stable polls tolerated while the chat textarea is *still disabled*
 * (issue #74). NotebookLM disables it for the duration of a turn, so an enabled
 * textarea is the cheapest "generation finished" signal there is — but it also
 * stays disabled on a silent rate-limit, hence the bound: ≈6 s at the 750 ms
 * default cadence, never a hang. Override per call via `AskOptions` or globally
 * via `NOTEBOOKLM_GATE_EXTRA_POLLS`.
 */
const GATE_EXTRA_POLLS_ENV = Number.parseInt(process.env.NOTEBOOKLM_GATE_EXTRA_POLLS ?? "", 10);
const DEFAULT_GATE_EXTRA_POLLS = Number.isNaN(GATE_EXTRA_POLLS_ENV)
  ? 8
  : Math.max(0, GATE_EXTRA_POLLS_ENV);

/**
 * Extra stable polls required before accepting text that did NOT come out of
 * the answer viewer while the turn is still running (issue #74).
 *
 * Gemini's extended-thinking summary renders as ordinary content — a
 * `div.md3-body-text` with no marker of its own — so nothing distinguishes it
 * from a reply except *where* it sits: the reply is inside
 * `labs-tailwind-doc-viewer`, the summary never is (33/33 settled answers vs
 * 9/9 summaries across the audit captures). Held longer than the textarea gate
 * because releasing early returns the wrong text while holding only costs
 * latency. Still bounded, so a build that renders no viewer degrades to the
 * ordinary stability behaviour instead of hanging: ≈14 s at the 750 ms cadence,
 * against a longest-observed reasoning window of ~6 s.
 */
const SUMMARY_HOLD_POLLS = 16;

/**
 * Soft, bounded acceptance gate (issue #74). A stable answer is accepted as
 * final once the textarea is enabled. While the turn is still running we
 * require more stable polls — `gateExtraPolls` when the text came out of the
 * answer viewer (it is the reply, still streaming), `summaryHoldPolls` when it
 * did not (it is probably the reasoning summary). Both are bounded, so neither
 * a stuck-disabled textarea nor a renamed viewer component can hang the poll.
 */
export function answerIsSettled(o: {
  stableStreak: number;
  stablePolls: number;
  generating: boolean;
  fromAnswerViewer: boolean;
  gateExtraPolls: number;
  summaryHoldPolls: number;
}): boolean {
  const extra = o.generating
    ? Math.max(0, o.fromAnswerViewer ? o.gateExtraPolls : o.summaryHoldPolls)
    : 0;
  return o.stableStreak >= o.stablePolls + extra;
}

export interface AskOptions {
  /** The question text — used to skip echo lines that NotebookLM mirrors back. */
  question?: string;
  /** Hard ceiling on the wait. Default 600 000 ms (10 min) — overridable per call. */
  timeoutMs?: number;
  /** Poll cadence. Default 750 ms. Lower values increase load without much benefit. */
  pollIntervalMs?: number;
  /** Texts known *before* the question was submitted. Used to skip prior answers. */
  ignoreTexts?: string[];
  /** How many consecutive identical polls count as "answer settled". Default 3. */
  stablePolls?: number;
  /**
   * Extra stable polls required while the chat textarea is still disabled
   * (issue #74). Default 8 (`NOTEBOOKLM_GATE_EXTRA_POLLS`); `0` disables the
   * gate.
   */
  gateExtraPolls?: number;
}

/**
 * Snapshot every visible assistant answer text *before* a new question is
 * submitted. Pass the result into `waitForStableAnswer({ ignoreTexts })` so
 * the new turn isn't confused with prior turns in the same session.
 */
export async function snapshotPriorAnswers(page: Page): Promise<string[]> {
  return page
    .locator(Selectors.chat.answerText)
    .allInnerTexts()
    .then((texts) => texts.map((t) => t.trim()).filter(Boolean))
    .catch(() => []);
}

/**
 * Wait for the *latest* answer text to appear and stabilise.
 *
 * Returns the sanitised final text, or `null` on timeout. The function never
 * throws on UI hiccups — failure surfaces as `null` so the caller can decide
 * how to recover (retry vs. report error to the user).
 */
export async function waitForStableAnswer(
  page: Page,
  options: AskOptions = {}
): Promise<string | null> {
  const {
    question = "",
    timeoutMs = 600_000,
    pollIntervalMs = 750,
    ignoreTexts = [],
    stablePolls = 3,
    gateExtraPolls = DEFAULT_GATE_EXTRA_POLLS,
  } = options;

  const deadline = Date.now() + timeoutMs;
  const echoLower = question.trim().toLowerCase();
  const ignoreSet = new Set(ignoreTexts.map((t) => t.trim()).filter(Boolean));
  // Hard ceiling on poll iterations defends against pathological
  // pollIntervalMs values combined with zombie-page sleep returns (issue #16).
  const maxPolls = Math.max(8, Math.ceil(timeoutMs / Math.max(50, pollIntervalMs)) + 4);

  let lastSeen: string | null = null;
  let stableStreak = 0;
  let pollCount = 0;

  while (Date.now() < deadline && pollCount < maxPolls) {
    pollCount++;

    // Every 10th poll we make sure the renderer still answers — bounded so a
    // wedged tab can't keep us spinning until the deadline (issue #16).
    if (pollCount % 10 === 0 && !(await pageIsAlive(page))) {
      throw new Error("Browser page unresponsive: health check timed out");
    }

    let latest: LatestAnswer = {
      text: null,
      reasoningPresent: false,
      generating: false,
      fromAnswerViewer: false,
    };
    try {
      latest = await readLatestAnswer(page);
    } catch (err) {
      if (isRecoverable(err)) throw err;
      // Non-fatal extraction blip — try again next tick.
    }
    const candidate = latest.text;

    // Pure-generation window: Gemini's reasoning component is mounted and no
    // answer node exists yet (issue #74). There is nothing to stabilise on, so
    // keep waiting instead of latching onto a half-rendered turn.
    if (latest.reasoningPresent && !candidate) {
      stableStreak = 0;
      lastSeen = null;
      await safeSleep(page, Math.min(pollIntervalMs, 400));
      continue;
    }

    if (candidate) {
      const isEcho = candidate.toLowerCase() === echoLower;
      const isPrior = ignoreSet.has(candidate);

      if (!isEcho && !isPrior) {
        // Loading placeholders ("Parsing the data…", "Thinking…", …) are
        // stable while Gemini is still working — the old code locked on to
        // them and returned them as the final answer. Filter them out.
        if (isPlaceholder(candidate)) {
          stableStreak = 0;
          lastSeen = null;
          await safeSleep(page, Math.min(pollIntervalMs, 400));
          continue;
        }

        // Hard errors and rate-limit messages can be returned immediately —
        // there is no "stable" follow-up text coming.
        if (isErrorMessage(candidate) || isRateLimitText(candidate)) {
          return candidate;
        }

        if (candidate === lastSeen) {
          stableStreak++;
          // Stable *and* past the soft acceptance gate (issue #74) — while the
          // turn is still running, stable text is usually the reasoning→answer
          // transition, and stable text from outside the answer viewer is
          // usually the reasoning summary. Both wait longer, neither hangs.
          if (
            answerIsSettled({
              stableStreak,
              stablePolls,
              generating: latest.generating,
              fromAnswerViewer: latest.fromAnswerViewer,
              gateExtraPolls,
              summaryHoldPolls: SUMMARY_HOLD_POLLS,
            })
          ) {
            return candidate;
          }
        } else {
          lastSeen = candidate;
          stableStreak = 1;
        }
      }
    }

    await safeSleep(page, pollIntervalMs);
  }

  return null;
}

/**
 * Minimal node abstraction shared by the browser DOM and the unit fixtures, so
 * the structural selection below can be unit-tested without a browser.
 */
export interface AnswerNodeLike {
  tagName: string;
  className: string;
  innerText: string;
}
export interface AnswerRootLike {
  children: AnswerNodeLike[];
  innerText: string;
}

const REASONING_CLASS_RE = new RegExp(Selectors.chat.reasoningClassPattern, "i");

/**
 * True if a node is (part of) Gemini's reasoning component (issue #74).
 * Matches the language-agnostic family pattern (`thinking[-_]` in the tag or
 * class) plus the explicitly named components, so a Google rename degrades to
 * the pattern instead of silently leaking the reasoning trace.
 */
export function isReasoningNode(node: { tagName: string; className: string }): boolean {
  const tag = (node.tagName || "").toLowerCase();
  const cls = node.className || "";
  if (REASONING_CLASS_RE.test(tag) || REASONING_CLASS_RE.test(cls)) return true;
  for (const sel of Selectors.chat.reasoningNode) {
    if (sel.startsWith(".")) {
      if (cls.split(/\s+/).includes(sel.slice(1))) return true;
    } else if (tag === sel) {
      return true;
    }
  }
  return false;
}

const ANSWER_VIEWER_TAGS: ReadonlySet<string> = new Set(
  Selectors.chat.answerViewerNode.map((tag) => tag.toLowerCase())
);

/** True if a node is the component NotebookLM renders a settled answer into. */
export function isAnswerViewerNode(node: { tagName: string }): boolean {
  return ANSWER_VIEWER_TAGS.has((node.tagName || "").toLowerCase());
}

/**
 * PRIMARY structural read (issue #74). The reasoning component and the answer
 * node are direct-child SIBLINGS inside `.message-text-content`, so reading the
 * non-reasoning children yields the answer alone — no DOM mutation, hence no
 * impact on citation extraction.
 *
 * Pure by design: `readLatestAnswer()` ships the DOM out of the page as plain
 * node data and calls *this* function, so the browser path and the unit tests
 * exercise one implementation.
 */
export function extractStructuredAnswer(root: AnswerRootLike): {
  text: string | null;
  reasoningPresent: boolean;
  /** Every scrap of the returned text came out of the answer viewer. */
  fromAnswerViewer: boolean;
} {
  const children = root.children ?? [];
  const reasoningPresent = children.some(isReasoningNode);
  const answerEls = children.filter((el) => !isReasoningNode(el));
  let text = answerEls
    .map((el) => el.innerText || "")
    .join("\n")
    .trim();
  // Some builds render the answer as direct text nodes of the container. Only
  // safe while no reasoning node is mounted — `innerText` would include it.
  if (!text && !reasoningPresent) text = (root.innerText || "").trim();
  // Positive signal for the text layer: require that the viewer *produced* the
  // text, so an empty viewer mounted beside a reasoning summary vouches for
  // nothing (that combination is exactly how the summary reaches us).
  const contributing = answerEls.filter((el) => (el.innerText || "").trim().length > 0);
  const fromAnswerViewer = contributing.length > 0 && contributing.every(isAnswerViewerNode);
  return { text: text.length > 0 ? text : null, reasoningPresent, fromAnswerViewer };
}

interface LatestAnswer {
  /** Sanitised answer text, or `null` when nothing answer-shaped is mounted. */
  text: string | null;
  /** Gemini's reasoning component is mounted → the turn is still generating. */
  reasoningPresent: boolean;
  /** The chat textarea is disabled → NotebookLM is still working (issue #74). */
  generating: boolean;
  /** The text came out of the answer viewer → it is the reply (issue #74). */
  fromAnswerViewer: boolean;
}

/**
 * Read the latest answer container's text and strip UI-control leakage.
 *
 * Structural: only the non-reasoning children of the container contribute text
 * (issue #74). The textarea-disabled flag is folded into the same round-trip so
 * the stability gate costs no extra `page.evaluate`.
 */
async function readLatestAnswer(page: Page): Promise<LatestAnswer> {
  try {
    // The page side only *reads* the DOM into plain data; the reasoning
    // filtering itself runs in `extractStructuredAnswer()` here in Node, so the
    // shipped selection logic is exactly the unit-tested one — no second copy
    // to keep in sync.
    const raw = await page.evaluate(
      ({ answerSel, queryInputSel }) => {
        const nodes = document.querySelectorAll(answerSel);
        const root = nodes.length > 0 ? (nodes[nodes.length - 1] as HTMLElement) : null;
        const input = document.querySelector(queryInputSel) as HTMLTextAreaElement | null;
        const generating = !!input && (input.disabled || input.hasAttribute("disabled"));
        if (!root) return { root: null, generating };
        return {
          root: {
            children: Array.from(root.children).map((el) => ({
              tagName: el.tagName,
              className: typeof el.className === "string" ? el.className : "",
              innerText: (el as HTMLElement).innerText || "",
            })),
            innerText: root.innerText || "",
          },
          generating,
        };
      },
      {
        answerSel: Selectors.chat.answerText,
        // Same element the rate-limit probe reads (`browser-session.ts`).
        queryInputSel: Selectors.chat.queryInput[0],
      }
    );

    if (!raw.root) {
      return {
        text: null,
        reasoningPresent: false,
        generating: raw.generating,
        fromAnswerViewer: false,
      };
    }

    const { text, reasoningPresent, fromAnswerViewer } = extractStructuredAnswer(raw.root);
    const cleaned = text ? sanitizeAnswer(text) : "";
    return {
      text: cleaned.length > 0 ? cleaned : null,
      reasoningPresent,
      generating: raw.generating,
      fromAnswerViewer,
    };
  } catch {
    // Legacy fallback — never regress if the structural read fails: plain
    // `innerText` of the latest container, exactly as before issue #74.
    try {
      const legacy = await page
        .locator(Selectors.chat.latestAnswerText)
        .last()
        .innerText({ timeout: 2_000 });
      const cleaned = sanitizeAnswer(legacy);
      return {
        text: cleaned.length > 0 ? cleaned : null,
        reasoningPresent: false,
        generating: false,
        fromAnswerViewer: false,
      };
    } catch {
      return { text: null, reasoningPresent: false, generating: false, fromAnswerViewer: false };
    }
  }
}

/** Language-agnostic toggle icons that mark a collapsible reasoning header. */
const REASONING_TOGGLES: ReadonlySet<string> = new Set(Selectors.chat.reasoningToggleIcons);

/**
 * Strip Material-icon labels (`more_vert`, `more_horiz`, …) and orphaned
 * citation markers that NotebookLM occasionally leaks into `innerText`.
 * Only isolated lines are removed — never inline content — so legitimate
 * answer prose with the same words ("more horizontal") is not touched.
 *
 * Also drops a *collapsed reasoning header* (issue #74 forms 2 & 3) — see the
 * icon-anchored rule below.
 */
export function sanitizeAnswer(text: string): string {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (Selectors.uiControlLabels.has(line)) continue;

    // Drop lone digits or punctuation flanking a UI-control label
    // (typical citation-marker leak: ["1", "more_vert"]).
    const next = lines[i + 1] ?? "";
    const prev = lines[i - 1] ?? "";
    const nextIsControl = Selectors.uiControlLabels.has(next);
    const prevIsControl = Selectors.uiControlLabels.has(prev);
    if (/^\d+$/.test(line) && nextIsControl) continue;
    if (/^[.,;:!?]+$/.test(line) && (nextIsControl || prevIsControl)) continue;

    // A line immediately followed by an `expand_more`/`expand_less` toggle is a
    // COLLAPSED REASONING HEADER, not answer prose (issue #74 forms 2 & 3); the
    // toggle line itself is already dropped by the `uiControlLabels` rule above.
    // The anchor is a Material symbol, so this works in every locale with no
    // header word list. Restricted to the leading header region — nothing kept
    // yet, or directly after another toggle — so an answer line that happens to
    // be followed by a stray toggle is never truncated.
    if (REASONING_TOGGLES.has(next) && (kept.length === 0 || REASONING_TOGGLES.has(prev))) continue;

    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
}
