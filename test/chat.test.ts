/**
 * Regression tests for issue #74 — `waitForStableAnswer()` latching onto
 * Gemini 2.5's extended-thinking summary instead of the final answer.
 *
 * The positive fixtures are verbatim thinking summaries captured from live
 * `ask_question` calls; the negatives are real grounded answers (including a
 * deliberately adversarial one whose first line is a gerund heading, and one
 * that contains "will" in third person).
 *
 * Run: `npm test`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isThinkingStep, isPlaceholder } from "../src/notebooklm/chat.js";

const THINKING_SUMMARIES = [
  "Clarifying Initial Requests\nI'm currently focused on structuring a concise explanation of the \"automated feedback loop with AI agents\" concept, geared towards a novice audience. I'm prioritizing clarity and brevity. My immediate task is to outline the three key elements users are looking for: the process itself, the benefits derived, and the potential challenges encountered. I'll provide an initial draft after completing these steps.",
  "Refining the Focus\nI'm now zeroing in on the common thread: the transition from manual prompting to constructing automated feedback loops with AI agents [1, 2]. My current aim is to express this in Japanese, keeping it concise and source-supported. I will adhere to the constraints precisely.",
  "Refining the Approach\nI'm now focused on understanding the user's feedback. They've pointed out the previous response wasn't a finished thought process, but rather an incomplete one. I'm actively reviewing instructions to solidify this understanding.",
  "Defining the Summary Scope\nMy next task is to distil the sources into a two-sentence summary. I'm now zeroing in on the key themes.",
];

const REAL_ANSWERS = [
  // The actual Japanese answer that should have been returned.
  "「ループエンジニアリングにおけるループの基本動作については、システムを設計する上での「5つの基本動作（Five Moves）」と、AIエージェントが実際に処理を進める「5つのサイクル」の2つの観点から説明できます。",
  // Grounded, third-person English answer.
  "The automated feedback loop consists of three stages: the agent proposes an action, the environment returns an observation, and the result is scored against the goal [1]. Unlike manual prompting, no human intervention is required between iterations [2].",
  // Adversarial: first line IS a gerund heading, but the body is third-person.
  "Understanding the Five Moves\nThe framework defines five core moves that a system designer applies when composing an automated loop. Each move maps to a distinct responsibility.",
  // Contains "will" in third person — must not be mistaken for planning prose.
  "The document explains that the system will retry failed steps automatically. It will also log each attempt for later review.",
  // Short factual answer.
  "Yes. The sources confirm that automated loops reduce manual prompting overhead [1].",
];

test("isThinkingStep flags Gemini extended-thinking summaries (#74)", () => {
  for (const sample of THINKING_SUMMARIES) {
    assert.ok(isThinkingStep(sample), `should flag as thinking: ${sample.slice(0, 48)}…`);
  }
});

test("isThinkingStep does not misfire on grounded answers", () => {
  for (const answer of REAL_ANSWERS) {
    assert.ok(!isThinkingStep(answer), `should NOT flag as thinking: ${answer.slice(0, 48)}…`);
  }
});

test("isPlaceholder treats thinking summaries as non-final answers (#74)", () => {
  for (const sample of THINKING_SUMMARIES) {
    assert.ok(isPlaceholder(sample), "thinking summary must read as placeholder");
  }
});

test("isPlaceholder still accepts real answers as final", () => {
  for (const answer of REAL_ANSWERS) {
    assert.ok(!isPlaceholder(answer), "real answer must not read as placeholder");
  }
});
