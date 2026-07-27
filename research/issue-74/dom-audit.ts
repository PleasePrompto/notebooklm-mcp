/**
 * DOM audit for NotebookLM answer generation (issue #74) — v2.
 *
 * Goal: answer, with data instead of hand-typed class names, whether Gemini's
 * reasoning block (`thinking-chain-view` / `.thinking-chain` / `thinking-animation`
 * / `.thinking-message`, or whatever Google currently calls it) reliably
 *   (a) exists WHILE generating, and
 *   (b) vanishes once the answer settles,
 * across notebooks / question shapes / locales. If so, a structural skip is a
 * viable PRIMARY fix; if not, the text heuristic (PR #75) must stay primary.
 *
 * v2 additions — each covers a coverage gap found against issue #74 + PR #75:
 *   - GAP A (issue suggestion #3): a second "prior-placeholder gate" shadow that
 *     only accepts a stable answer AFTER a placeholder state was seen — measures
 *     whether "require the loading indicator to have appeared and gone" would fix
 *     the bug. Also records `placeholderEverSeen`.
 *   - GAP B (PR #75 premise "no dedicated CSS class"): records
 *     `reasoningComponentSeenWhileGenerating` — was a NAMED dedicated component
 *     element present while the textarea was disabled? (Refutes the premise.)
 *   - GAP C (form 3, settled-answer prefix): records `finalHeaderPrefixDetected`
 *     + `finalFirstLine` — did the SETTLED answer carry a leading reasoning-header
 *     line ("Thoughts\n<answer>"), separately from timeout contamination?
 *   - Two-phase finding: `reasoningInTextWhileDisabledSeen` — a tick where the
 *     component is GONE but the textarea is still disabled and the answer element
 *     holds reasoning prose (the phase a naive "component-absent ⇒ final" misses).
 *   - Phase snapshots are now FULL-PAGE HTML (`page.content()`) — the reasoning
 *     node lives OUTSIDE `.to-user-container`, so a turn-scoped outerHTML misses
 *     it — and screenshots are FULL-HEIGHT (`fullPage: true`), not answer-box only.
 *
 * It does NOT hard-code the answer. For every question it captures:
 *   - mutations.jsonl  — every element add/remove/class-flip inside the answer
 *                        turn + every textarea disabled flip, timestamped.
 *   - timeline.jsonl   — a 250ms existence-sampler: for each candidate node,
 *                        present? collapsed? correlated with textarea.disabled,
 *                        PLUS an auto-discovered histogram of every descendant
 *                        tag / think-ish class token (renames still caught).
 *   - snapshots/*.html — FULL-PAGE outerHTML at each phase transition.
 *   - shots/*.png      — FULL-HEIGHT screenshot at each phase transition.
 *   - summary.json     — per-question verdict + shadow replays (base + prior-
 *                        placeholder gate) of the shipping extraction logic.
 * Top level: report.json + REPORT.md aggregate the verdict + aspect coverage.
 *
 * Auth/profile/stealth are reused from the app — no re-login. The MCP server
 * must be STOPPED first (it holds the Chrome profile lock).
 *
 * Run (from repo root):
 *   npx tsx research/issue-74/dom-audit.ts --plan research/issue-74/plan.json --dry-run
 *   npx tsx research/issue-74/dom-audit.ts --plan research/issue-74/plan.json --headless --yes
 *   npx tsx research/issue-74/dom-audit.ts --notebook <url> --question "..." --hl ja
 *
 * Note (tsx): tsx/esbuild compiles page.evaluate() functions with keepNames,
 * injecting `__name(...)` that is undefined in the browser. We shim it per-page
 * (raw string, after render) — see runQuestion. Pure tooling fix, no measurement
 * change.
 */

import type { BrowserContext, Page } from "patchright";
import fs from "fs";
import path from "path";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { SharedContextManager } from "../../src/session/shared-context-manager.js";
import { NotebookLibrary } from "../../src/library/notebook-library.js";
import { CONFIG } from "../../src/config.js";
import { humanType, randomDelay } from "../../src/utils/stealth-utils.js";
import { sanitizeAnswer, isPlaceholder, isThinkingStep } from "../../src/notebooklm/chat.js";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const SAMPLE_MS = 250; // existence-sampler cadence
const SHADOW_INTERVAL_MS = 750; // production poll cadence for the shadow replay
const STABLE_POLLS = 3; // production stablePolls
const MAX_WAIT_MS = Number(process.env.AUDIT_MAX_WAIT_MS ?? 180_000);
const MAX_SNAPSHOTS = 16; // cap phase snapshots per question
const RAW_CAP = 6_000; // chars of answer text shipped per tick (classification only needs the head)

