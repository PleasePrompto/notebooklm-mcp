/**
 * Browser Session
 *
 * Represents a single browser session for NotebookLM interactions.
 *
 * Features:
 * - Human-like question typing
 * - Streaming response detection
 * - Auto-login on session expiry
 * - Session activity tracking
 * - Chat history reset
 *
 * Based on the Python implementation from browser_session.py
 */

import type { BrowserContext, Page } from "patchright";
import type { SharedContextManager } from "./shared-context-manager.js";
import type { AuthManager } from "../auth/auth-manager.js";
import { humanType, randomDelay } from "../utils/stealth-utils.js";
import { waitForStableAnswer } from "../notebooklm/chat.js";
import {
  extractCitations as extractCitationsFromPage,
  type SourceFormat,
  type ExtractCitationsResult,
} from "../notebooklm/citations.js";
import {
  addSource as addSourceToPage,
  type AddSourceInput,
  type AddSourceResult,
} from "../notebooklm/sources.js";
import {
  generateAudioOverview as generateAudioOnPage,
  downloadAudioOverview as downloadAudioOnPage,
  getAudioStatusOnPage,
  type GenerateAudioOptions,
  type AudioGenerationResult,
  type DownloadAudioResult,
} from "../notebooklm/audio.js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import { runAskDiagnostics } from "../utils/diagnostics.js";
import type { SessionInfo, ProgressCallback } from "../types.js";
import { RateLimitError } from "../errors.js";

export class BrowserSession {
  public readonly sessionId: string;
  public readonly notebookUrl: string;
  public readonly createdAt: number;
  public lastActivity: number;
  public messageCount: number;

  private context!: BrowserContext;
  private sharedContextManager: SharedContextManager;
  private authManager: AuthManager;
  private page: Page | null = null;
  private initialized: boolean = false;

  constructor(
    sessionId: string,
    sharedContextManager: SharedContextManager,
    authManager: AuthManager,
    notebookUrl: string
  ) {
    this.sessionId = sessionId;
    this.sharedContextManager = sharedContextManager;
    this.authManager = authManager;
    this.notebookUrl = notebookUrl;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.messageCount = 0;

    log.info(`🆕 BrowserSession ${sessionId} created`);
  }

  /**
   * Initialize the session by creating a page and navigating to the notebook
   */
  async init(): Promise<void> {
    if (this.initialized) {
      log.warning(`⚠️  Session ${this.sessionId} already initialized`);
      return;
    }

    log.info(`🚀 Initializing session ${this.sessionId}...`);

    try {
      // Ensure a valid shared context
      this.context = await this.sharedContextManager.getOrCreateContext();

      // Create new page (tab) in the shared context (with auto-recovery)
      try {
        this.page = await this.context.newPage();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          /has been closed|Target .* closed|Browser has been closed|Context .* closed/i.test(msg)
        ) {
          log.warning("  ♻️  Context was closed. Recreating and retrying newPage...");
          this.context = await this.sharedContextManager.getOrCreateContext();
          this.page = await this.context.newPage();
        } else {
          throw e;
        }
      }
      log.success(`  ✅ Created new page`);

      // Navigate to notebook
      log.info(`  🌐 Navigating to: ${this.notebookUrl}`);
      await this.page.goto(this.notebookUrl, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.browserTimeout,
      });

      // Wait for page to stabilize
      await randomDelay(2000, 3000);

      // Check if we need to login
      const isAuthenticated = await this.authManager.validateCookiesExpiry(this.context);

      if (!isAuthenticated) {
        log.warning(`  🔑 Session ${this.sessionId} needs authentication`);
        const loginSuccess = await this.ensureAuthenticated();
        if (!loginSuccess) {
          throw new Error("Failed to authenticate session");
        }
      } else {
        log.success(`  ✅ Session already authenticated`);
      }

