import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAnswer } from "./chat.js";
import { Selectors } from "./selectors.js";

test("targets the current NotebookLM document viewer for assistant prose", () => {
  assert.equal(
    Selectors.chat.answerText,
    ".to-user-container .message-text-content labs-tailwind-doc-viewer"
  );
  assert.equal(Selectors.chat.latestAnswerText, Selectors.chat.answerText);
});

test("removes the current UI thinking label without changing answer prose", () => {
  assert.equal(
    sanitizeAnswer("Thoughts\nI am an intelligent memory assistant."),
    "I am an intelligent memory assistant."
  );
});
