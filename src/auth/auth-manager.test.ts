import assert from "node:assert/strict";
import test from "node:test";
import { isNotebookLmUrl } from "./auth-manager.js";

test("recognizes both NotebookLM production domains", () => {
  assert.equal(isNotebookLmUrl("https://notebooklm.google.com/"), true);
  assert.equal(isNotebookLmUrl("https://notebooklm.google.com/notebook/abc"), true);
  assert.equal(isNotebookLmUrl("https://notebook.google.com/?pli=1"), true);
  assert.equal(isNotebookLmUrl("https://notebook.google.com/notebook/abc"), true);
});

test("rejects lookalike and unrelated domains", () => {
  assert.equal(isNotebookLmUrl("https://notebook.google.com.evil.example/"), false);
  assert.equal(isNotebookLmUrl("https://accounts.google.com/"), false);
});