// Candidate nodes to probe by name. We ALSO auto-discover unknown ones via the
// tag/class histogram, so this list is a convenience, not the source of truth.
const CANDIDATES: Record<string, string> = {
  "thinking-chain-view": "thinking-chain-view",
  ".thinking-chain": ".thinking-chain",
  "thinking-animation": "thinking-animation",
  ".thinking-message": ".thinking-message",
  "structural-element": "labs-tailwind-structural-element-view-v2",
  "element-list-renderer": "element-list-renderer",
  "doc-viewer": "labs-tailwind-doc-viewer",
  "citation-marker": "button.citation-marker",
};
// The subset of CANDIDATES that are dedicated reasoning-block elements/selectors.
// Presence-while-generating of ANY of these refutes "there is no dedicated class".
const REASONING_COMPONENT_KEYS = [
  "thinking-chain-view",
  ".thinking-chain",
  "thinking-animation",
  ".thinking-message",
] as const;

const THINK_TOKEN_RE = /think|thought|reason|chain|animat|loading|progress|stream|generat/i;

// `--token-scope` selects WHERE the think-ish class histogram (`thinkTokens`) is
// collected — this materially changes thinkingSeenWhileEnabled / thinkingGoneAtSettle:
//   "body" (LEGACY; opt-in via `--token-scope body`) walks the whole document, which also
//     sweeps in PERSISTENT out-of-turn chrome (mat-form-field-animations-enabled,
//     ng-animate-disabled, emoji-keyboard__loading-message) that THINK_TOKEN_RE matches
//     on `animat`/`loading`. Those never leave the DOM, so `thinkTokens` never empties and
//     the two lifecycle metrics read as false positives (see findings-doc OQ1 caveat).
//   "turn" (DEFAULT) scopes the walk to the current answer turn (`.to-user-container`), so
//     once the reasoning component is removed at settle `thinkTokens` empties and the metrics
//     read correctly (empirically confirmed by the 2026-07-26 A/B run). Named-selector
//     `present[...]` counts are unaffected by this flag.
let TOKEN_SCOPE: "body" | "turn" = "turn";

const DEFAULT_QUESTIONS = [
  "Give me a one-sentence summary of the main topic of these sources.",
  "Provide a detailed, well-structured overview of all the key concepts covered, with citations to the sources.",
  "Create a table of the key entities discussed, with columns Name, Category, and a one-line description.",
  "この資料の要点を3つ、日本語で簡潔にまとめてください。",
  "Podsumuj trzy najważniejsze wnioski z tych źródeł w punktach, po polsku.",
];

