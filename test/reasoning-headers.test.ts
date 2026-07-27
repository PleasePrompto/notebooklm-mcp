/**
 * Issue #74 — the `NOTEBOOKLM_REASONING_HEADERS` escape-hatch.
 *
 * `REASONING_HEADERS` ships EMPTY: the icon-anchored strip in `sanitizeAnswer()`
 * removes a leaked collapsed reasoning header without knowing any header word.
 * This env var is the last-resort hook for a build that leaks a *bare* header
 * with no adjacent toggle icon — matched as a whole line, never as a substring.
 *
 * The set is built once at module load, so the env var is set here BEFORE the
 * dynamic import (a static import would be hoisted above it). `node --test`
 * runs every test file in its own process, so this cannot leak into the others.
 *
 * Run: `npm test`
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NOTEBOOKLM_REASONING_HEADERS = "Thoughts, 思考プロセス ,Myśli";

const { isPlaceholder } = await import("../src/notebooklm/chat.js");

test("configured reasoning headers read as placeholders, in any locale (#74)", () => {
  for (const header of ["Thoughts", "思考プロセス", "Myśli"]) {
    assert.ok(isPlaceholder(header), `configured header must not settle: ${header}`);
  }
});

test("configured headers match case-insensitively and ignore surrounding space (#74)", () => {
  assert.ok(isPlaceholder("thoughts"));
  assert.ok(isPlaceholder("THOUGHTS"));
  assert.ok(isPlaceholder("  Thoughts \n"));
});

test("configured headers never match mid-sentence in a real answer (#74)", () => {
  const answers = [
    "The author collects their thoughts before each iteration [1].",
    "Thoughts and prayers are not a strategy, the sources argue [2].",
    "Myśli autora są przedstawione w drugim rozdziale [1].",
  ];
  for (const answer of answers) {
    assert.ok(!isPlaceholder(answer), `real answer must settle: ${answer.slice(0, 40)}…`);
  }
});
