import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "patchright";
import { waitForStableAnswer } from "../src/notebooklm/chat.js";
import { Selectors } from "../src/notebooklm/selectors.js";

function createMockPage(answers: string[]): Page {
  return {
    isClosed: () => false,
    evaluate: async () => true,
    waitForTimeout: async () => undefined,
    locator: (selector: string) => {
      if (selector === Selectors.chat.answerText) {
        return {
          count: async () => answers.length,
          allInnerTexts: async () => answers,
          nth: (index: number) => ({
            innerText: async () => answers[index] ?? "",
          }),
        };
      }

      if (selector === Selectors.chat.latestAnswerText) {
        return {
          last: () => ({
            innerText: async () => answers[answers.length - 1] ?? "",
          }),
        };
      }

      throw new Error(`Unexpected selector: ${selector}`);
    },
  } as unknown as Page;
}

test("returns a repeated answer when it appears in a new answer element", async () => {
  const answer = await waitForStableAnswer(createMockPage(["pineapple", "pineapple"]), {
    ignoreTexts: ["pineapple"],
    priorAnswerCount: 1,
    pollIntervalMs: 1,
    timeoutMs: 50,
    stablePolls: 1,
  });

  assert.equal(answer, "pineapple");
});

test("continues to ignore prior text when no new answer element exists", async () => {
  const answer = await waitForStableAnswer(createMockPage(["pineapple"]), {
    ignoreTexts: ["pineapple"],
    priorAnswerCount: 1,
    pollIntervalMs: 1,
    timeoutMs: 10,
    stablePolls: 1,
  });

  assert.equal(answer, null);
});
