/**
 * Unit tests for `waitForStableAnswer` in src/notebooklm/chat.ts.
 *
 * Regression net for the ignoreSet BUGFIX (commit 2f6ccdcb). The bug
 * misclassified a new answer as "prior" when its text matched any prior
 * response — fixed by dropping the text-based filter and relying on DOM
 * position (the last `.to-user-container` element) as the identity.
 *
 * These tests mock patchright's Page API to drive `waitForStableAnswer`
 * deterministically. We do NOT mock the page's "real" browser — the goal
 * is to assert the polling/stability logic, not the DOM extraction.
 */

import { describe, it, expect, vi } from "vitest";
import type { Page } from "patchright";

// Stub the watchdog so tests don't actually sleep / health-check.
vi.mock("../../src/browser/watchdog.js", () => ({
  isRecoverable: () => false,
  pageIsAlive: async () => true,
  safeSleep: async () => {
    // Real implementation awaits a small interval; stub returns immediately.
  },
}));

// Import AFTER the mock is registered.
import { waitForStableAnswer } from "../../src/notebooklm/chat.js";

/**
 * Build a minimal Page mock that returns `answers[0]` (the "last/newest"
 * element) on `.last().innerText()` and the full list on `.allInnerTexts()`.
 * Patchright's `Page.locator` returns a Locator that chains; the chat module
 * uses both `last().innerText()` and `allInnerTexts()`.
 */
function makeMockPage(answers: string[]) {
  return {
    locator: () => ({
      last: () => ({
        innerText: async () => answers[0] ?? "",
      }),
      allInnerTexts: async () => answers,
      count: async () => answers.length,
    }),
  } as unknown as Page;
}

describe("waitForStableAnswer", () => {
  it("returns the new answer even when its text matches a prior", async () => {
    // 6 prior `{"ok": true}` answers + 1 new `{"ok": true}` = 7 total.
    // Pre-fix this filtered the new answer as "prior" and timed out.
    const answers = [
      '{"ok": true}', // newest — the answer we just received
      '{"ok": true}',
      '{"ok": true}',
      '{"ok": true}',
      '{"ok": true}',
      '{"ok": true}',
      '{"ok": true}',
    ];
    const page = makeMockPage(answers);
    const result = await waitForStableAnswer(page, {
      question: 'Return JSON only: {"ok": true}',
      timeoutMs: 2_000,
      pollIntervalMs: 5,
      stablePolls: 3,
    });
    expect(result).toBe('{"ok": true}');
  });

  it("returns the new answer when its text is different from any prior", async () => {
    const answers = [
      "Here is a fresh answer.",
      "Earlier answer A",
      "Earlier answer B",
    ];
    const page = makeMockPage(answers);
    const result = await waitForStableAnswer(page, {
      question: "Tell me something new",
      timeoutMs: 2_000,
      pollIntervalMs: 5,
      stablePolls: 3,
    });
    expect(result).toBe("Here is a fresh answer.");
  });

  it("skips the question echo (same text as the question itself)", async () => {
    // The question echoed back into the answer container should be ignored.
    // `waitForStableAnswer` will wait for a different text to appear stable.
    const answers = [
      "A real answer eventually.",
      "What is the meaning of life?", // echo of the question
    ];
    const page = makeMockPage(answers);
    const result = await waitForStableAnswer(page, {
      question: "What is the meaning of life?",
      timeoutMs: 2_000,
      pollIntervalMs: 5,
      stablePolls: 3,
    });
    expect(result).toBe("A real answer eventually.");
  });

  it("returns null on timeout when the text never stabilises", async () => {
    // Simulate a continuously changing text by varying answers[0] on every
    // poll. With stablePolls=3 the function will never see 3 identical
    // consecutive polls and will time out.
    let pollCount = 0;
    const page = {
      locator: () => ({
        last: () => ({
          innerText: async () => `loading ${++pollCount}`,
        }),
        allInnerTexts: async () => [`loading ${pollCount}`],
        count: async () => 1,
      }),
    } as unknown as Page;
    const result = await waitForStableAnswer(page, {
      question: "Will this ever stabilise?",
      timeoutMs: 200,
      pollIntervalMs: 5,
      stablePolls: 3,
    });
    expect(result).toBeNull();
  });
});
