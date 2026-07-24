import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNotebookUrl } from "../src/notebooklm/url.js";

test("normalizes a valid NotebookLM URL", () => {
  assert.equal(
    normalizeNotebookUrl("https://notebooklm.google.com/notebook/abc_123-def#fragment"),
    "https://notebooklm.google.com/notebook/abc_123-def"
  );
});

test("accepts the current notebook.google.com host", () => {
  assert.equal(
    normalizeNotebookUrl("https://notebook.google.com/notebook/abc_123-def#fragment"),
    "https://notebook.google.com/notebook/abc_123-def"
  );
});

test("rejects non-NotebookLM and non-HTTPS URLs", () => {
  assert.throws(() => normalizeNotebookUrl("http://notebooklm.google.com/notebook/abc"), /HTTPS/);
  assert.throws(() => normalizeNotebookUrl("https://example.com/notebook/abc"), /host/);
  assert.throws(() => normalizeNotebookUrl("https://notebooklm.google.com/"), /must match/);
});
