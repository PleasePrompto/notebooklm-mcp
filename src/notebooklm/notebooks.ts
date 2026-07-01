/**
 * Notebook-level operations that live on the NotebookLM *home* page rather
 * than inside a single notebook — currently just deletion.
 *
 * Deletion is only reachable from the home list: each row exposes an actions
 * menu (`Selectors.notebooks.actionsMenuTrigger`) whose "Delete" item opens a
 * confirm dialog ("Excluir o notebook de todos os lugares?" · buttons
 * Cancel / Delete). Verified live 2026-07.
 *
 * The home DOM exposes NO notebook UUID and no per-row link, so the only
 * stable handle is the visible TITLE. Because deletion is destructive we
 * match the title EXACTLY and refuse unless exactly one row matches.
 */

import type { Page } from "patchright";
import { Selectors, joinAlt } from "./selectors.js";
import { safeSleep, isRecoverable } from "../browser/watchdog.js";
import { log } from "../utils/logger.js";

const NOTEBOOKLM_HOME = "https://notebooklm.google.com/";
const CANCEL_RE = /cancel|cancelar|abbrechen|annuler|annulla|cancelar|キャンセル/i;

export interface DeleteNotebookResult {
  success: boolean;
  deletedTitle?: string;
  message?: string;
}

export async function deleteNotebookByTitle(
  page: Page,
  title: string
): Promise<DeleteNotebookResult> {
  log.info(`🗑️  [delete_notebook] target title="${title}"`);
  try {
    // 1. Ensure we are on the home list (deletion lives there, not inside a
    //    notebook).
    const url = page.url();
    if (!url.includes("notebooklm.google.com") || url.includes("/notebook/")) {
      await page.goto(NOTEBOOKLM_HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page
      .locator(joinAlt(Selectors.notebooks.createButton))
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => undefined);
    await safeSleep(page, 1_500);

    // 2. Locate the row by title (substring match — the home title may carry a
    //    leading emoji or be truncated). Uniqueness-guarded: never guess for a
    //    destructive op.
    const titleLoc = page.getByText(title, { exact: false });
    const count = await titleLoc.count();
    if (count === 0) {
      return {
        success: false,
        message:
          `No notebook whose title contains "${title}" was found on the home ` +
          `page. Match is against the NotebookLM title, which may differ from ` +
          `the library name if it was auto-generated.`,
      };
    }
    if (count > 1) {
      return {
        success: false,
        message:
          `Ambiguous: ${count} notebooks have a title containing "${title}". ` +
          `Refusing to delete — pass a more specific title, or rename to ` +
          `disambiguate, then retry.`,
      };
    }

    // 3. From the title node, reach the row's actions-menu trigger (nearest
    //    ancestor that contains a mat menu trigger).
    const trigger = titleLoc
      .locator(
        'xpath=ancestor::*[.//button[contains(@class,"mat-mdc-menu-trigger")]][1]' +
          '//button[contains(@class,"mat-mdc-menu-trigger")]'
      )
      .first();
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    await trigger.click();
    await safeSleep(page, 600);

    // 4. Click the "Delete" menu item.
    let clickedDelete = false;
    for (const sel of Selectors.notebooks.deleteButton) {
      const item = page.locator(sel).first();
      if (await item.isVisible({ timeout: 800 }).catch(() => false)) {
        await item.click();
        clickedDelete = true;
        break;
      }
    }
    if (!clickedDelete) {
      await page.keyboard.press("Escape").catch(() => undefined);
      return {
        success: false,
        message: "Opened the card menu but could not find the Delete item.",
      };
    }
    await safeSleep(page, 600);

    // 5. Confirm — click the primary (non-cancel) button in the confirm dialog.
    const dialog = page.locator('[role="dialog"].mat-mdc-dialog-container').first();
    await dialog.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    let confirmed = false;
    for (const sel of Selectors.notebooks.confirmDelete) {
      const btn = dialog.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
        const txt = ((await btn.textContent().catch(() => "")) || "").trim();
        if (CANCEL_RE.test(txt)) continue;
        await btn.click();
        confirmed = true;
        break;
      }
    }
    if (!confirmed) {
      await page.keyboard.press("Escape").catch(() => undefined);
      return {
        success: false,
        message: "Delete confirmation dialog appeared but no confirm button matched.",
      };
    }

    // 6. Verify: the dialog closes and the title vanishes from the list.
    await dialog.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
    await safeSleep(page, 1_500);
    const stillThere = await page.getByText(title, { exact: false }).count();
    if (stillThere > 0) {
      return {
        success: false,
        deletedTitle: title,
        message:
          "Clicked confirm but the notebook still appears in the list — " +
          "deletion may not have completed.",
      };
    }

    log.success(`  ✅ Notebook "${title}" deleted from NotebookLM`);
    return { success: true, deletedTitle: title };
  } catch (err) {
    if (isRecoverable(err)) throw err;
    log.warning(`  ⚠️  delete_notebook failed: ${err}`);
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}
