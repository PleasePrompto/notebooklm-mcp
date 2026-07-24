/**
 * NotebookLM chat extraction with turn correlation and completion detection.
 *
 * Replaces the legacy `waitForLatestAnswer()` (issue #43). Old logic gated on
 * `div.thinking-message`, which Google removed; calls timed out even though
 * the answer was visible. NotebookLM's current Gemini UI also renders loading
 * phrases and private reasoning in `.message-text-content`, so text stability
 * alone is not a completion signal. The current logic correlates an assistant
 * card with the exact submitted user turn and only accepts it after Gemini's
 * stop button disappears and the final `.message-actions` controls appear.
 *
 * Companion fixes:
 * - issue #14 / #27 — timeout is fully configurable per call
 * - issue #16    — bounded polls + sleep fallback to defuse zombie pages
 * - issue #28    — sanitisation strips UI-control labels before delivery
 */

import type { Page } from "patchright";
import { Selectors } from "./selectors.js";
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

function isPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();
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
}

export interface ChatMessageSnapshot {
  role: "user" | "assistant";
  text: string;
  complete?: boolean;
}

interface TurnAnswerState {
  userFound: boolean;
  text: string | null;
  complete: boolean;
  generating: boolean;
}

/**
 * Canonical form used to correlate a rendered user message with the submitted
 * question. NotebookLM may change line wrapping while preserving the content.
 */
export function normalizeChatText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * Pure turn-selection helper used by tests and the DOM extraction path.
 * A stable but incomplete Gemini reasoning card is deliberately rejected.
 */
export function findCompletedTurnAnswer(
  messages: ChatMessageSnapshot[],
  question: string
): string | null {
  const expected = normalizeChatText(question);
  let userIndex = -1;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "user" && normalizeChatText(message.text) === expected) {
      userIndex = index;
    }
  }

  if (userIndex < 0) return null;

  for (let index = userIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "user") return null;
    if (message.role === "assistant") {
      return message.complete ? sanitizeAnswer(message.text) || null : null;
    }
  }

  return null;
}

/**
 * Scroll to the newest turn and wait briefly for NotebookLM's virtualised
 * history to hydrate. Without this, the chat input can be ready while the DOM
 * still reports zero prior messages.
 */
export async function settleChatHistory(page: Page, timeoutMs = 5_000): Promise<void> {
  try {
    const jumpButton = page.locator(Selectors.chat.jumpToBottomButton).first();
    if ((await jumpButton.count()) > 0 && (await jumpButton.isVisible())) {
      await jumpButton.click({ timeout: 2_000 });
    }
  } catch {
    // The button is absent when the viewport is already at the bottom.
  }

  const messages = page.locator(Selectors.chat.message);
  try {
    if ((await messages.count()) > 0) {
      await messages.last().scrollIntoViewIfNeeded({ timeout: 2_000 });
    }
  } catch {
    // Hydration may replace the last element while it is being scrolled.
  }

  const deadline = Date.now() + timeoutMs;
  let previousSignature = "";
  let stablePolls = 0;

  while (Date.now() < deadline) {
    let signature: string;
    try {
      const count = await messages.count();
      const latest = count > 0 ? normalizeChatText(await messages.last().innerText()) : "";
      signature = `${count}|${latest}`;
    } catch {
      stablePolls = 0;
      await safeSleep(page, 250);
      continue;
    }

    if (signature === previousSignature) {
      stablePolls++;
      if (stablePolls >= 3) return;
    } else {
      previousSignature = signature;
      stablePolls = 1;
    }

    await safeSleep(page, 250);
  }
}

/**
 * Snapshot every visible assistant answer text *before* a new question is
 * submitted. Pass the result into `waitForStableAnswer({ ignoreTexts })` so
 * the new turn isn't confused with prior turns in the same session.
 */
export async function snapshotPriorAnswers(page: Page): Promise<string[]> {
  await settleChatHistory(page);
  return page
    .locator(Selectors.chat.answerText)
    .allInnerTexts()
    .then((texts) => texts.map(sanitizeAnswer).filter(Boolean))
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
  } = options;

  const deadline = Date.now() + timeoutMs;
  const echoText = normalizeChatText(question).toLowerCase();
  const ignoreSet = new Set(ignoreTexts.map(sanitizeAnswer).filter(Boolean));
  // Hard ceiling on poll iterations defends against pathological
  // pollIntervalMs values combined with zombie-page sleep returns (issue #16).
  const maxPolls = Math.max(8, Math.ceil(timeoutMs / Math.max(50, pollIntervalMs)) + 4);

  let lastSeen: string | null = null;
  let stableStreak = 0;
  let pollCount = 0;
  let sawGeneration = false;

  while (Date.now() < deadline && pollCount < maxPolls) {
    pollCount++;

    // Every 10th poll we make sure the renderer still answers — bounded so a
    // wedged tab can't keep us spinning until the deadline (issue #16).
    if (pollCount % 10 === 0 && !(await pageIsAlive(page))) {
      throw new Error("Browser page unresponsive: health check timed out");
    }

    let state: TurnAnswerState = {
      userFound: false,
      text: null,
      complete: false,
      generating: false,
    };
    try {
      state = question
        ? await readAnswerForQuestion(page, question)
        : await readLatestAnswerState(page);
    } catch (err) {
      if (isRecoverable(err)) throw err;
      // Non-fatal extraction blip — try again next tick.
    }

    sawGeneration ||= state.generating;
    const candidate = state.text;
    if (candidate) {
      const isEcho = normalizeChatText(candidate).toLowerCase() === echoText;
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
        if (!state.generating && (isErrorMessage(candidate) || isRateLimitText(candidate))) {
          return candidate;
        }

        // `.message-actions` is rendered only for a completed answer in the
        // current UI. `sawGeneration` is a compatibility fallback for older
        // layouts that expose the stop button but not the action row.
        const hasCompletionSignal = state.complete || (sawGeneration && !state.generating);

        if (hasCompletionSignal) {
          if (candidate === lastSeen) {
            stableStreak++;
            if (stableStreak >= stablePolls) {
              return candidate;
            }
          } else {
            lastSeen = candidate;
            stableStreak = 1;
          }
        } else {
          stableStreak = 0;
          lastSeen = null;
        }
      }
    } else if (question && state.userFound) {
      // The user turn exists, but its assistant card has not mounted yet.
      stableStreak = 0;
      lastSeen = null;
    }

    await safeSleep(page, pollIntervalMs);
  }

  return null;
}

