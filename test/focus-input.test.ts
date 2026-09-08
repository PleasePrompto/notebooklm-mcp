import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "patchright";

import { humanType } from "../src/utils/stealth-utils.js";

test("humanType focuses the input without a pointer click", async () => {
  const calls: string[] = [];
  const page = {
    fill: async () => {
      calls.push("fill");
    },
    focus: async () => {
      calls.push("focus");
    },
    click: async () => {
      throw new Error("pointer click must not be used");
    },
  } as unknown as Page;

  await humanType(page, "textarea.query-box-input", "", {
    withTypos: false,
    wpm: 1000,
  });
  assert.deepEqual(calls, ["fill", "focus"]);
});
