/**
 * Shared Context Manager with Persistent Chrome Profile
 *
 * Manages ONE global persistent BrowserContext for ALL sessions.
 * This is critical for avoiding bot detection:
 *
 * - Google tracks browser fingerprints (Canvas, WebGL, Audio, Fonts, etc.)
 * - Multiple contexts = Multiple fingerprints = Suspicious!
 * - ONE persistent context = ONE consistent fingerprint = Normal user
 * - Persistent user_data_dir = SAME fingerprint across all app restarts!
 *
 * Based on the Python implementation from shared_context_manager.py
 */

import type { BrowserContext } from "patchright";
import { chromium } from "patchright";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import { AuthManager } from "../auth/auth-manager.js";
import fs from "fs";
import path from "path";

/**
 * Shared Context Manager
 *
 * Benefits:
 * 1. ONE consistent browser fingerprint for all sessions
 * 2. Fingerprint persists across app restarts (user_data_dir)
 * 3. Mimics real user behavior (one browser, multiple tabs)
 * 4. Google sees: "Same browser since day 1"
 */
export class SharedContextManager {
  private authManager: AuthManager;
  private globalContext: BrowserContext | null = null;
  private contextCreatedAt: number | null = null;
  private currentProfileDir: string | null = null;
  private isIsolatedProfile: boolean = false;
  private currentHeadlessMode: boolean | null = null;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;

    log.info("🌐 SharedContextManager initialized (PERSISTENT MODE)");
    log.info(`  Chrome Profile: ${CONFIG.chromeProfileDir}`);
    log.success("  Fingerprint: PERSISTENT across restarts! 🎯");

