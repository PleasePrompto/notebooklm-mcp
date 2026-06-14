/**
 * NotebookLM source ingestion (issue #25).
 *
 * v2.0.0 supports the two source types that cover the bulk of real usage:
 *   - `url`  — paste a website URL (NotebookLM crawls and indexes it)
 *   - `text` — paste raw text (treated as a copied document)
 *
 * File-upload, YouTube and Google-Drive ingestion are intentionally out of
 * scope for v2.0.0 — they require different overlay flows.
 *
 * Robustness strategy (2026-05, ported from the Fork's content-manager.ts):
 *
 *   1. Capture the *expected notebook UUID* from the URL up-front. NotebookLM
 *      sometimes redirects pasted-text uploads to a freshly-created notebook;
 *      we detect that and surface a clear error.
 *
 *   2. Resolve the dialog state defensively: if a dialog is already open we
 *      use it; otherwise we click the sidebar "Add source" button. The
 *      `[role="dialog"]` anchor is set synchronously on mount, so we do not
 *      have to race the Material `.mdc-dialog--open` animation class.
 *
 *   3. Source-type buttons no longer ship with aria-labels — see
 *      selectors.ts for the icon-/text-based anchors.
 *
 *   4. Insert verification is COUNT-BASED: snapshot
 *      `.single-source-container` count before the submit click, then poll
 *      after the dialog closes (up to 90 s — URL crawls are slow).
 */

import type { Locator, Page } from "patchright";
import { Selectors, joinAlt } from "./selectors.js";
import { safeSleep, isRecoverable } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";

export type SourceType = "url" | "text";

export interface AddSourceInput {
  type: SourceType;
  /** URL when `type === "url"`, raw text when `type === "text"`. */
  content: string;
  /** Optional title shown in the source list. NotebookLM uses a default if omitted. */
  title?: string;
}

export interface AddSourceResult {
  success: boolean;
  type: SourceType;
  sourceCountBefore: number;
  sourceCountAfter: number;
  message?: string;
}

