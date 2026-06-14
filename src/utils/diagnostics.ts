/**
 * Opt-in diagnostic instrumentation for ask_question.
 *
 * Enabled when NOTEBOOKLM_DIAGNOSTIC=true. Captures per-call evidence of
 * whether NotebookLM UI produces an answer in the DOM, plus 1Hz trace for
 * the first 15s of the wait. Pure observability — does NOT change the
 * production wait/poll/selector logic in chat.ts or selectors.ts.
 *
 * Captured artifacts (all under artifacts/notebooklm-debug/{ts}-{sessionId}/):
 *   - screenshot-0.png / -1.png / -2.png   (T+0 / T+5s / T+15s)
 *   - to-user-html-{0,1,2}.txt             (last 3 .to-user-container outerHTML)
 *   - to-user-text-{0,1,2}.txt             (last 3 .to-user-container innerText)
 *   - candidates.json                      (3-selector matrix @ each timestamp)
 *   - poll-trace.jsonl                     (15 lines, one per second)
 */

import type { Page } from "patchright";
import { promises as fs } from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

/** Candidate answer selectors evaluated for diagnostic purposes only. */
const CANDIDATE_SELECTORS: ReadonlyArray<{ name: string; selector: string }> = [
  {
    name: "A_primary",
    selector: ".to-user-container .message-text-content",
  },
  {
    name: "B_fallback_conversation_turn",
    selector: 'conversation-turn:not([data-author="user"]) .message-content',
  },
  {
    name: "C_fallback_data_attr",
    selector: "[data-response-id], [data-author='assistant'] .message-text",
  },
];

/** Total trace duration in seconds. 15s × 1Hz = 15 ticks. */
const TRACE_DURATION_S = 15;

/** Delay between Enter press and first snapshot. */
const INITIAL_DELAY_MS = 200;

interface SelectorEval {
  match_count: number;
  texts: string[];
}

interface SnapshotRecord {
  t_seconds: number;
  page_url: string;
  chrome_error: boolean;
  selectors: Record<string, SelectorEval>;
}

interface PollTick {
  t: number;
  to_user_count: number;
  selectors: Record<
    string,
    { len: number; placeholder: boolean; preview: string }
  >;
}

function previewText(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : normalized.slice(0, max) + "…";
}

function isChromeErrorPage(url: string): boolean {
  return /^chrome-error:\/\//i.test(url);
}

async function snapshotAt(
  page: Page,
  artifactDir: string,
  idx: number,
  tSeconds: number
): Promise<SnapshotRecord> {
  const pageUrl = page.url();
  const chromeError = isChromeErrorPage(pageUrl);

  await page.screenshot({
    path: path.join(artifactDir, `screenshot-${idx}.png`),
    fullPage: true,
  });

  const htmlSnippets = await page
    .locator(".to-user-container")
    .evaluateAll((els) =>
      els.slice(-3).map((e) => (e as HTMLElement).outerHTML)
    )
    .catch(() => [] as string[]);
  await fs.writeFile(
    path.join(artifactDir, `to-user-html-${idx}.txt`),
    htmlSnippets.join("\n\n---\n\n")
  );

  const textSnippets = await page
    .locator(".to-user-container")
    .allInnerTexts()
    .catch(() => [] as string[]);
  await fs.writeFile(
    path.join(artifactDir, `to-user-text-${idx}.txt`),
    textSnippets.join("\n---\n")
  );

  const selectors: Record<string, SelectorEval> = {};
  for (const c of CANDIDATE_SELECTORS) {
    const texts = await page
      .locator(c.selector)
      .allInnerTexts()
      .catch(() => [] as string[]);
    selectors[c.name] = { match_count: texts.length, texts };
  }

  return {
    t_seconds: tSeconds,
    page_url: pageUrl,
    chrome_error: chromeError,
    selectors,
  };
}

async function runPollTrace(
  page: Page,
  artifactDir: string
): Promise<void> {
  const tracePath = path.join(artifactDir, "poll-trace.jsonl");
  const stream = await fs.open(tracePath, "w");
  try {
    for (let t = 0; t < TRACE_DURATION_S; t++) {
      const tick: PollTick = {
        t,
        to_user_count: await page
          .locator(".to-user-container")
          .count()
          .catch(() => 0),
        selectors: {},
      };
      for (const c of CANDIDATE_SELECTORS) {
        const texts = await page
          .locator(c.selector)
          .allInnerTexts()
          .catch(() => [] as string[]);
        const last = texts[texts.length - 1] ?? "";
        tick.selectors[c.name] = {
          len: last.length,
          placeholder: /thinking|loading|please wait|generating|검색|분석|로딩/i.test(
            last
          ),
          preview: previewText(last),
        };
      }
      await stream.write(JSON.stringify(tick) + "\n");
      if (t < TRACE_DURATION_S - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } finally {
    await stream.close();
  }
}

export async function runAskDiagnostics(
  page: Page,
  sessionId: string,
  question: string
): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactDir = path.join(
    process.cwd(),
    "artifacts",
    "notebooklm-debug",
    `${ts}-${sessionId}`
  );

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    log.info(
      `🔬 [DIAG] ask_question diagnostics enabled — artifacts at ${artifactDir}`
    );

    await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));

    const snapshots: SnapshotRecord[] = [];
    snapshots.push(await snapshotAt(page, artifactDir, 0, 0));

    const tracePromise = runPollTrace(page, artifactDir);

    await new Promise((r) => setTimeout(r, 5000));
    snapshots.push(await snapshotAt(page, artifactDir, 1, 5));

    await tracePromise;

    snapshots.push(await snapshotAt(page, artifactDir, 2, 15));

    const candidates = {
      session_id: sessionId,
      question_preview: previewText(question, 200),
      snapshots,
    };
    await fs.writeFile(
      path.join(artifactDir, "candidates.json"),
      JSON.stringify(candidates, null, 2)
    );

    log.success(`🔬 [DIAG] artifacts written (${snapshots.length} snapshots)`);
  } catch (err) {
    log.warning(
      `🔬 [DIAG] diagnostic capture failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
