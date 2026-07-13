/**
 * Create a brand-new NotebookLM notebook from the homepage (issue #70).
 *
 * Drives the already-authenticated page to the NotebookLM home, clicks the
 * "+ Create new" button, and waits for the redirect to /notebook/<uuid>.
 * Returns the new notebook URL + uuid so the caller can add sources / generate
 * audio against a *clean* notebook — this is what lets a recurring task avoid
 * stale-audio and source-accumulation from reusing one fixed notebook.
 *
 * Called with an already-initialised page (the session was bootstrapped on an
 * existing notebook); we just navigate that page to the root and click.
 */

import type { Page } from "patchright";
import { Selectors, joinAlt } from "./selectors.js";
import { log } from "../utils/logger.js";

export interface CreateNotebookResult {
  success: boolean;
  url?: string;
  uuid?: string;
  message?: string;
}

const HOMEPAGE = "https://notebooklm.google.com/";

export async function createNotebook(page: Page): Promise<CreateNotebookResult> {
  log.info("\u{1F4D3} [create_notebook] navigating to NotebookLM homepage");
  const before = page.url();
  await page.goto(HOMEPAGE, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait for the home UI to render its create button.
  try {
    await page
      .locator(joinAlt(Selectors.homepage.createButton))
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    return {
      success: false,
      message:
        `Could not find the "Create new" button on the NotebookLM homepage. ` +
        `The homepage UI may have changed.`,
    };
  }

  log.info("  \u{1F5B1}\uFE0F  clicking create button");
  await page
    .locator(joinAlt(Selectors.homepage.createButton))
    .first()
    .click({ timeout: 10_000 });

  // Clicking create first shows a transient /notebook/creating placeholder, then
  // redirects to the real /notebook/<uuid>. Require the full UUID shape so we
  // don't capture the placeholder ("creating" would match a loose [a-f0-9-]+).
  const UUID_RE =
    /\/notebook\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  try {
    await page.waitForURL(UUID_RE, { timeout: 30_000 });
  } catch {
    return {
      success: false,
      message:
        `Clicked "Create new" but no /notebook/<uuid> URL appeared within 30 s ` +
        `(still at ${page.url()}, started from ${before}).`,
    };
  }

  const url = page.url();
  const uuid = url.match(
    /notebook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
  )?.[1];
  if (!uuid) {
    return { success: false, message: `Redirected but could not parse a notebook uuid from ${url}.` };
  }
  log.success(`  \u2705 new notebook created: ${uuid}`);
  return { success: true, url, uuid };
}