export async function addSource(page: Page, input: AddSourceInput): Promise<AddSourceResult> {
  const initialUrl = page.url();
  const expectedUuid = initialUrl.match(/notebook\/([a-f0-9-]+)/)?.[1];
  log.info(`📄 [add_source] type=${input.type} target_uuid=${expectedUuid ?? "?"}`);

  try {
    // 1. Open the Add-source dialog (or use one that's already open).
    await openAddSourceOverlay(page);

    // 2. Pick the source type if there is a picker. Some overlay variants
    //    drop straight into an input field; pickSourceType is a no-op then.
    await pickSourceType(page, input.type);

    // 3. Fill the content + optional title.
    await fillSourceContent(page, input);

    // 4. Snapshot the source count *before* submitting. The Fork captures it
    //    here (dialog still open, sidebar list not yet updated) so the
    //    post-close poll can detect a real increment.
    const before = await countSources(page);
    log.info(`  📊 source count before submit: ${before}`);

    // 5. Click the primary "Insert" / "Hinzufügen" button.
    await confirmInsert(page);

    // 6. Wait for the dialog to animate away. NotebookLM doesn't append the
    //    new sidebar entry until the modal is fully gone.
    await waitForOverlayToClose(page);

    // 7. UUID redirect check: pasted-text uploads occasionally land in a new
    //    "Untitled notebook" instead of the target. Catch that here so the
    //    caller sees a useful error instead of a phantom success.
    if (expectedUuid) {
      const currentUrl = page.url();
      const currentUuid = currentUrl.match(/notebook\/([a-f0-9-]+)/)?.[1];
      if (currentUuid && currentUuid !== expectedUuid) {
        log.error(`  ❌ Notebook redirect: expected ${expectedUuid}, got ${currentUuid}`);
        return {
          success: false,
          type: input.type,
          sourceCountBefore: before,
          sourceCountAfter: before,
          message:
            `NotebookLM redirected to a different notebook (${currentUuid}) instead of ` +
            `the target (${expectedUuid}). This is a known quirk for pasted-text uploads — ` +
            `the source landed in a new "Untitled notebook".`,
        };
      }
    }

    // 8. Poll the source count for up to 90 s; URL crawls and large pastes
    //    can take a while to materialise as a sidebar entry.
    const after = await waitForSourceCountIncrease(page, before, 90_000);

    if (after > before) {
      log.success(`  ✅ source added (count ${before} → ${after})`);
      return {
        success: true,
        type: input.type,
        sourceCountBefore: before,
        sourceCountAfter: after,
      };
    }

    // 9. Last-ditch: maybe an error toast surfaced; surface it verbatim.
    const errorText = await readDialogError(page);
    return {
      success: false,
      type: input.type,
      sourceCountBefore: before,
      sourceCountAfter: after,
      message:
        errorText ||
        "Source dialog completed but the source list did not grow within 90 s. " +
          "Either NotebookLM is still crawling/indexing or the upload silently failed.",
    };
  } catch (err) {
    if (isRecoverable(err)) throw err;
    log.warning(`  ⚠️  add_source failed: ${err}`);
    return {
      success: false,
      type: input.type,
      sourceCountBefore: 0,
      sourceCountAfter: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Count sources in the sidebar via two independent anchors:
 *
 *   1. `.single-source-container` — the per-row sidebar element. Most
 *      direct, but only present once the sidebar has hydrated.
 *
 *   2. `.cover-subtitle-source-count` — a header label of the form
 *      `"3 Quellen"` / `"3 sources"`. Robust to a collapsed or partially
 *      hydrated sidebar because it lives in the chat header instead.
 *
 * We return whichever produces a higher count; mismatches between the two
 * usually mean the sidebar hasn't caught up yet, in which case the header
 * is the authoritative ground truth.
 */
export async function countSources(page: Page): Promise<number> {
  let containerCount = 0;
  try {
    containerCount = await page.locator(Selectors.sources.sourceContainer).count();
  } catch {
    /* fall through */
  }

  let headerCount = 0;
  try {
    const headerText = await page
      .locator(".cover-subtitle-source-count")
      .first()
      .textContent({ timeout: 500 })
      .catch(() => null);
    const match = headerText?.match(/(\d+)/);
    if (match) headerCount = parseInt(match[1], 10);
  } catch {
    /* ignore */
  }

  return Math.max(containerCount, headerCount);
}

/**
 * Open the Add-source modal. Order of attempts:
 *   1. Dialog already open → use it (auto-modal on fresh notebooks).
 *   2. Open the Sources panel if the current layout exposes one.
 *   3. Click the sidebar "Add source" / "Add sources" button.
 *   4. Last resort: navigate to `?addSource=true`, which auto-opens.
 */
async function openAddSourceOverlay(page: Page): Promise<void> {
  if (await isAddSourceUiVisible(page)) {
    log.info("  ✅ Add-source UI already open, reusing");
    return;
  }

  await ensureSourcesPanel(page);
  if (await isAddSourceUiVisible(page)) return;

  // Try the sidebar button first — fastest path on a populated notebook.
  try {
    await page.locator(joinAlt(Selectors.sources.addButton)).first().click({ timeout: 5_000 });
    await waitForAddSourceUi(page, 8_000);
    return;
  } catch (err) {
    log.warning(
      `  ⚠️  Add-source button click failed (${err}), trying ?addSource=true URL fallback`
    );
  }

  // URL fallback — useful when the sidebar button is hidden or covered.
  //
  // PATCH 2026-05: drop the `!url.includes("addSource=true")` short-circuit.
  // Once a previous attempt navigates to `?addSource=true` and the modal
  // never opens (e.g. selector miss), the URL stays sticky on every
  // subsequent BrowserSession reuse. The next add_source call then fails
  // the if-check and falls straight through to the `throw` below — a
  // permanent dead state cleared only by killing the session.
  // Fix: strip any existing `addSource`/`_t` params first, then re-add
  // `addSource=true` plus a `_t` cache-buster so the navigation is
  // guaranteed to be a fresh hit even when the URL was already sticky.
  // See issue #46 ("post-bootstrap add_source silent-drop").
  const url = page.url();
  if (url && /\/notebook\//.test(url)) {
    const u = new URL(url);
    u.searchParams.delete("addSource");
    u.searchParams.delete("_t");
    u.searchParams.set("addSource", "true");
    u.searchParams.set("_t", String(Date.now()));
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    await waitForAddSourceUi(page, 10_000);
    return;
  }

  throw new Error('Could not open the "Add source" dialog');
}

async function isAddSourceUiVisible(page: Page): Promise<boolean> {
  const overlayVisible = await page
    .locator(Selectors.sources.overlayPane)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (overlayVisible) return true;

  return page
    .locator(joinAlt(Selectors.sources.sourcePickerReady))
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

async function waitForAddSourceUi(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAddSourceUiVisible(page)) return;
    await safeSleep(page, 300);
  }
  throw new Error('Could not open the "Add source" dialog');
}

async function ensureSourcesPanel(page: Page): Promise<void> {
  const sourcesTab = page.locator(joinAlt(Selectors.tabs.sources)).first();
  if (await sourcesTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await sourcesTab.click({ timeout: 5_000 }).catch(() => undefined);
    await safeSleep(page, 500);
  }
}

async function addSourceScope(page: Page): Promise<Locator> {
  const overlay = page.locator(Selectors.sources.overlayPane).first();
  if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) return overlay;
  return page.locator("body");
}

async function pickSourceType(page: Page, type: SourceType): Promise<void> {
  const candidates =
    type === "url" ? Selectors.sources.sourceTypeUrl : Selectors.sources.sourceTypeText;
  const scope = await addSourceScope(page);
  for (const sel of candidates) {
    const target = scope.locator(sel).first();
    if (await target.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await target.click();
      // Sub-dialog needs a moment to hydrate before we type.
      await safeSleep(page, 500);
      return;
    }
  }
  // Older overlays drop straight to the input (no type picker) — that's fine.
}

async function fillSourceContent(page: Page, input: AddSourceInput): Promise<void> {
  const scope = await addSourceScope(page);

  // Wait for the overlay to actually contain a textarea (the picker swap is
  // animated, so a tight 500 ms wait beats a busy poll).
  await safeSleep(page, 500);

  const inputCandidates = [
    Selectors.sources.overlayTextarea,
    Selectors.sources.overlayInput,
    'textarea[aria-label*="Pasted" i]',
    'textarea[placeholder*="Paste text" i]',
    'textarea[aria-label*="Enter URLs" i]',
    'textarea[placeholder*="Paste any links" i]',
    `${Selectors.sources.overlayPane} textarea:not(.query-box-input):not(.query-box-textarea)`,
    "textarea:not(.query-box-input):not(.query-box-textarea)",
  ];

  let target = null;
  for (const sel of inputCandidates) {
    const candidate = page.locator(sel).first();
    if (await candidate.isVisible({ timeout: 2_000 }).catch(() => false)) {
      target = candidate;
      break;
    }
  }

  if (!target) {
    throw new Error(
      "Could not find an input field inside the Add-source overlay. " +
        "NotebookLM UI may have changed — please file an issue."
    );
  }

  // Title goes in a separate input when one is present; otherwise we prefix
  // it onto the text content (Fork's fallback for older overlays).
  let body = input.content;
  if (input.title && input.type === "text") {
    let titleInputFound = false;
    const titleSelectors = [
      'input[placeholder*="title" i]',
      'input[placeholder*="name" i]',
      'input[name="title"]',
      `${Selectors.sources.overlayPane} input[type="text"]:not([readonly])`,
    ];
    for (const sel of titleSelectors) {
      const candidate = scope.locator(sel).first();
      if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
        await candidate.fill(input.title).catch(() => undefined);
        titleInputFound = true;
        break;
      }
    }
    if (!titleInputFound) {
      body = `${input.title}\n\n${input.content}`;
    }
  }

  await target.fill(body);
  // Small settle delay before clicking submit; Material's primary button
  // briefly stays disabled after `fill()` while validators run.
  await safeSleep(page, 300);
}