    // Cleanup old isolated profiles at startup (best-effort)
    if (CONFIG.cleanupInstancesOnStartup) {
      void this.pruneIsolatedProfiles("startup");
    }
  }

  /**
   * Get the global shared persistent context, or create new if needed
   *
   * Context is recreated only when:
   * - First time (no context exists in this app instance)
   * - Context was closed/invalid
   *
   * Note: Auth expiry does NOT recreate context - we reuse the SAME
   * fingerprint and just re-login!
   *
   * @param overrideHeadless Optional override for headless mode (true = show browser)
   */
  async getOrCreateContext(overrideHeadless?: boolean): Promise<BrowserContext> {
    if (await this.needsRecreation()) {
      log.warning("🔄 Creating/Loading persistent context...");
      await this.recreateContext(overrideHeadless);
    } else {
      log.success("♻️  Reusing existing persistent context");
    }

    return this.globalContext!;
  }

  /**
   * Check if global context needs to be recreated
   */
  private async needsRecreation(): Promise<boolean> {
    // No context exists yet (first time or after manual close)
    if (!this.globalContext) {
      log.info("  ℹ️  No context exists yet");
      return true;
    }

    // Async validity check (will throw if closed)
    try {
      await this.globalContext.cookies();
      log.dim("  ✅ Context still valid (browser open)");
      return false;
    } catch (error) {
      log.warning("  ⚠️  Context appears closed - will recreate");
      this.globalContext = null;
      this.contextCreatedAt = null;
      this.currentHeadlessMode = null;
      return true;
    }
  }

  /**
   * Create/Load the global PERSISTENT context with Chrome user_data_dir
   *
   * This is THE KEY to fingerprint persistence!
   *
   * First time:
   * - Chrome creates new profile in user_data_dir
   * - Generates fingerprint (Canvas, WebGL, Audio, etc.)
   * - Saves everything to disk
   *
   * Subsequent starts:
   * - Chrome loads profile from user_data_dir
   * - SAME fingerprint as before! ✅
   * - Google sees: "Same browser since day 1"
   *
   * @param overrideHeadless Optional override for headless mode (true = show browser)
   */
  private async recreateContext(overrideHeadless?: boolean): Promise<void> {
    // Close old context if exists
    if (this.globalContext) {
      try {
        log.info("  🗑️  Closing old context...");
        await this.globalContext.close();
      } catch (error) {
        log.warning(`  ⚠️  Error closing old context: ${error}`);
      }
    }

    // Check for saved auth
    const statePath = await this.authManager.getValidStatePath();

    if (statePath) {
      log.success(`  📂 Found auth state: ${statePath}`);
      log.info("  💡 Will load cookies into persistent profile");
    } else {
      log.warning("  🆕 No saved auth - fresh persistent profile");
      log.info("  💡 First login will save auth to persistent profile");
    }

    // Determine headless mode: use override if provided, otherwise use CONFIG
    const shouldBeHeadless = overrideHeadless !== undefined ? !overrideHeadless : CONFIG.headless;

    if (overrideHeadless !== undefined) {
      log.info(`  Browser visibility override: ${overrideHeadless ? 'VISIBLE' : 'HEADLESS'}`);
    }

    // Build launch options for persistent context
    // NOTE: userDataDir is passed as first parameter, NOT in options!
    const launchOptions = {
      headless: shouldBeHeadless,
      channel: "chrome" as const,
      viewport: CONFIG.viewport,
      locale: "en-US",
      timezoneId: "Europe/Berlin",
      // ✅ CRITICAL FIX: Pass storageState directly at launch!
      // This is the PROPER way to handle session cookies (Playwright bug workaround)
      // Benefits:
      // - Session cookies persist correctly
      // - No need for addCookies() workarounds
      // - Chrome loads everything automatically
      ...(statePath && { storageState: statePath }),
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    };

    // 🔥 CRITICAL: launchPersistentContext creates/loads Chrome profile
    // Strategy handling for concurrent instances
    const baseProfile = CONFIG.chromeProfileDir;
    const strategy = CONFIG.profileStrategy;
    const tryLaunch = async (userDataDir: string) => {
      log.info("  🚀 Launching persistent Chrome context...");
      log.dim(`  📍 Profile location: ${userDataDir}`);
      if (statePath) {
        log.info(`  📄 Loading auth state: ${statePath}`);
      }
      return chromium.launchPersistentContext(userDataDir, launchOptions);
    };

    try {
      if (strategy === "isolated") {
        const isolatedDir = await this.prepareIsolatedProfileDir(baseProfile);
        this.globalContext = await tryLaunch(isolatedDir);
        this.currentProfileDir = isolatedDir;
        this.isIsolatedProfile = true;
      } else {
        // single or auto → first try base
        this.globalContext = await tryLaunch(baseProfile);
        this.currentProfileDir = baseProfile;
        this.isIsolatedProfile = false;
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      const isSingleton = /ProcessSingleton|SingletonLock|profile is already in use/i.test(msg);
      if (strategy === "single" || !isSingleton) {
        // hard fail
        if (isSingleton && strategy === "single") {
          log.error("❌ Chrome profile already in use and strategy=single. Close other instance or set NOTEBOOK_PROFILE_STRATEGY=auto/isolated.");
        }
        throw e;
      }

      // auto strategy with lock → fall back to isolated instance dir
      log.warning("⚠️  Base Chrome profile in use by another process. Falling back to isolated per-instance profile...");
      const isolatedDir = await this.prepareIsolatedProfileDir(baseProfile);
      this.globalContext = await tryLaunch(isolatedDir);
      this.currentProfileDir = isolatedDir;
      this.isIsolatedProfile = true;
    }
    this.contextCreatedAt = Date.now();
    this.currentHeadlessMode = shouldBeHeadless;
    // Track close event to force recreation next time
    try {
      this.globalContext.on("close", () => {
        log.warning("  🛑 Persistent context was closed externally");
        this.globalContext = null;
        this.contextCreatedAt = null;
        this.currentHeadlessMode = null;
      });
    } catch {}

    // Validate cookies if we loaded state
    if (statePath) {
      try {
        if (await this.authManager.validateCookiesExpiry(this.globalContext)) {
          log.success("  ✅ Authentication state loaded successfully");
          log.success("  🎯 Session cookies persisted correctly!");
        } else {
          log.warning("  ⚠️  Cookies expired - will need re-login");
        }
      } catch (error) {
        log.warning(`  ⚠️  Could not validate auth state: ${error}`);
      }
    }

    log.success("✅ Persistent context ready!");
    log.dim(`  Context ID: ${this.getContextId()}`);
    log.dim(`  Chrome Profile: ${CONFIG.chromeProfileDir}`);
    log.success("  🎯 Fingerprint: PERSISTENT (same across restarts!)");
  }

  /**
   * Manually close the global context (e.g., on shutdown)
   *
   * Note: This closes the context for ALL sessions!
   * Chrome will save everything to user_data_dir automatically.
   */
  async closeContext(): Promise<void> {
    if (this.globalContext) {
      log.warning("🛑 Closing persistent context...");
      log.info("  💾 Chrome is saving profile to disk...");
      try {
        await this.globalContext.close();
        this.globalContext = null;
        this.contextCreatedAt = null;
        this.currentHeadlessMode = null;
        log.success("✅ Persistent context closed");
        log.success(`  💾 Profile saved: ${this.currentProfileDir || CONFIG.chromeProfileDir}`);
      } catch (error) {
        log.error(`❌ Error closing context: ${error}`);
      }
    }

    // Best-effort cleanup on shutdown
    if (CONFIG.cleanupInstancesOnShutdown) {
      try {
        // If this process used an isolated profile, remove it now
        if (this.isIsolatedProfile && this.currentProfileDir) {
          await this.safeRemoveIsolatedProfile(this.currentProfileDir);
        }
      } catch (err) {
        log.warning(`  ⚠️  Cleanup (self) failed: ${err}`);
      }
      try {
        await this.pruneIsolatedProfiles("shutdown");
      } catch (err) {
        log.warning(`  ⚠️  Cleanup (prune) failed: ${err}`);
      }
    }
  }

  private async prepareIsolatedProfileDir(baseProfile: string): Promise<string> {
    const stamp = `${process.pid}-${Date.now()}`;
    const dir = path.join(CONFIG.chromeInstancesDir, `instance-${stamp}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (CONFIG.cloneProfileOnIsolated && fs.existsSync(baseProfile)) {
        log.info("  🧬 Cloning base Chrome profile into isolated instance (may take time)...");
        // Best-effort clone without locks
        await (fs.promises as any).cp(baseProfile, dir, {
          recursive: true,
          errorOnExist: false,
          force: true,
          filter: (src: string) => {
            const bn = path.basename(src);
            return !/^Singleton/i.test(bn) && !bn.endsWith(".lock") && !bn.endsWith(".tmp");
          },
        } as any);
        log.success("  ✅ Clone complete");
      } else {
        log.info("  🧪 Using fresh isolated Chrome profile (no clone)");
      }
    } catch (err) {
      log.warning(`  ⚠️  Could not prepare isolated profile: ${err}`);
    }
    return dir;
  }

  private async pruneIsolatedProfiles(phase: "startup" | "shutdown"): Promise<void> {
    const root = CONFIG.chromeInstancesDir;
    let entries: Array<{ path: string; mtimeMs: number }>; 
    try {
      const names = await fs.promises.readdir(root, { withFileTypes: true });
      entries = [];
      for (const d of names) {
        if (!d.isDirectory()) continue;
        const p = path.join(root, d.name);
        try {
          const st = await fs.promises.stat(p);
          entries.push({ path: p, mtimeMs: st.mtimeMs });
        } catch {}
      }
    } catch {
      return; // directory absent is fine
    }

    if (entries.length === 0) return;

    const now = Date.now();
    const ttlMs = CONFIG.instanceProfileTtlHours * 3600 * 1000;
    const maxCount = Math.max(0, CONFIG.instanceProfileMaxCount);

    // Sort newest first
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const keep: Set<string> = new Set();
    const toDelete: Set<string> = new Set();

    // Keep newest up to maxCount
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const ageMs = now - e.mtimeMs;
      const overTtl = ttlMs > 0 && ageMs > ttlMs;
      const overCount = i >= maxCount;
      const isCurrent = this.currentProfileDir && path.resolve(e.path) === path.resolve(this.currentProfileDir);
      if (!isCurrent && (overTtl || overCount)) {
        toDelete.add(e.path);
      } else {
        keep.add(e.path);
      }
    }

    if (toDelete.size === 0) return;
    log.info(`🧹 Pruning isolated profiles (${phase})...`);
    for (const p of toDelete) {
      try {
        await this.safeRemoveIsolatedProfile(p);
        log.dim(`  🗑️  removed ${p}`);
      } catch (err) {
        log.warning(`  ⚠️  Failed to remove ${p}: ${err}`);
      }
    }
  }

  private async safeRemoveIsolatedProfile(dir: string): Promise<void> {
    // Never remove the base profile
    if (path.resolve(dir) === path.resolve(CONFIG.chromeProfileDir)) return;
    // Only remove within instances root
    if (!path.resolve(dir).startsWith(path.resolve(CONFIG.chromeInstancesDir))) return;
    // Best-effort: try removing typical lock files first, then the directory
    try {
      await fs.promises.rm(dir, { recursive: true, force: true } as any);
    } catch (err) {
      // If rm is not available in older node, fallback to rmdir
      try {
        await (fs.promises as any).rmdir(dir, { recursive: true });
      } catch {}
    }
  }

  /**
   * Get information about the global persistent context
   */
  getContextInfo(): {
    exists: boolean;
    age_seconds?: number;
    age_hours?: number;
    fingerprint_id?: string;
    user_data_dir: string;
    persistent: boolean;
  } {
    if (!this.globalContext) {
      return {
        exists: false,
        user_data_dir: CONFIG.chromeProfileDir,
        persistent: true,
      };
    }

    const ageSeconds = this.contextCreatedAt
      ? (Date.now() - this.contextCreatedAt) / 1000
      : undefined;
    const ageHours = ageSeconds ? ageSeconds / 3600 : undefined;

    return {
      exists: true,
      age_seconds: ageSeconds,
      age_hours: ageHours,
      fingerprint_id: this.getContextId(),
      user_data_dir: CONFIG.chromeProfileDir,
      persistent: true,
    };
  }

  /**
   * Get the current headless mode of the browser context
   *
   * @returns boolean | null - true if headless, false if visible, null if no context exists
   */
  getCurrentHeadlessMode(): boolean | null {
    return this.currentHeadlessMode;
  }

  /**
   * Check if the browser context needs to be recreated due to headless mode change
   *
   * @param overrideHeadless - Optional override for headless mode (true = show browser)
   * @returns boolean - true if context needs to be recreated with new mode
   */
  needsHeadlessModeChange(overrideHeadless?: boolean): boolean {
    // No override specified = no change needed
    if (overrideHeadless === undefined) {
      return false;
    }

    // No context exists yet = will be created with correct mode anyway
    if (this.currentHeadlessMode === null) {
      return false;
    }

    // Calculate target headless mode
    const targetHeadless = !overrideHeadless;

    // Compare with current mode
    const needsChange = this.currentHeadlessMode !== targetHeadless;

    if (needsChange) {
      log.info(`  Browser mode change detected: ${this.currentHeadlessMode ? 'HEADLESS' : 'VISIBLE'} → ${targetHeadless ? 'HEADLESS' : 'VISIBLE'}`);
    }

    return needsChange;
  }

  /**
   * Get context ID for logging
   */
  private getContextId(): string {
    if (!this.globalContext) {
      return "none";
    }
    // Use object hash as ID
    return `ctx-${(this.globalContext as any)._guid || "unknown"}`;
  }
}
