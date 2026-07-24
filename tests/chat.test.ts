import assert from "node:assert/strict";
import test from "node:test";
import {
  findCompletedTurnAnswer,
  normalizeChatText,
  sanitizeAnswer,
  type ChatMessageSnapshot,
} from "../src/notebooklm/chat.js";

test("normalizes rendered whitespace before correlating a chat turn", () => {
  assert.equal(
    normalizeChatText("  ¿Qué explica\n   CREATE TABLE?  "),
    "¿Qué explica CREATE TABLE?"
  );
});

test("does not return an older answer or Gemini reasoning for a new question", () => {
  const messages: ChatMessageSnapshot[] = [
    { role: "user", text: "Explica herencia EER" },
    { role: "assistant", text: "Defining Key Concepts...", complete: true },
    { role: "user", text: "Explica CREATE TABLE" },
    {
      role: "assistant",
      text: "Deciphering the Intent. I'm zeroing in on the request...",
      complete: false,
    },
  ];

  assert.equal(findCompletedTurnAnswer(messages, "Explica CREATE TABLE"), null);
});

test("returns only the completed answer paired with the exact user turn", () => {
  const messages: ChatMessageSnapshot[] = [
    { role: "user", text: "Explica herencia EER" },
    { role: "assistant", text: "Respuesta EER", complete: true },
    { role: "user", text: "Explica\nCREATE TABLE" },
    {
      role: "assistant",
      text: "CREATE TABLE define una tabla y sus restricciones.",
      complete: true,
    },
  ];

  assert.equal(
    findCompletedTurnAnswer(messages, "Explica CREATE TABLE"),
    "CREATE TABLE define una tabla y sus restricciones."
  );
});

test("uses the newest occurrence when the same question is submitted twice", () => {
  const messages: ChatMessageSnapshot[] = [
    { role: "user", text: "Lista las fuentes" },
    { role: "assistant", text: "Respuesta anterior", complete: true },
    { role: "user", text: "Lista las fuentes" },
    { role: "assistant", text: "Respuesta actual", complete: true },
  ];

  assert.equal(findCompletedTurnAnswer(messages, "Lista las fuentes"), "Respuesta actual");
});

test("sanitizes UI controls while preserving paragraph spacing", () => {
  assert.equal(
    sanitizeAnswer("Primer párrafo.\n\nSegundo párrafo.\nmore_vert\n\n- Elemento\ncopy_all"),
    "Primer párrafo.\n\nSegundo párrafo.\n\n- Elemento"
  );
});