/**
 * Read the answer card immediately following the exact submitted user turn.
 * This prevents hydrated history or an older stable card from being returned.
 */
async function readAnswerForQuestion(page: Page, question: string): Promise<TurnAnswerState> {
  const expected = normalizeChatText(question);
  const messages = page.locator(Selectors.chat.message);

  try {
    const match = await messages.evaluateAll((elements, expectedText) => {
      const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
      let userIndex = -1;

      for (let index = 0; index < elements.length; index++) {
        const user = elements[index].querySelector(".from-user-container");
        if (user && normalize((user as HTMLElement).innerText) === expectedText) {
          userIndex = index;
        }
      }

      if (userIndex < 0) {
        return { userFound: false, answerIndex: -1, complete: false };
      }

      for (let index = userIndex + 1; index < elements.length; index++) {
        if (elements[index].querySelector(".from-user-container")) break;
        const answer = elements[index].querySelector(".to-user-container");
        if (answer) {
          return {
            userFound: true,
            answerIndex: index,
            complete: Boolean(answer.querySelector(".message-actions")),
          };
        }
      }

      return { userFound: true, answerIndex: -1, complete: false };
    }, expected);

    const generating = await isGenerating(page);
    if (match.answerIndex < 0) {
      return { userFound: match.userFound, text: null, complete: false, generating };
    }

    const textElement = messages
      .nth(match.answerIndex)
      .locator(".to-user-container .message-text-content")
      .first();
    const raw = await readFormattedAnswer(textElement);
    const cleaned = sanitizeAnswer(raw);

    return {
      userFound: true,
      text: cleaned || null,
      complete: match.complete && !generating,
      generating,
    };
  } catch {
    return { userFound: false, text: null, complete: false, generating: false };
  }
}

async function readLatestAnswerState(page: Page): Promise<TurnAnswerState> {
  try {
    const answers = page.locator(Selectors.chat.answerContainer);
    if ((await answers.count()) === 0) {
      return { userFound: false, text: null, complete: false, generating: false };
    }

    const latest = answers.last();
    const generating = await isGenerating(page);
    const complete = (await latest.locator(".message-actions").count()) > 0 && !generating;
    const raw = await readFormattedAnswer(latest.locator(".message-text-content").first());
    const cleaned = sanitizeAnswer(raw);
    return {
      userFound: false,
      text: cleaned || null,
      complete,
      generating,
    };
  } catch {
    return { userFound: false, text: null, complete: false, generating: false };
  }
}

async function isGenerating(page: Page): Promise<boolean> {
  const stopButton = page.locator(Selectors.chat.stopButton).first();
  return (await stopButton.count()) > 0 && (await stopButton.isVisible().catch(() => false));
}

/**
 * Preserve NotebookLM's rendered block layout and add Markdown markers that
 * browser `innerText` omits for lists and inline citations.
 */
async function readFormattedAnswer(textElement: ReturnType<Page["locator"]>): Promise<string> {
  return textElement.evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;

    clone.querySelectorAll("button.citation-marker").forEach((button) => {
      const label = (button.textContent || "").trim();
      const replacement = document.createTextNode(/^\d+$/.test(label) ? `[${label}]` : "");
      button.replaceWith(replacement);
    });

    clone.querySelectorAll("ul, ol").forEach((list) => {
      const directItems = Array.from(list.querySelectorAll("li")).filter(
        (item) => item.closest("ul, ol") === list
      );
      directItems.forEach((item, index) => {
        const prefix = list.tagName === "OL" ? `${index + 1}. ` : "- ";
        item.prepend(document.createTextNode(prefix));
      });
    });

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:fixed;left:-100000px;top:0;width:800px;visibility:visible";
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    const text = clone.innerText;
    wrapper.remove();
    return text;
  });
}

/**
 * Strip Material-icon labels (`more_vert`, `more_horiz`, …) and orphaned
 * citation markers that NotebookLM occasionally leaks into `innerText`.
 * Only isolated lines are removed — never inline content — so legitimate
 * answer prose with the same words ("more horizontal") is not touched.
 */
export function sanitizeAnswer(text: string): string {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());

  const kept: string[] = [];
  let pendingBlank = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      pendingBlank = kept.length > 0;
      continue;
    }

    if (Selectors.uiControlLabels.has(line)) continue;

    // Drop lone digits or punctuation flanking a UI-control label
    // (typical citation-marker leak: ["1", "more_vert"]).
    const next = lines[i + 1] ?? "";
    const prev = lines[i - 1] ?? "";
    const nextIsControl = Selectors.uiControlLabels.has(next);
    const prevIsControl = Selectors.uiControlLabels.has(prev);
    if (/^\d+$/.test(line) && nextIsControl) continue;
    if (/^[.,;:!?]+$/.test(line) && (nextIsControl || prevIsControl)) continue;

    if (pendingBlank && kept.at(-1) !== "") kept.push("");
    kept.push(line);
    pendingBlank = false;
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
}
