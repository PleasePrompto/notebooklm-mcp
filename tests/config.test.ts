import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG, applyBrowserOptions, getRuntimeConfig, withRuntimeConfig } from "../src/config.js";

test("request-scoped browser options do not mutate global configuration", async () => {
  const visible = applyBrowserOptions({ show: true, timeout_ms: 1234 });
  const hidden = applyBrowserOptions({ show: false, timeout_ms: 5678 });

  const [visibleResult, hiddenResult] = await Promise.all([
    withRuntimeConfig(visible, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getRuntimeConfig();
    }),
    withRuntimeConfig(hidden, async () => getRuntimeConfig()),
  ]);

  assert.equal(visibleResult.headless, false);
  assert.equal(visibleResult.browserTimeout, 1234);
  assert.equal(hiddenResult.headless, true);
  assert.equal(hiddenResult.browserTimeout, 5678);
  assert.equal(getRuntimeConfig(), CONFIG);
});
