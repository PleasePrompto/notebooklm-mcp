/**
 * Authentication Manager for NotebookLM
 *
 * Handles:
 * - Interactive login (headful browser for setup)
 * - Auto-login with credentials (email/password from ENV)
 * - Browser state persistence (cookies + localStorage + sessionStorage)
 * - Cookie expiry validation
 * - State expiry checks (24h file age)
 * - Hard reset for clean start
 *
 * Based on the Python implementation from auth.py
 */

import type { BrowserContext, Page } from "patchright";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { CONFIG, NOTEBOOKLM_AUTH_URL } from "../config.js";
import { log } from "../utils/logger.js";
import {
  humanType,
  randomDelay,
  realisticClick,
  randomMouseMovement,
} from "../utils/stealth-utils.js";
import type { ProgressCallback } from "../types.js";

/**
 * Critical cookie names for Google authentication
 */
const CRITICAL_COOKIE_NAMES = [
  "SID",
  "HSID",
  "SSID", // Google session
  "APISID",
  "SAPISID", // API auth
  "OSID",
  "__Secure-OSID", // NotebookLM-specific
  "__Secure-1PSID",
  "__Secure-3PSID", // Secure variants
];

export class AuthManager {
  private stateFilePath: string;
  private sessionFilePath: string;

  constructor() {
    this.stateFilePath = path.join(CONFIG.browserStateDir, "state.json");
    this.sessionFilePath = path.join(CONFIG.browserStateDir, "session.json");
  }

  // ============================================================================
  // Browser State Management
  // ============================================================================

  /**
   * Save entire browser state (cookies + localStorage)
   */
  async saveBrowserState(context: BrowserContext, page?: Page): Promise<boolean> {
    try {
      // Save storage state (cookies + localStorage + IndexedDB)
      await context.storageState({ path: this.stateFilePath });

      // Also save sessionStorage if page is provided
      if (page) {
        try {
          const sessionStorageData: string = await page.evaluate((): string => {
            // @ts-expect-error - window exists in browser context
            return JSON.stringify(window.sessionStorage);
          });

          await fs.writeFile(this.sessionFilePath, sessionStorageData, {
            encoding: "utf-8",
          });

          log.success("✅ Browser state saved (incl. sessionStorage)");
        } catch (error) {
          log.warning(`⚠️  State saved, but sessionStorage failed: ${error}`);
        }
      } else {
        log.success("✅ Browser state saved");
      }

      return true;
    } catch (error) {
      log.error(`❌ Failed to save browser state: ${error}`);
      return false;
    }
  }