async function confirmInsert(page: Page): Promise<void> {
  const scope = await addSourceScope(page);
  for (const sel of Selectors.sources.insertConfirm) {
    const btn = scope.locator(sel).first();
    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) continue;
      await btn.click();
      log.info(`  ✅ submit clicked (selector: ${sel})`);
      return;
    }
  }
  // Fallback: pressing Enter in many flows submits the form.
  log.warning("  ⚠️  No insert button matched, pressing Enter as fallback");
  await page.keyboard.press("Enter");
}

/**
 * Wait until the Add-source modal animates away. NotebookLM only appends the
 * new sidebar entry once the modal is fully gone, so we *must* wait here.
 */
async function waitForOverlayToClose(page: Page, timeoutMs: number = 30_000): Promise<void> {
  await page
    .locator(Selectors.sources.overlayPane)
    .first()
    .waitFor({ state: "hidden", timeout: timeoutMs })
    .catch(() => undefined);
}

async function waitForSourceCountIncrease(
  page: Page,
  before: number,
  timeoutMs: number = 90_000
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await countSources(page);
    if (current > before) return current;
    await safeSleep(page, 500);
  }
  return await countSources(page);
}

/**
 * Look for an error toast / `[role="alert"]` describing why the upload
 * failed. We filter against Material-icon-name leakage (e.g. `more_vert`),
 * which would otherwise produce nonsense error strings.
 */
async function readDialogError(page: Page): Promise<string | null> {
  const errorSelectors = [
    '[role="alert"]:visible',
    ".error-message:visible",
    ".mdc-snackbar--open",
  ];
  const ICON_LEAKS = ["more_vert", "more_horiz", "open_in_new", "content_copy"];

  for (const sel of errorSelectors) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const txt = (await el.textContent({ timeout: 1_000 }).catch(() => null))?.trim();
      if (!txt || txt.length > 240) continue;
      if (ICON_LEAKS.some((leak) => txt.includes(leak))) continue;
      return txt;
    } catch {
      continue;
    }
  }
  return null;
}