const INPUT_SELECTORS = [
  "textarea.query-box-input",
  'textarea[aria-label*="query" i]',
  'textarea[aria-label*="anfrag" i]',
  'textarea[aria-label*="consulta" i]',
  'textarea[aria-label*="domanda" i]',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Probe {
  t: number;
  disabled: boolean | null;
  present: Record<string, number>; // selector -> count
  collapsed: boolean | null;
  answerLen: number;
  answerRaw: string; // capped head
  descendantTags: string[];
  thinkTokens: string[];
}

interface ShadowResult {
  returned: boolean;
  atMs: number | null;
  text: string;
  wasThinking: boolean;
  wasPlaceholderStream: boolean;
}

interface QuestionSummary {
  notebook: string;
  notebookUrl: string;
  question: string;
  locale: string | null;
  settledMs: number | null;
  timedOut: boolean;
  finalAnswerLen: number;
  finalAnswerHead: string;
  // The open-question verdict:
  thinkingEverSeen: boolean;
  thinkingSeenWhileGenerating: boolean;
  thinkingSeenWhileEnabled: boolean; // if true → NOT safe to key purely on "gone == settled"
  thinkingGoneAtSettle: boolean;
  collapsedObserved: boolean;
  observedThinkTags: string[]; // union of think-ish tags/classes discovered
  observedThinkSelectorsPresent: string[]; // which named CANDIDATES ever present
  // v2 — GAP B: a NAMED dedicated reasoning component element present while disabled.
  reasoningComponentSeenWhileGenerating: boolean;
  // v2 — two-phase finding: component GONE but textarea disabled and answer-element
  // text is reasoning prose (the phase "component-absent ⇒ final" would mis-latch).
  reasoningInTextWhileDisabledSeen: boolean;
  // Shadow of the shipping extractor (base) + issue-#74 suggestion #3 variant:
  shadow: ShadowResult;
  finalWasThinking: boolean;
  // v2 — GAP A: issue suggestion #3 ("require a prior placeholder before accepting").
  placeholderEverSeen: boolean;
  priorPlaceholderGate: ShadowResult;
  // v2 — GAP C: form-3 leading reasoning-header line on the SETTLED answer.
  finalFirstLine: string;
  finalHeaderPrefixDetected: boolean;
}

interface PlanEntry {
  name?: string;
  url: string;
  questions?: string[];
  locales?: (string | null)[];
}
type NotebookPlan = { name: string; url: string; questions?: string[]; locales?: (string | null)[] };

// ---------------------------------------------------------------------------
// Arg parsing (repeatable flags)
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]) {
  const out: {
    notebooks: string[];
    questions: string[];
    hls: string[];
    allNotebooks: boolean;
    headless: boolean;
    yes: boolean;
    out: string;
    plan: string;
    dryRun: boolean;
    tokenScope: "body" | "turn";
  } = {
    notebooks: [],
    questions: [],
    hls: [],
    allNotebooks: false,
    headless: false,
    yes: false,
    out: path.resolve(process.cwd(), "dom-audit-runs"),
    plan: "",
    dryRun: false,
    tokenScope: "turn",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--notebook") out.notebooks.push(next());
    else if (a === "--question") out.questions.push(next());
    else if (a === "--hl") out.hls.push(next());
    else if (a === "--all-notebooks") out.allNotebooks = true;
    else if (a === "--headless") out.headless = true;
    else if (a === "--show") out.headless = false;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--out") out.out = path.resolve(next());
    else if (a === "--plan") out.plan = next();
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--token-scope") out.tokenScope = next() === "body" ? "body" : "turn";
    else console.warn(`⚠️  unknown arg ignored: ${a}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// In-page instrumentation (runs in the browser)
// ---------------------------------------------------------------------------
async function installObserver(page: Page): Promise<void> {
  await page.evaluate(
    ({ candidates }) => {
      const w = window as unknown as {
        __audit?: (r: unknown) => void;
        __obs?: MutationObserver;
        __t0?: number;
      };
      if (w.__obs) w.__obs.disconnect();
      w.__t0 = performance.now();
      const now = () => Math.round(performance.now() - (w.__t0 ?? 0));
      const desc = (n: Element) => ({
        tag: n.tagName.toLowerCase(),
        cls: Array.from(n.classList),
        sample: (n.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      });
      const inAnswer = (n: Node | null): boolean => {
        let el = n instanceof Element ? n : n?.parentElement ?? null;
        while (el) {
          if (el.classList?.contains("to-user-container")) return true;
          el = el.parentElement;
        }
        return false;
      };
      const isQueryInput = (n: Node | null): boolean =>
        n instanceof Element && n.matches?.("textarea.query-box-input");

      const obs = new MutationObserver((muts) => {
        const t = now();
        const disabled =
          (document.querySelector("textarea.query-box-input") as HTMLTextAreaElement | null)
            ?.disabled ?? null;
        for (const m of muts) {
          if (m.type === "childList") {
            m.addedNodes.forEach((n) => {
              if (n.nodeType === 1 && inAnswer(n))
                w.__audit?.({ t, disabled, op: "add", ...desc(n as Element) });
            });
            m.removedNodes.forEach((n) => {
              if (n.nodeType === 1 && inAnswer(n))
                w.__audit?.({ t, disabled, op: "del", ...desc(n as Element) });
            });
          } else if (m.type === "attributes") {
            const target = m.target as Element;
            if (m.attributeName === "class" && inAnswer(target))
              w.__audit?.({ t, disabled, op: "class", ...desc(target) });
            else if (m.attributeName === "disabled" && isQueryInput(target))
              w.__audit?.({
                t,
                disabled,
                op: "textarea-disabled",
                tag: "textarea",
                cls: [],
                sample: String(disabled),
              });
          }
        }
      });
      obs.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "disabled"],
      });
      w.__obs = obs;
      // Silence unused-var lint on candidates (kept for future in-page use).
      void candidates;
    },
    { candidates: CANDIDATES }
  );
}

async function probe(page: Page): Promise<Probe> {
  return (await page.evaluate(
    ({ candidates, rawCap, tokenReSrc, tokenScope }) => {
      const tokenRe = new RegExp(tokenReSrc, "i");
      const turns = document.querySelectorAll(".to-user-container");
      const turn = (turns[turns.length - 1] as HTMLElement) ?? null;
      const scope: ParentNode = turn ?? document;
      const t = Math.round(
        performance.now() - ((window as unknown as { __t0?: number }).__t0 ?? 0)
      );
      const disabled =
        (document.querySelector("textarea.query-box-input") as HTMLTextAreaElement | null)
          ?.disabled ?? null;

      // Presence is checked against the WHOLE document, not just the answer turn —
      // the reasoning component (thinking-animation / thinking-chain-view) can live
      // as a sibling OUTSIDE `.to-user-container`, so a turn-scoped query misses it.
      const present: Record<string, number> = {};
      for (const [name, sel] of Object.entries(candidates)) {
        try {
          present[name] = document.querySelectorAll(sel).length;
        } catch {
          present[name] = 0;
        }
      }
      const collapsed = turn ? !!turn.querySelector('[class*="collapsed"]') : null;

      // Latest answer text.
      const mtcs = scope.querySelectorAll(".message-text-content");
      const mtc = (mtcs[mtcs.length - 1] as HTMLElement) ?? turn;
      const full = (mtc?.innerText ?? "").trim();

      // Auto-discovery: every descendant tag + every think-ish class token. Root is
      // chosen by --token-scope: "body" = whole document (catches an out-of-turn
      // reasoning node, but also persistent out-of-turn chrome → false positives on the
      // lifecycle metrics); "turn" = the current answer turn only (no out-of-turn noise).
      const descendantTags = new Set<string>();
      const thinkTokens = new Set<string>();
      const tokenRoot: ParentNode | null = tokenScope === "turn" ? turn : document.body;
      tokenRoot?.querySelectorAll("*").forEach((el) => {
        descendantTags.add(el.tagName.toLowerCase());
        el.classList.forEach((c) => {
          if (tokenRe.test(c)) thinkTokens.add(c);
        });
        if (tokenRe.test(el.tagName)) thinkTokens.add(el.tagName.toLowerCase());
      });

      return {
        t,
        disabled,
        present,
        collapsed,
        answerLen: full.length,
        answerRaw: full.slice(0, rawCap),
        descendantTags: Array.from(descendantTags),
        thinkTokens: Array.from(thinkTokens),
      };
    },
    { candidates: CANDIDATES, rawCap: RAW_CAP, tokenReSrc: THINK_TOKEN_RE.source, tokenScope: TOKEN_SCOPE }
  )) as Probe;
}

// ---------------------------------------------------------------------------
// Shadow replay of the shipping extractor over the sampled sequence.
// Mirrors waitForStableAnswer's accept logic (skip placeholders, N stable polls)
// at the production 750ms cadence, and records the FIRST text it would return.
//
// `requirePriorPlaceholder` implements issue #74 suggestion #3: don't accept a
// stable answer until at least one placeholder-classified state has been seen.
// ---------------------------------------------------------------------------
class Shadow {
  private lastSeen: string | null = null;
  private streak = 0;
  private lastTickMs = -Infinity;
  sawPlaceholder = false; // public: exposes GAP-A "placeholderEverSeen"
  result: ShadowResult = {
    returned: false,
    atMs: null,
    text: "",
    wasThinking: false,
    wasPlaceholderStream: false,
  };

  constructor(private readonly requirePriorPlaceholder = false) {}

  feed(p: Probe): void {
    if (this.result.returned) return;
    if (p.t - this.lastTickMs < SHADOW_INTERVAL_MS - 40) return; // throttle to prod cadence
    this.lastTickMs = p.t;
    const candidate = sanitizeAnswer(p.answerRaw);
    if (!candidate) return;
    if (isPlaceholder(candidate)) {
      this.sawPlaceholder = true;
      this.streak = 0;
      this.lastSeen = null;
      return;
    }
    if (candidate === this.lastSeen) {
      this.streak++;
      const gateOpen = !this.requirePriorPlaceholder || this.sawPlaceholder;
      if (this.streak >= STABLE_POLLS && gateOpen) {
        this.result = {
          returned: true,
          atMs: p.t,
          text: candidate.slice(0, 400),
          wasThinking: isThinkingStep(candidate),
          wasPlaceholderStream: this.sawPlaceholder,
        };
      }
    } else {
      this.lastSeen = candidate;
      this.streak = 1;
    }
  }
}

// A settled answer that begins with a reasoning-header line ("Thoughts\n…",
// gerund-title, or first-person planning opener) followed by real content is the
// "form 3" prefix contamination from issue #74.
function looksLikeReasoningHeader(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^(thoughts?|thinking)\b/i.test(t)) return true;
  return isThinkingStep(t);
}

// ---------------------------------------------------------------------------
// One question against one page
// ---------------------------------------------------------------------------
async function runQuestion(
  page: Page,
  outDir: string,
  meta: { notebook: string; notebookUrl: string; question: string; locale: string | null }
): Promise<QuestionSummary> {
  fs.mkdirSync(path.join(outDir, "snapshots"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  const mutationsFile = path.join(outDir, "mutations.jsonl");
  const timelineFile = path.join(outDir, "timeline.jsonl");
  const mutStream = fs.createWriteStream(mutationsFile);
  const tlStream = fs.createWriteStream(timelineFile);

  // Sink for in-page mutation records.
  await page.exposeFunction("__audit", (rec: unknown) => {
    mutStream.write(JSON.stringify(rec) + "\n");
  });

  // Find the chat input.
  let inputSel: string | null = null;
  for (const s of INPUT_SELECTORS) {
    const el = await page.$(s);
    if (el && (await el.isVisible().catch(() => false))) {
      inputSel = s;
      break;
    }
  }
  if (!inputSel) {
    // Diagnostic: capture what the page actually shows so a headless-render vs
    // login vs modal failure is distinguishable without a re-run.
    try {
      const diag = await page.evaluate(() => {
        const tas = Array.from(document.querySelectorAll("textarea")).map((t) => ({
          cls: t.className,
          aria: t.getAttribute("aria-label"),
          vis: !!(t.offsetWidth || t.offsetHeight || t.getClientRects().length),
        }));
        return {
          url: location.href,
          title: document.title,
          textareas: tas,
          bodyHead: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 500),
        };
      });
      fs.writeFileSync(path.join(outDir, "diag.json"), JSON.stringify(diag, null, 2));
      await page
        .screenshot({ path: path.join(outDir, "diag.png"), fullPage: true })
        .catch(() => undefined);
    } catch {
      /* best-effort */
    }
    throw new Error("chat input not found (login page? modal open?)");
  }

  // tsx/esbuild compiles the functions we pass to page.evaluate() with keepNames,
  // injecting `__name(...)` calls that are undefined in the browser world
  // (→ "ReferenceError: __name is not defined"). Define the helper as a no-op in
  // this page's main world. Done here — AFTER the app has rendered and as a raw
  // string (tsx never rewrites it) — so it can't perturb the SPA's bootstrap the
  // way a pre-load init script does. Pure tooling fix; no measurement change.
  await page.evaluate("void (window.__name = window.__name || function (t) { return t; })");

  await installObserver(page);

  // Submit.
  await humanType(page, inputSel, meta.question, { withTypos: false, wpm: 240 });
  await randomDelay(400, 800);
  await page.keyboard.press("Enter");
  const startedAt = Date.now();

  // Sample loop == settle wait.
  const shadow = new Shadow(); // shipping extractor as-is
  const priorGate = new Shadow(true); // issue suggestion #3: require prior placeholder
  let lastSig = "";
  let snaps = 0;
  let enabledStreak = 0;
  let stableHeadStreak = 0;
  let lastHead = "";
  let sawGenerating = false;
  let settledMs: number | null = null;
  let timedOut = false;

  const thinkTagUnion = new Set<string>();
  const thinkSelUnion = new Set<string>();
  let thinkingEverSeen = false;
  let thinkingWhileGenerating = false;
  let thinkingWhileEnabled = false;
  let collapsedObserved = false;
  let componentWhileGenerating = false; // GAP B
  let reasoningInTextWhileDisabled = false; // two-phase finding
  let last: Probe | null = null;

  const capturePhase = async (p: Probe, reason: string) => {
    if (snaps >= MAX_SNAPSHOTS) return;
    const idx = String(snaps).padStart(2, "0");
    try {
      // FULL-PAGE HTML — the reasoning node can live OUTSIDE `.to-user-container`,
      // so a turn-scoped outerHTML misses it. page.content() serialises the whole
      // document, so the thinking component is always captured for later review.
      const fullHtml = await page.content().catch(() => "");
      if (fullHtml)
        fs.writeFileSync(path.join(outDir, "snapshots", `${idx}-${reason}.html`), fullHtml);
      // FULL-HEIGHT screenshot of the entire page (not just the answer box).
      await page
        .screenshot({
          path: path.join(outDir, "shots", `${idx}-${reason}.png`),
          fullPage: true,
          timeout: 8000,
        })
        .catch(() => undefined);
    } catch {
      /* best-effort */
    }
    snaps++;
    void p;
  };

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const p = await probe(page).catch(() => null);
    if (!p) {
      await sleep(SAMPLE_MS);
      continue;
    }
    last = p;
    tlStream.write(JSON.stringify(p) + "\n");
    shadow.feed(p);
    priorGate.feed(p);

    const thinkPresent =
      (p.present["thinking-chain-view"] ?? 0) > 0 ||
      (p.present[".thinking-chain"] ?? 0) > 0 ||
      (p.present["thinking-animation"] ?? 0) > 0 ||
      (p.present[".thinking-message"] ?? 0) > 0 ||
      p.thinkTokens.length > 0;
    // GAP B: strictly a NAMED dedicated component element/selector (no fuzzy tokens).
    const componentPresent = REASONING_COMPONENT_KEYS.some((k) => (p.present[k] ?? 0) > 0);

    p.thinkTokens.forEach((t) => thinkTagUnion.add(t));
    for (const k of REASONING_COMPONENT_KEYS)
      if ((p.present[k] ?? 0) > 0) thinkSelUnion.add(k);

    if (p.disabled) sawGenerating = true;
    if (thinkPresent) {
      thinkingEverSeen = true;
      if (p.disabled) thinkingWhileGenerating = true;
      if (p.disabled === false) thinkingWhileEnabled = true;
    }
    if (componentPresent && p.disabled) componentWhileGenerating = true;
    if (p.collapsed) collapsedObserved = true;

    // Two-phase finding: component GONE but still generating and the answer element
    // already holds reasoning prose → "component-absent ⇒ final" would mis-latch.
    if (!thinkPresent && p.disabled === true) {
      const c = sanitizeAnswer(p.answerRaw);
      if (c && !isPlaceholder(c) && isThinkingStep(c)) reasoningInTextWhileDisabled = true;
    }

    // Phase snapshot on signature change.
    const sig = `${p.disabled}|${p.collapsed}|${thinkPresent}|${p.answerLen > 0}`;
    if (sig !== lastSig) {
      lastSig = sig;
      await capturePhase(p, sanitizeReason(sig));
    }

    // Settle detection.
    const head = p.answerRaw.slice(0, 120);
    if (head && head === lastHead) stableHeadStreak++;
    else stableHeadStreak = 0;
    lastHead = head;
    enabledStreak = p.disabled === false ? enabledStreak + 1 : 0;

    if (sawGenerating && enabledStreak >= 3 && stableHeadStreak >= 4 && p.answerLen > 0) {
      settledMs = p.t;
      await capturePhase(p, "settled");
      break;
    }
    await sleep(SAMPLE_MS);
  }
  if (settledMs === null) timedOut = true;

  mutStream.end();
  tlStream.end();

  const finalRaw = last?.answerRaw ?? "";
  const finalClean = sanitizeAnswer(finalRaw);
  const finalLines = finalClean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const finalFirstLine = finalLines[0] ?? "";
  const finalHeaderPrefixDetected = finalLines.length > 1 && looksLikeReasoningHeader(finalFirstLine);

  const summary: QuestionSummary = {
    ...meta,
    settledMs,
    timedOut,
    finalAnswerLen: last?.answerLen ?? 0,
    finalAnswerHead: finalClean.slice(0, 200),
    thinkingEverSeen,
    thinkingSeenWhileGenerating: thinkingWhileGenerating,
    thinkingSeenWhileEnabled: thinkingWhileEnabled,
    thinkingGoneAtSettle: last ? !someThinkPresent(last) : false,
    collapsedObserved,
    observedThinkTags: Array.from(thinkTagUnion).sort(),
    observedThinkSelectorsPresent: Array.from(thinkSelUnion).sort(),
    reasoningComponentSeenWhileGenerating: componentWhileGenerating,
    reasoningInTextWhileDisabledSeen: reasoningInTextWhileDisabled,
    shadow: shadow.result,
    finalWasThinking: isThinkingStep(finalClean),
    placeholderEverSeen: shadow.sawPlaceholder,
    priorPlaceholderGate: priorGate.result,
    finalFirstLine,
    finalHeaderPrefixDetected,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

function someThinkPresent(p: Probe): boolean {
  return (
    (p.present["thinking-chain-view"] ?? 0) > 0 ||
    (p.present[".thinking-chain"] ?? 0) > 0 ||
    (p.present["thinking-animation"] ?? 0) > 0 ||
    (p.present[".thinking-message"] ?? 0) > 0 ||
    p.thinkTokens.length > 0
  );
}

function sanitizeReason(sig: string): string {
  return sig.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 40) || "phase";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Aggregate report
// ---------------------------------------------------------------------------
function writeReport(outRoot: string, all: QuestionSummary[]): void {
  fs.writeFileSync(path.join(outRoot, "report.json"), JSON.stringify(all, null, 2));

  const n = all.length;
  const cnt = (f: (s: QuestionSummary) => boolean) => all.filter(f).length;
  const everSeen = cnt((s) => s.thinkingEverSeen);
  const whileGen = cnt((s) => s.thinkingSeenWhileGenerating);
  const whileEnabled = cnt((s) => s.thinkingSeenWhileEnabled);
  const goneAtSettle = cnt((s) => s.thinkingGoneAtSettle);
  const collapsed = cnt((s) => s.collapsedObserved);
  const shadowThinking = cnt((s) => s.shadow.returned && s.shadow.wasThinking);
  const finalContaminated = cnt((s) => s.finalWasThinking);
  // v2 aspect-coverage metrics.
  const componentWhileGen = cnt((s) => s.reasoningComponentSeenWhileGenerating); // GAP B
  const phase2 = cnt((s) => s.reasoningInTextWhileDisabledSeen); // two-phase
  const placeholderSeen = cnt((s) => s.placeholderEverSeen); // GAP A
  const priorGateThinking = cnt((s) => s.priorPlaceholderGate.returned && s.priorPlaceholderGate.wasThinking); // GAP A
  const priorGateNoReturn = cnt((s) => !s.priorPlaceholderGate.returned); // GAP A
  const form3Any = cnt((s) => s.finalHeaderPrefixDetected); // GAP C
  const form3Settled = cnt((s) => s.finalHeaderPrefixDetected && !s.timedOut); // GAP C (settled only)
  const settledRows = cnt((s) => !s.timedOut);
  const tagUnion = new Set<string>();
  all.forEach((s) => s.observedThinkTags.forEach((t) => tagUnion.add(t)));

  const pct = (x: number, d = n) => `${x}/${d}` + (d ? ` (${Math.round((100 * x) / d)}%)` : "");
  const structuralViable =
    everSeen === n && whileGen === n && whileEnabled === 0 && goneAtSettle === n;

  const rows = all
    .map((s) => {
      const loc = s.locale ? `?hl=${s.locale}` : "-";
      const verdict = s.shadow.returned
        ? s.shadow.wasThinking
          ? "🐞 returned THINKING"
          : "✅ returned answer"
        : "⏳ no-return";
      return `| ${trunc(s.notebook, 14)} | ${trunc(s.question, 34)} | ${loc} | ${s.thinkingSeenWhileEnabled ? "⚠️y" : "n"} | ${s.thinkingGoneAtSettle ? "y" : "n"} | ${s.reasoningInTextWhileDisabledSeen ? "y" : "n"} | ${s.finalHeaderPrefixDetected ? "⚠️y" : "n"} | ${verdict} | ${s.priorPlaceholderGate.returned ? (s.priorPlaceholderGate.wasThinking ? "🐞think" : "answer") : "no-ret"} |`;
    })
    .join("\n");

  const md = `# NotebookLM DOM audit — issue #74 (v2)

Runs: **${n}**  ·  generated ${new Date().toISOString()}  ·  token-scope: **${TOKEN_SCOPE}**${TOKEN_SCOPE === "body" ? " (whole-document walk — lifecycle metrics below are unreliable; see OQ1 caveat)" : " (answer-turn walk — lifecycle metrics read correctly)"}

## Verdict: is a structural skip viable as the PRIMARY fix?

**${structuralViable ? "✅ YES (on the measured builds/locales)" : "⚠️ NOT unconditionally — see caveats"}**

A structural skip is safe as primary only if the reasoning node **always** appears while
generating **and never** while the textarea is enabled, and is **gone by settle**.

| Signal | Result |
|---|---|
| Reasoning node ever seen | ${pct(everSeen)} |
| Seen while generating (textarea disabled) | ${pct(whileGen)} |
| Seen while ENABLED (would break "gone==settled") | ${pct(whileEnabled)} ${whileEnabled ? "⚠️" : ""} |
| Gone at settle | ${pct(goneAtSettle)} |
| Collapsed reasoning form observed | ${pct(collapsed)} |

## Does the bug reproduce / does the shipping extractor mis-latch?

| Signal | Result |
|---|---|
| Shadow extractor returned THINKING text (the #74 bug) | ${pct(shadowThinking)} |
| Final captured text still classified as thinking (contamination) | ${pct(finalContaminated)} |

> The shadow replays \`sanitizeAnswer\`+\`isPlaceholder\`+\`isThinkingStep\` (current branch)
> at the production 750ms/3-poll cadence, so "returned THINKING" = the code on THIS
> branch would still hand back reasoning text for that question.

## Issue-#74 aspect coverage (data-backed)

| Aspect (issue/PR) | Metric | Result |
|---|---|---|
| **GAP B** — PR #75 claims "no dedicated CSS class" | Named reasoning component element present WHILE generating | **${pct(componentWhileGen)}** ${componentWhileGen ? "→ premise refuted" : ""} |
| **Two-phase** — component vanishes before settle | Reasoning prose in the answer element while textarea still \`disabled\` (component gone) | ${pct(phase2)} |
| **GAP C** — form-3 leading-header prefix | Settled answer carried a reasoning-header first line | ${pct(form3Settled, settledRows)} of settled (${pct(form3Any)} of all) |
| **GAP A** — issue suggestion #3 (require prior placeholder) | Placeholder state ever seen this turn | ${pct(placeholderSeen)} |
| **GAP A** — would the prior-placeholder gate still mis-fire? | Prior-placeholder-gated shadow returned THINKING | ${pct(priorGateThinking)} |
| **GAP A** — prior-placeholder gate did not return | (no-return within sampled window) | ${pct(priorGateNoReturn)} |

> **Reading GAP A:** the prior-placeholder gate (issue suggestion #3) only helps if
> "returned THINKING" is lower than the base shadow's ${pct(shadowThinking)}. If both are
> 0, suggestion #3 neither hurts nor is needed on these builds; if the base shadow ever
> returns thinking while the gated one does not, suggestion #3 is a cheap mitigation.

## Auto-discovered reasoning tags/classes (not hard-coded)

\`\`\`
${Array.from(tagUnion).sort().join("\n") || "(none observed)"}
\`\`\`

## Per-question

| notebook | question | hl | seen enabled | gone@settle | reason-in-text (phase2) | form3 prefix | shadow | prior-gate |
|---|---|---|---|---|---|---|---|---|
${rows}

## How to read this
- **seen enabled = ⚠️y** anywhere ⇒ the node lingers after generation; a pure
  "node absent ⇒ answer is final" rule is unsafe → keep the text heuristic and/or add a
  generation-gate on the disabled textarea.
- **reason-in-text (phase2) = y** ⇒ the reasoning kept streaming into the answer element
  AFTER the component vanished while still generating → a component-only skip must be
  paired with the disabled-textarea gate.
- **form3 prefix = ⚠️y** ⇒ the settled answer began with a reasoning-header line.
- **shadow = 🐞** rows are live reproductions of #74 on this branch.
- Inspect \`snapshots/*.html\` (full page) for the exact DOM at each phase; \`shots/*.png\`
  (full height) for the visual; \`timeline.jsonl\` for the existence-vs-disabled trace;
  \`mutations.jsonl\` for exact appear/vanish moments.
`;
  fs.writeFileSync(path.join(outRoot, "REPORT.md"), md);
}

function trunc(s: string, n: number): string {
  s = s.replace(/\n/g, " ");
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  TOKEN_SCOPE = args.tokenScope;
  const lib = new NotebookLibrary();

  // Resolve notebooks (plan file > --notebook > library). A plan entry may carry
  // its own per-notebook questions/locales; otherwise the globals apply.
  const globalQuestions = args.questions.length ? args.questions : DEFAULT_QUESTIONS;
  const globalLocales: (string | null)[] = args.hls.length ? args.hls : [null];

  let notebooks: NotebookPlan[] = [];
  if (args.plan) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.plan), "utf-8"));
    const entries: PlanEntry[] = Array.isArray(raw) ? raw : raw.notebooks ?? [];
    notebooks = entries.map((e, i) => ({
      name: e.name ?? `plan-${i + 1}`,
      url: e.url,
      questions: e.questions,
      locales: e.locales,
    }));
  } else if (args.notebooks.length) {
    notebooks = args.notebooks.map((url, i) => ({ name: `cli-${i + 1}`, url }));
  } else {
    const entries = lib.listNotebooks();
    if (args.allNotebooks) notebooks = entries.map((e) => ({ name: e.name, url: e.url }));
    else {
      const active = lib.getActiveNotebook() ?? entries[0];
      if (active) notebooks = [{ name: active.name, url: active.url }];
    }
  }
  if (!notebooks.length) {
    console.error(
      "❌ No notebook to audit. Pass --plan <file>, --notebook <url>, or add notebooks to the library."
    );
    process.exit(1);
  }

  // Flatten into an explicit job list so the call budget and per-notebook
  // questions are visible up front.
  const jobs: { name: string; url: string; question: string; locale: string | null }[] = [];
  for (const nb of notebooks) {
    const qs = nb.questions?.length ? nb.questions : globalQuestions;
    const locs = nb.locales?.length ? nb.locales : globalLocales;
    for (const loc of locs)
      for (const q of qs) jobs.push({ name: nb.name, url: nb.url, question: q, locale: loc });
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outRoot = path.join(args.out, runId);

  const plan = jobs.length;
  console.log(`\n🔬 NotebookLM DOM audit (v2)`);
  console.log(`   notebooks: ${notebooks.length}   TOTAL NotebookLM calls: ${plan}  (free tier = 50/day)`);
  for (const nb of notebooks) {
    const qs = nb.questions?.length ? nb.questions : globalQuestions;
    const locs = nb.locales?.length ? nb.locales : globalLocales;
    console.log(`     • ${nb.name}: ${qs.length} q × ${locs.length} locale(s) = ${qs.length * locs.length}`);
  }
  console.log(
    `   headless: ${args.headless}   token-scope: ${args.tokenScope}${args.tokenScope === "body" ? " (legacy/buggy)" : " (default/fixed)"}   output: ${outRoot}\n`
  );
  if (args.dryRun) {
    console.log("   ✅ dry run — plan validated, no browser launched, no calls made.\n");
    return;
  }
  if (!args.yes) {
    console.log("   Ctrl-C within 5s to abort…");
    await sleep(5000);
  }
  fs.mkdirSync(outRoot, { recursive: true });

  const auth = new AuthManager();
  const scm = new SharedContextManager(auth);
  let context: BrowserContext;
  try {
    context = await scm.getOrCreateContext(!args.headless);
  } catch (e) {
    console.error(`❌ Could not launch browser context: ${e}`);
    console.error("   Is the MCP server running? Stop it first (it locks the Chrome profile).");
    process.exit(1);
  }

  if (!(await auth.validateCookiesExpiry(context))) {
    console.error(
      "❌ Not authenticated in this Chrome profile. Log in once via the MCP (setup_auth) and ensure the server is stopped, then re-run."
    );
    await scm.closeContext();
    process.exit(1);
  }

  const all: QuestionSummary[] = [];
  let idx = 0;
  for (const job of jobs) {
    idx++;
    const url = job.locale ? appendHl(job.url, job.locale) : job.url;
    const label = `${slug(job.name)}__${job.locale ?? "def"}__q${String(idx).padStart(2, "0")}`;
    const qDir = path.join(outRoot, label);
    console.log(
      `\n[${idx}/${plan}] ${job.name} ${job.locale ? `(hl=${job.locale})` : ""}\n   Q: ${trunc(job.question, 80)}`
    );
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.browserTimeout });
      await randomDelay(2500, 3500);
      const s = await runQuestion(page, qDir, {
        notebook: job.name,
        notebookUrl: job.url,
        question: job.question,
        locale: job.locale,
      });
      all.push(s);
      const flag = s.shadow.returned
        ? s.shadow.wasThinking
          ? "🐞 shadow returned THINKING"
          : "✅ shadow returned answer"
        : "⏳ shadow no-return";
      console.log(
        `   → settled=${s.settledMs ?? "TIMEOUT"}ms  thinkSeen=${s.thinkingEverSeen}  goneAtSettle=${s.thinkingGoneAtSettle}  compWhileGen=${s.reasoningComponentSeenWhileGenerating}  phase2=${s.reasoningInTextWhileDisabledSeen}  form3=${s.finalHeaderPrefixDetected}  ${flag}`
      );
    } catch (e) {
      console.error(`   ⚠️  question failed: ${e}`);
      fs.mkdirSync(qDir, { recursive: true });
      fs.writeFileSync(path.join(qDir, "error.txt"), String(e instanceof Error ? e.stack : e));
    } finally {
      await page.close().catch(() => undefined);
      await randomDelay(1500, 2500); // gentle pacing between calls
    }
  }

  writeReport(outRoot, all);
  await scm.closeContext();
  console.log(`\n✅ Done. Report: ${path.join(outRoot, "REPORT.md")}\n`);
}

function appendHl(url: string, hl: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("hl", hl);
    return u.toString();
  } catch {
    return url;
  }
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "nb";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