      // CRITICAL: Restore sessionStorage from saved state
      // This is essential for maintaining Google session state!
      log.info(`  🔄 Restoring sessionStorage...`);
      const sessionData = await this.authManager.loadSessionStorage();
      if (sessionData) {
        const entryCount = Object.keys(sessionData).length;
        if (entryCount > 0) {
          await this.restoreSessionStorage(sessionData, entryCount);
        } else {
          log.info(`  ℹ️  SessionStorage empty (fresh session)`);
        }
      } else {
        log.info(`  ℹ️  No saved sessionStorage found (fresh session)`);
      }

      // Wait for NotebookLM interface to load
      log.info(`  ⏳ Waiting for NotebookLM interface...`);
      await this.waitForNotebookLMReady();

      this.initialized = true;
      this.updateActivity();
      log.success(`✅ Session ${this.sessionId} initialized successfully`);
    } catch (error) {
      log.error(`❌ Failed to initialize session ${this.sessionId}: ${error}`);
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      throw error;
    }
  }

  /**
   * Wait for NotebookLM interface to be ready
   *
   * IMPORTANT: Matches Python implementation EXACTLY!
   * - Uses SPECIFIC selectors (textarea.query-box-input)
   * - Checks ONLY for "visible" state (NOT disabled!)
   * - NO placeholder checks (let NotebookLM handle that!)
   *
   * Based on Python _wait_for_ready() from browser_session.py:104-113
   */
  private async waitForNotebookLMReady(): Promise<void> {
    if (!this.page) {
      throw new Error("Page not initialized");
    }

    try {
      // PRIMARY: Exact Python selector - textarea.query-box-input
      log.info("  ⏳ Waiting for chat input (textarea.query-box-input)...");
      await this.page.waitForSelector("textarea.query-box-input", {
        timeout: 10000, // Python uses 10s timeout
        state: "visible", // ONLY check visibility (NO disabled check!)
      });
      log.success("  ✅ Chat input ready!");
    } catch {
      // FALLBACK: Python alternative selector
      try {
        log.info("  ⏳ Trying fallback selector (aria-label)...");
        await this.page.waitForSelector('textarea[aria-label="Feld für Anfragen"]', {
          timeout: 5000, // Python uses 5s for fallback
          state: "visible",
        });
        log.success("  ✅ Chat input ready (fallback)!");
      } catch (error) {
        log.error(`  ❌ NotebookLM interface not ready: ${error}`);
        throw new Error(
          "Could not find NotebookLM chat input. " +
            "Please ensure the notebook page has loaded correctly.",
          { cause: error }
        );
      }
    }
  }

  private isPageClosedSafe(): boolean {
    if (!this.page) return true;
    try {
      if (this.page.isClosed()) return true;
      // Accessing URL should be safe; if page is gone, this may throw.
      void this.page.url();
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Ensure the session is authenticated, perform auto-login if needed
   */
  private async ensureAuthenticated(): Promise<boolean> {
    if (!this.page) {
      throw new Error("Page not initialized");
    }

    log.info(`🔑 Checking authentication for session ${this.sessionId}...`);

    // Check cookie validity
    const isValid = await this.authManager.validateCookiesExpiry(this.context);

    if (isValid) {
      log.success(`  ✅ Cookies valid`);
      return true;
    }

    log.warning(`  ⚠️  Cookies expired or invalid`);

    // Try to get valid auth state
    const statePath = await this.authManager.getValidStatePath();

    if (statePath) {
      // Load saved state
      log.info(`  📂 Loading auth state from: ${statePath}`);
      await this.authManager.loadAuthState(this.context, statePath);

      // Reload page to apply new auth
      log.info(`  🔄 Reloading page...`);
      await (this.page as Page).reload({ waitUntil: "domcontentloaded" });
      await randomDelay(2000, 3000);

      // Check if it worked
      const nowValid = await this.authManager.validateCookiesExpiry(this.context);
      if (nowValid) {
        log.success(`  ✅ Auth state loaded successfully`);
        return true;
      }
    }

    // Need fresh login
    log.warning(`  🔑 Fresh login required`);

    if (CONFIG.autoLoginEnabled) {
      log.info(`  🤖 Attempting auto-login...`);
      const loginSuccess = await this.authManager.loginWithCredentials(
        this.context,
        this.page,
        CONFIG.loginEmail,
        CONFIG.loginPassword
      );

      if (loginSuccess) {
        log.success(`  ✅ Auto-login successful`);
        // Navigate back to notebook
        await this.page.goto(this.notebookUrl, {
          waitUntil: "domcontentloaded",
        });
        await randomDelay(2000, 3000);
        return true;
      } else {
        log.error(`  ❌ Auto-login failed`);
        return false;
      }
    } else {
      log.error(`  ❌ Auto-login disabled and no valid auth state - manual login required`);
      return false;
    }
  }

  private getOriginFromUrl(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  /**
   * Safely restore sessionStorage when the page is on the expected origin
   */
  private async restoreSessionStorage(
    sessionData: Record<string, string>,
    entryCount: number
  ): Promise<void> {
    if (!this.page) {
      log.warning(`  ⚠️  Cannot restore sessionStorage without an active page`);
      return;
    }

    const targetOrigin = this.getOriginFromUrl(this.notebookUrl);
    if (!targetOrigin) {
      log.warning(`  ⚠️  Unable to determine target origin for sessionStorage restore`);
      return;
    }

    let restored = false;

    const applyToPage = async (): Promise<boolean> => {
      if (!this.page) {
        return false;
      }

      const currentOrigin = this.getOriginFromUrl(this.page.url());
      if (currentOrigin !== targetOrigin) {
        return false;
      }

      try {
        await this.page.evaluate((data) => {
          for (const [key, value] of Object.entries(data)) {
            sessionStorage.setItem(key, value);
          }
        }, sessionData);
        restored = true;
        log.success(`  ✅ SessionStorage restored: ${entryCount} entries`);
        return true;
      } catch (error) {
        log.warning(`  ⚠️  Failed to restore sessionStorage: ${error}`);
        return false;
      }
    };

    if (await applyToPage()) {
      return;
    }

    log.info(`  ⏳ Waiting for NotebookLM origin before restoring sessionStorage...`);

    const handleNavigation = async () => {
      if (restored) {
        return;
      }

      if (await applyToPage()) {
        this.page?.off("framenavigated", handleNavigation);
      }
    };

    this.page.on("framenavigated", handleNavigation);
  }

  /**
   * Ask a question to NotebookLM
   */
  async ask(question: string, sendProgress?: ProgressCallback): Promise<string> {
    const askOnce = async (): Promise<string> => {
      if (!this.initialized || !this.page || this.isPageClosedSafe()) {
        log.warning(`  ℹ️  Session not initialized or page missing → re-initializing...`);
        await this.init();
      }

      log.info(`💬 [${this.sessionId}] Asking: "${question.substring(0, 100)}..."`);
      const page = this.page!;
      // Ensure we're still authenticated
      await sendProgress?.("Verifying authentication...", 2, 5);
      const isAuth = await this.authManager.validateCookiesExpiry(this.context);
      if (!isAuth) {
        log.warning(`  🔑 Session expired, re-authenticating...`);
        await sendProgress?.("Re-authenticating session...", 2, 5);
        const reAuthSuccess = await this.ensureAuthenticated();
        if (!reAuthSuccess) {
          throw new Error("Failed to re-authenticate session");
        }
      }

      // Find the chat input
      const inputSelector = await this.findChatInput();
      if (!inputSelector) {
        throw new Error(
          "Could not find visible chat input element. " +
            "Please check if the notebook page has loaded correctly."
        );
      }

      log.info(`  ⌨️  Typing question with human-like behavior...`);
      await sendProgress?.("Typing question with human-like behavior...", 2, 5);
      await humanType(page, inputSelector, question, {
        withTypos: true,
        wpm: Math.max(CONFIG.typingWpmMin, CONFIG.typingWpmMax),
      });

      // Small pause before submitting
      await randomDelay(500, 1000);

      // Submit the question (Enter key)
      log.info(`  📤 Submitting question...`);
      await sendProgress?.("Submitting question...", 3, 5);
      await page.keyboard.press("Enter");

      // Opt-in diagnostic capture (NOTEBOOKLM_DIAGNOSTIC=true). Runs BEFORE
      // the wait so it can record the post-submit state in parallel with
      // waitForStableAnswer's polling. No behavior change when env is unset.
      if (process.env.NOTEBOOKLM_DIAGNOSTIC === "true") {
        await runAskDiagnostics(page, this.sessionId, question);
      }

      // Small pause after submit
      await randomDelay(1000, 1500);

      // Wait for the response with streaming-stability detection (issue #43).
      // Timeout comes from CONFIG.answerTimeoutMs so users can tune it via
      // ANSWER_TIMEOUT_MS or browser_options.timeout_ms (issue #14, #27).
      log.info(`  ⏳ Waiting for response (streaming-stability)...`);
      await sendProgress?.("Waiting for NotebookLM response (streaming-stability)...", 3, 5);
      const answer = await waitForStableAnswer(page, {
        question,
        timeoutMs: CONFIG.answerTimeoutMs,
        pollIntervalMs: 750,
      });

      if (!answer) {
        throw new Error("Timeout waiting for response from NotebookLM");
      }

      // Check for rate limit errors AFTER receiving answer
      log.info(`  🔍 Checking for rate limit errors...`);
      if (await this.detectRateLimitError()) {
        throw new RateLimitError(
          "NotebookLM rate limit reached (50 queries/day for free accounts)"
        );
      }

      // Update session stats
      this.messageCount++;
      this.updateActivity();

      log.success(
        `✅ [${this.sessionId}] Received answer (${answer.length} chars, ${this.messageCount} total messages)`
      );

      return answer;
    };

    try {
      return await askOnce();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/has been closed|Target .* closed|Browser has been closed|Context .* closed/i.test(msg)) {
        log.warning(`  ♻️  Detected closed page/context. Recovering session and retrying ask...`);
        try {
          this.initialized = false;
          if (this.page) {
            try {
              await this.page.close();
            } catch {
              /* page already gone */
            }
          }
          this.page = null;
          await this.init();
          return await askOnce();
        } catch (e2) {
          log.error(`❌ Recovery failed: ${e2}`);
          throw e2;
        }
      }
      log.error(`❌ [${this.sessionId}] Failed to ask question: ${msg}`);
      throw error;
    }
  }

  /**
   * Add a new source (URL or pasted text) to the active notebook page
   * (issue #25). Lazily initialises the session so the caller can use this
   * without first running `ask()`.
   */
  async addSource(input: AddSourceInput): Promise<AddSourceResult> {
    if (!this.initialized || !this.page || this.isPageClosedSafe()) {
      await this.init();
    }
    return await addSourceToPage(this.page!, input);
  }

  /**
   * Generate an Audio Overview for the active notebook (issue #11).
   */
  async generateAudio(options: GenerateAudioOptions = {}): Promise<AudioGenerationResult> {
    if (!this.initialized || !this.page || this.isPageClosedSafe()) {
      await this.init();
    }
    return await generateAudioOnPage(this.page!, options);
  }

  /**
   * Non-blocking probe for the current Audio Overview state (issue #11).
   */
  async getAudioStatus(): Promise<AudioGenerationResult> {
    if (!this.initialized || !this.page || this.isPageClosedSafe()) {
      await this.init();
    }
    return await getAudioStatusOnPage(this.page!);
  }

  /**
   * Download the most recent Audio Overview (issue #11).
   */
  async downloadAudio(destinationDir: string): Promise<DownloadAudioResult> {
    if (!this.initialized || !this.page || this.isPageClosedSafe()) {
      await this.init();
    }
    return await downloadAudioOnPage(this.page!, destinationDir);
  }

  /**
   * Pull DOM-level citations from the most recent answer on this session's
   * page (issue #20). Must be called immediately after `ask()` — before any
   * follow-up question disturbs the source panel.
   */
  async extractCitations(answer: string, format: SourceFormat): Promise<ExtractCitationsResult> {
    if (format === "none" || !this.page || this.isPageClosedSafe()) {
      return { citations: [], formattedAnswer: answer };
    }
    try {
      return await extractCitationsFromPage(this.page, answer, format);
    } catch (err) {
      log.warning(`  ⚠️  Citation extraction failed: ${err}`);
      return { citations: [], formattedAnswer: answer };
    }
  }

  /**
   * Find the chat input element
   *
   * IMPORTANT: Matches Python implementation EXACTLY!
   * - Uses SPECIFIC selectors from Python
   * - Checks ONLY visibility (NOT disabled state!)
   *
   * Based on Python ask() method from browser_session.py:166-171
   */
  private async findChatInput(): Promise<string | null> {
    if (!this.page) {
      return null;
    }

    const selectors = [
      // Stable class — language-agnostic.
      "textarea.query-box-input",
      // Locale-bound aria-label fallbacks for older builds.
      'textarea[aria-label="Feld für Anfragen"]',
      'textarea[aria-label*="anfrag" i]',
      'textarea[aria-label*="query" i]',
      'textarea[aria-label*="zone de requete" i]',
      'textarea[aria-label*="requete" i]',
      'textarea[aria-label*="consulta" i]',
      'textarea[aria-label*="domanda" i]',
    ];

    const tryFind = async (): Promise<string | null> => {
      for (const selector of selectors) {
        try {
          const element = await this.page!.$(selector);
          if (element && (await element.isVisible())) {
            return selector;
          }
        } catch {
          continue;
        }
      }
      return null;
    };

    let hit = await tryFind();
    if (hit) {
      log.success(`  ✅ Found chat input: ${hit}`);
      return hit;
    }

    // Recovery: chat input is most often hidden because (a) a leftover Add-
    // source / customise modal is still mounted, (b) a citation source-panel
    // is open, or (c) we navigated to `?addSource=true` and never cleaned the
    // URL up. Try all three remedies and re-probe.
    log.warning("  ⚠️  Chat input not visible, attempting recovery…");
    try {
      await this.page.keyboard.press("Escape").catch(() => undefined);
      await this.page.keyboard.press("Escape").catch(() => undefined);
      await randomDelay(200, 400);
      hit = await tryFind();
      if (hit) {
        log.success(`  ✅ Found chat input after Escape: ${hit}`);
        return hit;
      }

      const url = this.page.url();
      if (url.includes("addSource=true") || url.includes("?")) {
        const cleanUrl = url.replace(/[?&]addSource=true/g, "").replace(/&$/, "");
        if (cleanUrl !== url) {
          log.info(`  ↻ Cleaning URL state: ${url} → ${cleanUrl}`);
          await this.page
            .goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
            .catch(() => undefined);
          await randomDelay(800, 1200);
          hit = await tryFind();
          if (hit) {
            log.success(`  ✅ Found chat input after URL clean: ${hit}`);
            return hit;
          }
        }
      }

      // Last resort: reload the notebook page entirely.
      log.warning("  ⚠️  Reloading notebook page as last resort…");
      await this.page
        .goto(this.notebookUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => undefined);
      await randomDelay(1500, 2500);
      hit = await tryFind();
      if (hit) {
        log.success(`  ✅ Found chat input after reload: ${hit}`);
        return hit;
      }
    } catch (err) {
      log.warning(`  ⚠️  Recovery failed: ${err}`);
    }

    log.error("  ❌ Could not find visible chat input");
    return null;
  }

  /**
   * Detect if a rate limit error occurred
   *
   * Searches the page for error messages indicating rate limit/quota exhaustion.
   * Free NotebookLM accounts have 50 queries/day limit.
   *
   * @returns true if rate limit error detected, false otherwise
   */
  private async detectRateLimitError(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    // Error message selectors (common patterns for error containers)
    const errorSelectors = [
      ".error-message",
      ".error-container",
      "[role='alert']",
      ".rate-limit-message",
      "[data-error]",
      ".notification-error",
      ".alert-error",
      ".toast-error",
    ];

    // Keywords that indicate rate limiting
    const keywords = [
      "rate limit",
      "limit exceeded",
      "quota exhausted",
      "daily limit",
      "limit reached",
      "too many requests",
      "ratenlimit",
      "quota",
      "query limit",
      "request limit",
    ];

    // Check error containers for rate limit messages
    for (const selector of errorSelectors) {
      try {
        const elements = await this.page.$$(selector);
        for (const el of elements) {
          try {
            const text = await el.innerText();
            const lower = text.toLowerCase();

            if (keywords.some((k) => lower.includes(k))) {
              log.error(`🚫 Rate limit detected: ${text.slice(0, 100)}`);
              return true;
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    // Also check if chat input is disabled (sometimes NotebookLM disables input when rate limited)
    try {
      const inputSelector = "textarea.query-box-input";
      const input = await this.page.$(inputSelector);
      if (input) {
        const isDisabled = await input.evaluate((el) => {
          return (
            (el as HTMLTextAreaElement).disabled || (el as HTMLElement).hasAttribute("disabled")
          );
        });

        if (isDisabled) {
          // Check if there's an error message near the input
          const parent = await input.evaluateHandle((el) => el.parentElement);
          const parentEl = parent.asElement();
          if (parentEl) {
            try {
              const parentText = await parentEl.innerText();
              const lower = parentText.toLowerCase();
              if (keywords.some((k) => lower.includes(k))) {
                log.error(`🚫 Rate limit detected: Chat input disabled with error message`);
                return true;
              }
            } catch {
              // Ignore
            }
          }
        }
      }
    } catch {
      // Ignore errors checking input state
    }

    return false;
  }

  /**
   * Reset the chat history (start a new conversation)
   */
  async reset(): Promise<void> {
    const resetOnce = async (): Promise<void> => {
      if (!this.initialized || !this.page || this.isPageClosedSafe()) {
        await this.init();
      }
      log.info(`🔄 [${this.sessionId}] Resetting chat history...`);
      // Reload the page to clear chat history
      await (this.page as Page).reload({ waitUntil: "domcontentloaded" });
      await randomDelay(2000, 3000);

      // Wait for interface to be ready again
      await this.waitForNotebookLMReady();

      // Reset message count
      this.messageCount = 0;
      this.updateActivity();

      log.success(`✅ [${this.sessionId}] Chat history reset`);
    };

    try {
      await resetOnce();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/has been closed|Target .* closed|Browser has been closed|Context .* closed/i.test(msg)) {
        log.warning(`  ♻️  Detected closed page/context during reset. Recovering and retrying...`);
        this.initialized = false;
        if (this.page) {
          try {
            await this.page.close();
          } catch {
            /* page already gone */
          }
        }
        this.page = null;
        await this.init();
        await resetOnce();
        return;
      }
      log.error(`❌ [${this.sessionId}] Failed to reset: ${msg}`);
      throw error;
    }
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    log.info(`🛑 Closing session ${this.sessionId}...`);

    if (this.page) {
      try {
        await this.page.close();
        this.page = null;
        log.success(`  ✅ Page closed`);
      } catch (error) {
        log.warning(`  ⚠️  Error closing page: ${error}`);
      }
    }

    this.initialized = false;
    log.success(`✅ Session ${this.sessionId} closed`);
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(): void {
    this.lastActivity = Date.now();
  }

  /**
   * Check if session has expired (inactive for too long)
   */
  isExpired(timeoutSeconds: number): boolean {
    const inactiveSeconds = (Date.now() - this.lastActivity) / 1000;
    return inactiveSeconds > timeoutSeconds;
  }

  /**
   * Get session information
   */
  getInfo(): SessionInfo {
    const now = Date.now();
    return {
      id: this.sessionId,
      created_at: this.createdAt,
      last_activity: this.lastActivity,
      age_seconds: (now - this.createdAt) / 1000,
      inactive_seconds: (now - this.lastActivity) / 1000,
      message_count: this.messageCount,
      notebook_url: this.notebookUrl,
    };
  }

  /**
   * Get the underlying page (for advanced operations)
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Check if session is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.page !== null;
  }
}