  /**
   * Check if saved browser state exists
   */
  async hasSavedState(): Promise<boolean> {
    try {
      await fs.access(this.stateFilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get path to saved browser state
   */
  getStatePath(): string | null {
    // Synchronous check using imported existsSync
    if (existsSync(this.stateFilePath)) {
      return this.stateFilePath;
    }
    return null;
  }

  /**
   * Get valid state path (checks expiry)
   */
  async getValidStatePath(): Promise<string | null> {
    const statePath = this.getStatePath();
    if (!statePath) {
      return null;
    }

    if (await this.isStateExpired()) {
      log.warning("⚠️  Saved state is expired (>24h old)");
      log.info("💡 Run setup_auth tool to re-authenticate");
      return null;
    }

    return statePath;
  }

  /**
   * Load sessionStorage from file
   */
  async loadSessionStorage(): Promise<Record<string, string> | null> {
    try {
      const data = await fs.readFile(this.sessionFilePath, { encoding: "utf-8" });
      const sessionData = JSON.parse(data);
      log.success(`✅ Loaded sessionStorage (${Object.keys(sessionData).length} entries)`);
      return sessionData;
    } catch (error) {
      log.warning(`⚠️  Failed to load sessionStorage: ${error}`);
      return null;
    }
  }

  // ============================================================================
  // Cookie Validation
  // ============================================================================

  /**
   * Validate if saved state is still valid
   */
  async validateState(context: BrowserContext): Promise<boolean> {
    try {
      const cookies = await context.cookies();
      if (cookies.length === 0) {
        log.warning("⚠️  No cookies found in state");
        return false;
      }

      // Check for Google auth cookies
      const googleCookies = cookies.filter((c) =>
        c.domain.includes("google.com")
      );
      if (googleCookies.length === 0) {
        log.warning("⚠️  No Google cookies found");
        return false;
      }

      // Check if important cookies are expired
      const currentTime = Date.now() / 1000;

      for (const cookie of googleCookies) {
        const expires = cookie.expires ?? -1;
        if (expires !== -1 && expires < currentTime) {
          log.warning(`⚠️  Cookie '${cookie.name}' has expired`);
          return false;
        }
      }

      log.success("✅ State validation passed");
      return true;
    } catch (error) {
      log.warning(`⚠️  State validation failed: ${error}`);
      return false;
    }
  }

  /**
   * Validate if critical authentication cookies are still valid
   */
  async validateCookiesExpiry(context: BrowserContext): Promise<boolean> {
    try {
      const cookies = await context.cookies();
      if (cookies.length === 0) {
        log.warning("⚠️  No cookies found");
        return false;
      }

      // Find critical cookies
      const criticalCookies = cookies.filter((c) =>
        CRITICAL_COOKIE_NAMES.includes(c.name)
      );

      if (criticalCookies.length === 0) {
        log.warning("⚠️  No critical auth cookies found");
        return false;
      }

      // Check expiration for each critical cookie
      const currentTime = Date.now() / 1000;
      const expiredCookies: string[] = [];

      for (const cookie of criticalCookies) {
        const expires = cookie.expires ?? -1;

        // -1 means session cookie (valid until browser closes)
        if (expires === -1) {
          continue;
        }

        // Check if cookie is expired
        if (expires < currentTime) {
          expiredCookies.push(cookie.name);
        }
      }

      if (expiredCookies.length > 0) {
        log.warning(`⚠️  Expired cookies: ${expiredCookies.join(", ")}`);
        return false;
      }

      log.success(`✅ All ${criticalCookies.length} critical cookies are valid`);
      return true;
    } catch (error) {
      log.warning(`⚠️  Cookie validation failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if the saved state file is too old (>24 hours)
   */
  async isStateExpired(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.stateFilePath);
      const fileAgeSeconds = (Date.now() - stats.mtimeMs) / 1000;
      const maxAgeSeconds = 24 * 60 * 60; // 24 hours

      if (fileAgeSeconds > maxAgeSeconds) {
        const hoursOld = fileAgeSeconds / 3600;
        log.warning(`⚠️  Saved state is ${hoursOld.toFixed(1)}h old (max: 24h)`);
        return true;
      }

      return false;
    } catch {
      return true; // File doesn't exist = expired
    }
  }

  // ============================================================================
  // Interactive Login
  // ============================================================================

  /**
   * Perform interactive login
   * User will see a browser window and login manually
   *
   * SIMPLE & RELIABLE: Just wait for URL to change to notebooklm.google.com
   */
  async performLogin(page: Page, sendProgress?: ProgressCallback): Promise<boolean> {
    try {
      log.info("🌐 Opening Google login page...");
      log.warning("📝 Please login to your Google account");
      log.warning("⏳ Browser will close automatically once you reach NotebookLM");
      log.info("");

      // Progress: Navigating
      await sendProgress?.("Navigating to Google login...", 3, 10);

      // Navigate to Google login (redirects to NotebookLM after auth)
      await page.goto(NOTEBOOKLM_AUTH_URL, { timeout: 60000 });

      // Progress: Waiting for login
      await sendProgress?.("Waiting for manual login (up to 10 minutes)...", 4, 10);

      // Wait for user to complete login
      log.warning("⏳ Waiting for login (up to 10 minutes)...");

      const checkIntervalMs = 1000; // Check every 1 second
      const maxAttempts = 600; // 10 minutes total
      let lastProgressUpdate = 0;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const currentUrl = page.url();
          const elapsedSeconds = Math.floor(attempt * (checkIntervalMs / 1000));

          // Send progress every 10 seconds
          if (elapsedSeconds - lastProgressUpdate >= 10) {
            lastProgressUpdate = elapsedSeconds;
            const progressStep = Math.min(8, 4 + Math.floor(elapsedSeconds / 60));
            await sendProgress?.(
              `Waiting for login... (${elapsedSeconds}s elapsed)`,
              progressStep,
              10
            );
          }

          // ✅ SIMPLE: Check if we're on NotebookLM (any path!)
          if (currentUrl.startsWith("https://notebooklm.google.com/")) {
            await sendProgress?.("Login successful! NotebookLM detected!", 9, 10);
            log.success("✅ Login successful! NotebookLM URL detected.");
            log.success(`✅ Current URL: ${currentUrl}`);

            // Short wait to ensure page is loaded
            await page.waitForTimeout(2000);
            return true;
          }

          // Still on accounts.google.com - log periodically
          if (currentUrl.includes("accounts.google.com") && attempt % 30 === 0 && attempt > 0) {
            log.warning(`⏳ Still waiting... (${elapsedSeconds}s elapsed)`);
          }

          await page.waitForTimeout(checkIntervalMs);
        } catch {
          await page.waitForTimeout(checkIntervalMs);
          continue;
        }
      }

      // Timeout reached - final check
      const currentUrl = page.url();
      if (currentUrl.startsWith("https://notebooklm.google.com/")) {
        await sendProgress?.("Login successful (detected on timeout check)!", 9, 10);
        log.success("✅ Login successful (detected on timeout check)");
        return true;
      }

      log.error("❌ Login verification failed - timeout reached");
      log.warning(`Current URL: ${currentUrl}`);
      return false;
    } catch (error) {
      log.error(`❌ Login failed: ${error}`);
      return false;
    }
  }

  // ============================================================================
  // Auto-Login with Credentials
  // ============================================================================

  /**
   * Attempt to authenticate using configured credentials
   */
  async loginWithCredentials(
    context: BrowserContext,
    page: Page,
    email: string,
    password: string
  ): Promise<boolean> {
    const maskedEmail = this.maskEmail(email);
    log.warning(`🔁 Attempting automatic login for ${maskedEmail}...`);

    // Log browser visibility
    if (!CONFIG.headless) {
      log.info("  👁️  Browser is VISIBLE for debugging");
    } else {
      log.info("  🙈 Browser is HEADLESS (invisible)");
    }

    log.info(`  🌐 Navigating to Google login...`);

    try {
      await page.goto(NOTEBOOKLM_AUTH_URL, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.browserTimeout,
      });
      log.success(`  ✅ Page loaded: ${page.url().slice(0, 80)}...`);
    } catch (error) {
      log.warning(`  ⚠️  Page load timeout (continuing anyway)`);
    }

    const deadline = Date.now() + CONFIG.autoLoginTimeoutMs;
    log.info(`  ⏰ Auto-login timeout: ${CONFIG.autoLoginTimeoutMs / 1000}s`);

    // Already on NotebookLM?
    log.info("  🔍 Checking if already authenticated...");
    if (await this.waitForNotebook(page, CONFIG.autoLoginTimeoutMs)) {
      log.success("✅ Already authenticated");
      await this.saveBrowserState(context, page);
      return true;
    }

    log.warning("  ❌ Not authenticated yet, proceeding with login...");

    // Handle possible account chooser
    log.info("  🔍 Checking for account chooser...");
    if (await this.handleAccountChooser(page, email)) {
      log.success("  ✅ Account selected from chooser");
      if (await this.waitForNotebook(page, CONFIG.autoLoginTimeoutMs)) {
        log.success("✅ Automatic login successful");
        await this.saveBrowserState(context, page);
        return true;
      }
    }

    // Email step
    log.info("  📧 Entering email address...");
    if (!(await this.fillIdentifier(page, email))) {
      if (await this.waitForNotebook(page, CONFIG.autoLoginTimeoutMs)) {
        log.success("✅ Automatic login successful");
        await this.saveBrowserState(context, page);
        return true;
      }
      log.warning("⚠️  Email input not detected");
    }

    // Password step (wait until visible)
    let waitAttempts = 0;
    log.warning("  ⏳ Waiting for password page to load...");

    while (Date.now() < deadline && !(await this.fillPassword(page, password))) {
      waitAttempts++;

      // Log every 10 seconds (20 attempts * 0.5s)
      if (waitAttempts % 20 === 0) {
        const secondsWaited = waitAttempts * 0.5;
        const secondsRemaining = (deadline - Date.now()) / 1000;
        log.warning(
          `  ⏳ Still waiting for password field... (${secondsWaited}s elapsed, ${secondsRemaining.toFixed(0)}s remaining)`
        );
        log.info(`  📍 Current URL: ${page.url().slice(0, 100)}`);
      }

      if (page.url().includes("challenge")) {
        log.warning("⚠️  Additional verification required (Google challenge page).");
        return false;
      }
      await page.waitForTimeout(500);
    }

    // Wait for Google redirect after login
    log.info("  🔄 Waiting for Google redirect to NotebookLM...");

    if (await this.waitForRedirectAfterLogin(page, deadline)) {
      log.success("✅ Automatic login successful");
      await this.saveBrowserState(context, page);
      return true;
    }

    // Login failed - diagnose
    log.error("❌ Automatic login timed out");

    // Take screenshot for debugging
    try {
      const screenshotPath = path.join(
        CONFIG.dataDir,
        `login_failed_${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath });
      log.info(`  📸 Screenshot saved: ${screenshotPath}`);
    } catch (error) {
      log.warning(`  ⚠️  Could not save screenshot: ${error}`);
    }

    // Diagnose specific failure reason
    const currentUrl = page.url();
    log.warning("  🔍 Diagnosing failure...");

    if (currentUrl.includes("accounts.google.com")) {
      if (currentUrl.includes("/signin/identifier")) {
        log.error("  ❌ Still on email page - email input might have failed");
        log.info("  💡 Check if email is correct in .env");
      } else if (currentUrl.includes("/challenge")) {
        log.error(
          "  ❌ Google requires additional verification (2FA, CAPTCHA, suspicious login)"
        );
        log.info("  💡 Try logging in manually first: use setup_auth tool");
      } else if (currentUrl.includes("/pwd") || currentUrl.includes("/password")) {
        log.error("  ❌ Still on password page - password input might have failed");
        log.info("  💡 Check if password is correct in .env");
      } else {
        log.error(`  ❌ Stuck on Google accounts page: ${currentUrl.slice(0, 80)}...`);
      }
    } else if (currentUrl.includes("notebooklm.google.com")) {
      log.warning("  ⚠️  Reached NotebookLM but couldn't detect successful login");
      log.info("  💡 This might be a timing issue - try again");
    } else {
      log.error(`  ❌ Unexpected page: ${currentUrl.slice(0, 80)}...`);
    }

    return false;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Wait for Google to redirect to NotebookLM after successful login (SIMPLE & RELIABLE)
   *
   * Just checks if URL changes to notebooklm.google.com - no complex UI element searching!
   * Matches the simplified approach used in performLogin().
   */
  private async waitForRedirectAfterLogin(
    page: Page,
    deadline: number
  ): Promise<boolean> {
    log.info("    ⏳ Waiting for redirect to NotebookLM...");

    while (Date.now() < deadline) {
      try {
        const currentUrl = page.url();

        // Simple check: Are we on NotebookLM?
        if (currentUrl.startsWith("https://notebooklm.google.com/")) {
          log.success("    ✅ NotebookLM URL detected!");
          // Short wait to ensure page is loaded
          await page.waitForTimeout(2000);
          return true;
        }
      } catch {
        // Ignore errors
      }

      await page.waitForTimeout(500);
    }

    log.error("    ❌ Redirect timeout - NotebookLM URL not reached");
    return false;
  }

  /**
   * Wait for NotebookLM to load (SIMPLE & RELIABLE)
   *
   * Just checks if URL starts with notebooklm.google.com - no complex UI element searching!
   * Matches the simplified approach used in performLogin().
   */
  private async waitForNotebook(page: Page, timeoutMs: number): Promise<boolean> {
    const endTime = Date.now() + timeoutMs;

    while (Date.now() < endTime) {
      try {
        const currentUrl = page.url();

        // Simple check: Are we on NotebookLM?
        if (currentUrl.startsWith("https://notebooklm.google.com/")) {
          log.success("  ✅ NotebookLM URL detected");
          return true;
        }
      } catch {
        // Ignore errors
      }

      await page.waitForTimeout(1000);
    }

    return false;
  }

  /**
   * Handle possible account chooser
   */
  private async handleAccountChooser(page: Page, email: string): Promise<boolean> {
    try {
      const chooser = await page.$$("div[data-identifier], li[data-identifier]");

      if (chooser.length > 0) {
        for (const item of chooser) {
          const identifier = (await item.getAttribute("data-identifier"))?.toLowerCase() || "";
          if (identifier === email.toLowerCase()) {
            await item.click();
            await randomDelay(150, 320);
            await page.waitForTimeout(500);
            return true;
          }
        }

        // Click "Use another account"
        await this.clickText(page, [
          "Use another account",
          "Weiteres Konto hinzufügen",
          "Anderes Konto verwenden",
        ]);
        await randomDelay(150, 320);
        return false;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Fill email identifier field with human-like typing
   */
  private async fillIdentifier(page: Page, email: string): Promise<boolean> {
    log.info("    📧 Looking for email field...");

    const emailSelectors = [
      "input#identifierId",
      "input[name='identifier']",
      "input[type='email']",
    ];

    let emailSelector: string | null = null;
    let emailField: any = null;

    for (const selector of emailSelectors) {
      try {
        const candidate = await page.waitForSelector(selector, {
          state: "attached",
          timeout: 3000,
        });
        if (!candidate) continue;

        try {
          if (!(await candidate.isVisible())) {
            continue; // Hidden field
          }
        } catch {
          continue;
        }

        emailField = candidate;
        emailSelector = selector;
        log.success(`    ✅ Email field visible: ${selector}`);
        break;
      } catch {
        continue;
      }
    }

    if (!emailField || !emailSelector) {
      log.warning("    ℹ️  No visible email field found (likely pre-filled)");
      log.info(`    📍 Current URL: ${page.url().slice(0, 100)}`);
      return false;
    }

    // Human-like mouse movement to field
    try {
      const box = await emailField.boundingBox();
      if (box) {
        const targetX = box.x + box.width / 2;
        const targetY = box.y + box.height / 2;
        await randomMouseMovement(page, targetX, targetY);
        await randomDelay(200, 500);
      }
    } catch {
      // Ignore errors
    }

    // Click to focus
    try {
      await realisticClick(page, emailSelector, false);
    } catch (error) {
      log.warning(`    ⚠️  Could not click email field (${error}); trying direct focus`);
      try {
        await emailField.focus();
      } catch {
        log.error("    ❌ Failed to focus email field");
        return false;
      }
    }

    // ✅ FASTER: Programmer typing speed (90-120 WPM from config)
    log.info(`    ⌨️  Typing email: ${this.maskEmail(email)}`);
    try {
      const wpm = CONFIG.typingWpmMin + Math.floor(Math.random() * (CONFIG.typingWpmMax - CONFIG.typingWpmMin + 1));
      await humanType(page, emailSelector, email, { wpm, withTypos: false });
      log.success("    ✅ Email typed successfully");
    } catch (error) {
      log.error(`    ❌ Typing failed: ${error}`);
      try {
        await page.fill(emailSelector, email);
        log.success("    ✅ Filled email using fallback");
      } catch {
        return false;
      }
    }

    // Human "thinking" pause before clicking Next
    await randomDelay(400, 1200);

    // Click Next button
    log.info("    🔘 Looking for Next button...");

    const nextSelectors = [
      "button:has-text('Next')",
      "button:has-text('Weiter')",
      "#identifierNext",
    ];

    let nextClicked = false;
    for (const selector of nextSelectors) {
      try {
        const button = await page.locator(selector);
        if ((await button.count()) > 0) {
          await realisticClick(page, selector, true);
          log.success(`    ✅ Next button clicked: ${selector}`);
          nextClicked = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!nextClicked) {
      log.warning("    ⚠️  Button not found, pressing Enter");
      await emailField.press("Enter");
    }

    // Variable delay
    await randomDelay(800, 1500);
    log.success("    ✅ Email step complete");
    return true;
  }

  /**
   * Fill password field with human-like typing
   */
  private async fillPassword(page: Page, password: string): Promise<boolean> {
    log.info("    🔐 Looking for password field...");

    const passwordSelectors = ["input[name='Passwd']", "input[type='password']"];

    let passwordSelector: string | null = null;
    let passwordField: any = null;

    for (const selector of passwordSelectors) {
      try {
        passwordField = await page.$(selector);
        if (passwordField) {
          passwordSelector = selector;
          log.success(`    ✅ Password field found: ${selector}`);
          break;
        }
      } catch {
        continue;
      }
    }

    if (!passwordField) {
      // Not found yet, but don't fail - this is called in a loop
      return false;
    }

    // Human-like mouse movement to field
    try {
      const box = await passwordField.boundingBox();
      if (box) {
        const targetX = box.x + box.width / 2;
        const targetY = box.y + box.height / 2;
        await randomMouseMovement(page, targetX, targetY);
        await randomDelay(300, 700);
      }
    } catch {
      // Ignore errors
    }

    // Click to focus
    if (passwordSelector) {
      await realisticClick(page, passwordSelector, false);
    }

    // ✅ FASTER: Programmer typing speed (90-120 WPM from config)
    log.info("    ⌨️  Typing password...");
    try {
      const wpm = CONFIG.typingWpmMin + Math.floor(Math.random() * (CONFIG.typingWpmMax - CONFIG.typingWpmMin + 1));
      if (passwordSelector) {
        await humanType(page, passwordSelector, password, { wpm, withTypos: false });
      }
      log.success("    ✅ Password typed successfully");
    } catch (error) {
      log.error(`    ❌ Typing failed: ${error}`);
      return false;
    }

    // Human "review" pause before submitting password
    await randomDelay(300, 1000);

    // Click Next button
    log.info("    🔘 Looking for Next button...");

    const pwdNextSelectors = [
      "button:has-text('Next')",
      "button:has-text('Weiter')",
      "#passwordNext",
    ];

    let pwdNextClicked = false;
    for (const selector of pwdNextSelectors) {
      try {
        const button = await page.locator(selector);
        if ((await button.count()) > 0) {
          await realisticClick(page, selector, true);
          log.success(`    ✅ Next button clicked: ${selector}`);
          pwdNextClicked = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!pwdNextClicked) {
      log.warning("    ⚠️  Button not found, pressing Enter");
      await passwordField.press("Enter");
    }

    // Variable delay
    await randomDelay(800, 1500);
    log.success("    ✅ Password step complete");
    return true;
  }

  /**
   * Click text element
   */
  private async clickText(page: Page, texts: string[]): Promise<boolean> {
    for (const text of texts) {
      const selector = `text="${text}"`;
      try {
        const locator = page.locator(selector);
        if ((await locator.count()) > 0) {
          await realisticClick(page, selector, true);
          await randomDelay(120, 260);
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Mask email for logging
   */
  private maskEmail(email: string): string {
    if (!email.includes("@")) {
      return "***";
    }
    const [name, domain] = email.split("@");
    if (name.length <= 2) {
      return `${"*".repeat(name.length)}@${domain}`;
    }
    return `${name[0]}${"*".repeat(name.length - 2)}${name[name.length - 1]}@${domain}`;
  }

  // ============================================================================
  // Additional Helper Methods
  // ============================================================================

  /**
   * Load authentication state from a specific file path
   */
  async loadAuthState(context: BrowserContext, statePath: string): Promise<boolean> {
    try {
      // Read state.json
      const stateData = await fs.readFile(statePath, { encoding: "utf-8" });
      const state = JSON.parse(stateData);

      // Add cookies to context
      if (state.cookies) {
        await context.addCookies(state.cookies);
        log.success(`✅ Loaded ${state.cookies.length} cookies from ${statePath}`);
        return true;
      }

      log.warning(`⚠️  No cookies found in state file`);
      return false;
    } catch (error) {
      log.error(`❌ Failed to load auth state: ${error}`);
      return false;
    }
  }

  /**
   * Perform interactive setup (for setup_auth tool)
   * Opens a PERSISTENT browser for manual login
   *
   * CRITICAL: Uses the SAME persistent context as runtime!
   * This ensures cookies are automatically saved to the Chrome profile.
   *
   * Benefits over temporary browser:
   * - Session cookies persist correctly (Playwright bug workaround)
   * - Same fingerprint as runtime
   * - No need for addCookies() workarounds
   * - Automatic cookie persistence via Chrome profile
   *
   * @param sendProgress Optional progress callback
   * @param overrideHeadless Optional override for headless mode (true = visible, false = headless)
   *                         If not provided, defaults to true (visible) for setup
   */
  async performSetup(sendProgress?: ProgressCallback, overrideHeadless?: boolean): Promise<boolean> {
    const { chromium } = await import("patchright");

    // Determine headless mode: override or default to true (visible for setup)
    // overrideHeadless contains show_browser value (true = show, false = hide)
    const shouldShowBrowser = overrideHeadless !== undefined ? overrideHeadless : true;

    try {
      // CRITICAL: Clear ALL old auth data FIRST (for account switching)
      log.info("🔄 Preparing for new account authentication...");
      await sendProgress?.("Clearing old authentication data...", 1, 10);
      await this.clearAllAuthData();

      log.info("🚀 Launching persistent browser for interactive setup...");
      log.info(`  📍 Profile: ${CONFIG.chromeProfileDir}`);
      await sendProgress?.("Launching persistent browser...", 2, 10);

      // ✅ CRITICAL FIX: Use launchPersistentContext (same as runtime!)
      // This ensures session cookies persist correctly
      const context = await chromium.launchPersistentContext(
        CONFIG.chromeProfileDir,
        {
          headless: !shouldShowBrowser, // Use override or default to visible for setup
          channel: "chrome" as const,
          viewport: CONFIG.viewport,
          locale: "en-US",
          timezoneId: "Europe/Berlin",
          args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
          ],
        }
      );

      // Get or create a page
      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();

      // Perform login with progress updates
      const loginSuccess = await this.performLogin(page, sendProgress);

      if (loginSuccess) {
        // ✅ Save browser state to state.json (for validation & backup)
        // Chrome ALSO saves everything to the persistent profile automatically!
        await sendProgress?.("Saving authentication state...", 9, 10);
        await this.saveBrowserState(context, page);
        log.success("✅ Setup complete - authentication saved to:");
        log.success(`  📄 State file: ${this.stateFilePath}`);
        log.success(`  📁 Chrome profile: ${CONFIG.chromeProfileDir}`);
        log.info("💡 Session cookies will now persist across restarts!");
      }

      // Close persistent context
      await context.close();

      return loginSuccess;
    } catch (error) {
      log.error(`❌ Setup failed: ${error}`);
      return false;
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear ALL authentication data for account switching
   *
   * CRITICAL: This deletes EVERYTHING to ensure only ONE account is active:
   * - All state.json files (cookies, localStorage)
   * - sessionStorage files
   * - Chrome profile directory (browser fingerprint, cache, etc.)
   *
   * Use this BEFORE authenticating a new account!
   */
  async clearAllAuthData(): Promise<void> {
    log.warning("🗑️  Clearing ALL authentication data for account switch...");

    let deletedCount = 0;

    // 1. Delete all state files in browser_state_dir
    try {
      const files = await fs.readdir(CONFIG.browserStateDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await fs.unlink(path.join(CONFIG.browserStateDir, file));
          log.info(`  ✅ Deleted: ${file}`);
          deletedCount++;
        }
      }
    } catch (error) {
      log.warning(`  ⚠️  Could not delete state files: ${error}`);
    }

    // 2. Delete Chrome profile (THE KEY for account switching!)
    // This removes ALL browser data: cookies, cache, fingerprint, etc.
    try {
      const chromeProfileDir = CONFIG.chromeProfileDir;
      if (existsSync(chromeProfileDir)) {
        await fs.rm(chromeProfileDir, { recursive: true, force: true });
        log.success(`  ✅ Deleted Chrome profile: ${chromeProfileDir}`);
        deletedCount++;
      }
    } catch (error) {
      log.warning(`  ⚠️  Could not delete Chrome profile: ${error}`);
    }

    if (deletedCount === 0) {
      log.info("  ℹ️  No old auth data found (already clean)");
    } else {
      log.success(`✅ All auth data cleared (${deletedCount} items) - ready for new account!`);
    }
  }

  /**
   * Clear all saved authentication state
   */
  async clearState(): Promise<boolean> {
    try {
      try {
        await fs.unlink(this.stateFilePath);
      } catch {
        // File doesn't exist
      }

      try {
        await fs.unlink(this.sessionFilePath);
      } catch {
        // File doesn't exist
      }

      log.success("✅ Authentication state cleared");
      return true;
    } catch (error) {
      log.error(`❌ Failed to clear state: ${error}`);
      return false;
    }
  }

  /**
   * HARD RESET: Completely delete ALL authentication state
   */
  async hardResetState(): Promise<boolean> {
    try {
      log.warning("🧹 Performing HARD RESET of all authentication state...");

      let deletedCount = 0;

      // Delete state file
      try {
        await fs.unlink(this.stateFilePath);
        log.info(`  🗑️  Deleted: ${this.stateFilePath}`);
        deletedCount++;
      } catch {
        // File doesn't exist
      }

      // Delete session file
      try {
        await fs.unlink(this.sessionFilePath);
        log.info(`  🗑️  Deleted: ${this.sessionFilePath}`);
        deletedCount++;
      } catch {
        // File doesn't exist
      }

      // Delete entire browser_state_dir
      try {
        const files = await fs.readdir(CONFIG.browserStateDir);
        for (const file of files) {
          await fs.unlink(path.join(CONFIG.browserStateDir, file));
          deletedCount++;
        }
        log.info(`  🗑️  Deleted: ${CONFIG.browserStateDir}/ (${files.length} files)`);
      } catch {
        // Directory doesn't exist or empty
      }

      if (deletedCount === 0) {
        log.info("  ℹ️  No state to delete (already clean)");
      } else {
        log.success(`✅ Hard reset complete: ${deletedCount} items deleted`);
      }

      return true;
    } catch (error) {
      log.error(`❌ Hard reset failed: ${error}`);
      return false;
    }
  }
}
