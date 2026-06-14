/**
 * Page utilities for extracting prior answers from NotebookLM.
 *
 * Streaming-stability detection has moved to `notebooklm/chat.ts`
 * (`waitForStableAnswer`, issue #43). The old `waitForLatestAnswer` here
 * polled `div.thinking-message`, which Google removed — calls timed out
 * even when the answer was already on screen. That logic is gone.
 *
 * What remains:
 *   - `snapshotAllResponses(page)` — LEGACY, no longer called. The new
 *     `waitForStableAnswer` in `notebooklm/chat.ts` identifies the new
 *     answer purely by DOM position (the last `.to-user-container` element)
 *     and does not need a prior-text snapshot. Kept for back-compat with
 *     any external callers; safe to delete in a future cleanup.
 */

import type { Page } from "patchright";
import { log } from "./logger.js";

/**
 * Snapshot ALL existing assistant response texts.
 * Used to capture visible responses BEFORE submitting a new question.
 */
export async function snapshotAllResponses(page: Page): Promise<string[]> {
  const allTexts: string[] = [];
  const primarySelector = ".to-user-container";

  try {
    const containers = await page.$$(primarySelector);
    if (containers.length > 0) {
      for (const container of containers) {
        try {
          const textElement = await container.$(".message-text-content");
          if (textElement) {
            const text = await textElement.innerText();
            if (text && text.trim()) {
              allTexts.push(text.trim());
            }
          }
        } catch {
          continue;
        }
      }

      log.info(`📸 [SNAPSHOT] Captured ${allTexts.length} existing responses`);
    }
  } catch (error) {
    log.warning(`⚠️ [SNAPSHOT] Failed to snapshot responses: ${error}`);
  }

  return allTexts;
}

export default {
  snapshotAllResponses,
};
