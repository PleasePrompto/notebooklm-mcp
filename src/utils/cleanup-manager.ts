/**
 * Cleanup Manager for NotebookLM MCP Server
 *
 * ULTRATHINK EDITION - Complete cleanup across all platforms!
 *
 * Handles safe removal of:
 * - Legacy data from notebooklm-mcp-nodejs
 * - Current installation data
 * - Browser profiles and session data
 * - NPM/NPX cache
 * - Claude CLI MCP logs
 * - Claude Projects cache
 * - Temporary backups
 * - Editor logs (Cursor, VSCode)
 * - Trash files (optional)
 *
 * Platform support: Linux, Windows, macOS
 */

import fs from "fs/promises";
import path from "path";
import { globby } from "globby";
import envPaths from "env-paths";
import os from "os";
import { log } from "./logger.js";

export type CleanupMode = "legacy" | "all" | "deep";

export interface CleanupResult {
  success: boolean;
  mode: CleanupMode;
  deletedPaths: string[];
  failedPaths: string[];
  totalSizeBytes: number;
  categorySummary: Record<string, { count: number; bytes: number }>;
}

export interface CleanupCategory {
  name: string;
  description: string;
  paths: string[];
  totalBytes: number;
  optional: boolean;
}

interface Paths {
  data: string;
  config: string;
  cache: string;
  log: string;
  temp: string;
}

export class CleanupManager {
  private legacyPaths: Paths;
  private currentPaths: Paths;
  private homeDir: string;
  private tempDir: string;

  constructor() {
    // envPaths() does NOT create directories - it just returns path strings
    // IMPORTANT: envPaths() has a default suffix 'nodejs', so we must explicitly disable it!

    // Legacy paths with -nodejs suffix (using default suffix behavior)
    this.legacyPaths = envPaths("notebooklm-mcp");  // This becomes notebooklm-mcp-nodejs by default
    // Current paths without suffix (disable the default suffix with empty string)
    this.currentPaths = envPaths("notebooklm-mcp", {suffix: ""});
    // Platform-agnostic paths
    this.homeDir = os.homedir();
    this.tempDir = os.tmpdir();
  }

  // ============================================================================
  // Platform-Specific Path Resolution
  // ============================================================================

  /**
   * Get NPM cache directory (platform-specific)
   */
  private getNpmCachePath(): string {
    return path.join(this.homeDir, ".npm");
  }

  /**
   * Get Claude CLI cache directory (platform-specific)
   */
  private getClaudeCliCachePath(): string {
    const platform = process.platform;

    if (platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || path.join(this.homeDir, "AppData", "Local");
      return path.join(localAppData, "claude-cli-nodejs");
    } else if (platform === "darwin") {
      return path.join(this.homeDir, "Library", "Caches", "claude-cli-nodejs");
    } else {
      // Linux and others
      return path.join(this.homeDir, ".cache", "claude-cli-nodejs");
    }
  }

  /**
   * Get Claude projects directory (platform-specific)
   */
  private getClaudeProjectsPath(): string {
    const platform = process.platform;

    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(this.homeDir, "AppData", "Roaming");
      return path.join(appData, ".claude", "projects");
    } else if (platform === "darwin") {
      return path.join(this.homeDir, "Library", "Application Support", "claude", "projects");
    } else {
      // Linux and others
      return path.join(this.homeDir, ".claude", "projects");
    }
  }

  /**
   * Get editor config paths (Cursor, VSCode)
   */
  private getEditorConfigPaths(): string[] {
    const platform = process.platform;
    const paths: string[] = [];

    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(this.homeDir, "AppData", "Roaming");
      paths.push(
        path.join(appData, "Cursor", "logs"),
        path.join(appData, "Code", "logs")
      );
    } else if (platform === "darwin") {
      paths.push(
        path.join(this.homeDir, "Library", "Application Support", "Cursor", "logs"),
        path.join(this.homeDir, "Library", "Application Support", "Code", "logs")
      );
    } else {
      // Linux
      paths.push(
        path.join(this.homeDir, ".config", "Cursor", "logs"),
        path.join(this.homeDir, ".config", "Code", "logs")
      );
    }

    return paths;
  }

  /**
   * Get trash directory (platform-specific)
   */
  private getTrashPath(): string | null {
    const platform = process.platform;

    if (platform === "darwin") {
      return path.join(this.homeDir, ".Trash");
    } else if (platform === "linux") {
      return path.join(this.homeDir, ".local", "share", "Trash");
    } else {
      // Windows Recycle Bin is complex, skip for now
      return null;
    }
  }

  /**
   * Get manual legacy config paths that might not be caught by envPaths
   * This ensures we catch ALL legacy installations including old config.json files
   */
  private getManualLegacyPaths(): string[] {
    const paths: string[] = [];
    const platform = process.platform;

    if (platform === "linux") {
      // Linux-specific paths
      paths.push(
        path.join(this.homeDir, ".config", "notebooklm-mcp"),
        path.join(this.homeDir, ".config", "notebooklm-mcp-nodejs"),
        path.join(this.homeDir, ".local", "share", "notebooklm-mcp"),
        path.join(this.homeDir, ".local", "share", "notebooklm-mcp-nodejs"),
        path.join(this.homeDir, ".cache", "notebooklm-mcp"),
        path.join(this.homeDir, ".cache", "notebooklm-mcp-nodejs"),
        path.join(this.homeDir, ".local", "state", "notebooklm-mcp"),
        path.join(this.homeDir, ".local", "state", "notebooklm-mcp-nodejs")
      );
    } else if (platform === "darwin") {
      // macOS-specific paths
      paths.push(
        path.join(this.homeDir, "Library", "Application Support", "notebooklm-mcp"),
        path.join(this.homeDir, "Library", "Application Support", "notebooklm-mcp-nodejs"),
        path.join(this.homeDir, "Library", "Preferences", "notebooklm-mcp"),
        path.join(this.homeDir, "Library", "Preferences", "notebooklm-mcp-nodejs"),
        path.join(this.homeDir, "Library", "Caches", "notebooklm-mcp"),
        path.join(this.homeDir, "Library", "Caches", "notebooklm-mcp-nodejs"),
        path.join(this.homeDir, "Library", "Logs", "notebooklm-mcp"),
        path.join(this.homeDir, "Library", "Logs", "notebooklm-mcp-nodejs")
      );
    } else if (platform === "win32") {
      // Windows-specific paths
      const localAppData = process.env.LOCALAPPDATA || path.join(this.homeDir, "AppData", "Local");
      const appData = process.env.APPDATA || path.join(this.homeDir, "AppData", "Roaming");
      paths.push(
        path.join(localAppData, "notebooklm-mcp"),
        path.join(localAppData, "notebooklm-mcp-nodejs"),
        path.join(appData, "notebooklm-mcp"),
        path.join(appData, "notebooklm-mcp-nodejs")
      );
    }

    return paths;
  }

  // ============================================================================
  // Search Methods for Different File Types
  // ============================================================================

  /**
   * Find NPM/NPX cache files
   */
  private async findNpmCache(): Promise<string[]> {
    const found: string[] = [];

    try {
      const npmCachePath = this.getNpmCachePath();
      const npxPath = path.join(npmCachePath, "_npx");

      if (!(await this.pathExists(npxPath))) {
        return found;
      }

      // Search for notebooklm-mcp in npx cache
      const pattern = path.join(npxPath, "*/node_modules/notebooklm-mcp");
      const matches = await globby(pattern, { onlyDirectories: true, absolute: true });
      found.push(...matches);
    } catch (error) {
      log.warning(`⚠️  Error searching NPM cache: ${error}`);
    }

    return found;
  }

  /**
   * Find Claude CLI MCP logs
   */
  private async findClaudeCliLogs(): Promise<string[]> {
    const found: string[] = [];

    try {
      const claudeCliPath = this.getClaudeCliCachePath();

      if (!(await this.pathExists(claudeCliPath))) {
        return found;
      }

      // Search for notebooklm MCP logs
      const patterns = [
        path.join(claudeCliPath, "*/mcp-logs-notebooklm"),
        path.join(claudeCliPath, "*notebooklm-mcp*"),
      ];

      for (const pattern of patterns) {
        const matches = await globby(pattern, { onlyDirectories: true, absolute: true });
        found.push(...matches);
      }
    } catch (error) {
      log.warning(`⚠️  Error searching Claude CLI cache: ${error}`);
    }

    return found;
  }

  /**
   * Find Claude projects cache
   */
  private async findClaudeProjects(): Promise<string[]> {
    const found: string[] = [];

    try {
      const projectsPath = this.getClaudeProjectsPath();

      if (!(await this.pathExists(projectsPath))) {
        return found;
      }

      // Search for notebooklm-mcp projects
      const pattern = path.join(projectsPath, "*notebooklm-mcp*");
      const matches = await globby(pattern, { onlyDirectories: true, absolute: true });
      found.push(...matches);
    } catch (error) {
      log.warning(`⚠️  Error searching Claude projects: ${error}`);
    }

    return found;
  }

  /**
   * Find temporary backups
   */
  private async findTemporaryBackups(): Promise<string[]> {
    const found: string[] = [];

    try {
      // Search for notebooklm backup directories in temp
      const pattern = path.join(this.tempDir, "notebooklm-backup-*");
      const matches = await globby(pattern, { onlyDirectories: true, absolute: true });
      found.push(...matches);
    } catch (error) {
      log.warning(`⚠️  Error searching temp backups: ${error}`);
    }

    return found;
  }

  /**
   * Find editor logs (Cursor, VSCode)
   */
  private async findEditorLogs(): Promise<string[]> {
    const found: string[] = [];

    try {
      const editorPaths = this.getEditorConfigPaths();

      for (const editorPath of editorPaths) {
        if (!(await this.pathExists(editorPath))) {
          continue;
        }

        // Search for MCP notebooklm logs
        const pattern = path.join(editorPath, "**/exthost/**/*notebooklm*.log");
        const matches = await globby(pattern, { onlyFiles: true, absolute: true });
        found.push(...matches);
      }
    } catch (error) {
      log.warning(`⚠️  Error searching editor logs: ${error}`);
    }

    return found;
  }

  /**
   * Find trash files
   */
  private async findTrashFiles(): Promise<string[]> {
    const found: string[] = [];

    try {
      const trashPath = this.getTrashPath();
      if (!trashPath || !(await this.pathExists(trashPath))) {
        return found;
      }

      // Search for notebooklm files in trash
      const patterns = [
        path.join(trashPath, "**/*notebooklm*"),
      ];

      for (const pattern of patterns) {
        const matches = await globby(pattern, { absolute: true });
        found.push(...matches);
      }
    } catch (error) {
      log.warning(`⚠️  Error searching trash: ${error}`);
    }

    return found;
  }

  // ============================================================================
  // Main Cleanup Methods
  // ============================================================================

  /**
   * Get all paths that would be deleted for a given mode (with categorization)
   */
  async getCleanupPaths(
    mode: CleanupMode,
    preserveLibrary: boolean = false
  ): Promise<{
    categories: CleanupCategory[];
    totalPaths: string[];
    totalSizeBytes: number;
  }> {
    const categories: CleanupCategory[] = [];
    const allPaths: Set<string> = new Set();
    let totalSizeBytes = 0;

    // Category 1: Legacy Paths (notebooklm-mcp-nodejs & manual legacy paths)
    if (mode === "legacy" || mode === "all" || mode === "deep") {
      const legacyPaths: string[] = [];
      let legacyBytes = 0;

      // Check envPaths-based legacy directories
      const legacyDirs = [
        this.legacyPaths.data,
        this.legacyPaths.config,
        this.legacyPaths.cache,
        this.legacyPaths.log,
        this.legacyPaths.temp,
      ];

      for (const dir of legacyDirs) {
        if (await this.pathExists(dir)) {
          const size = await this.getDirectorySize(dir);
          legacyPaths.push(dir);
          legacyBytes += size;
          allPaths.add(dir);
        }
      }

      // CRITICAL: Also check manual legacy paths to catch old config.json files
      // and any paths that envPaths might miss
      const manualLegacyPaths = this.getManualLegacyPaths();
      for (const dir of manualLegacyPaths) {
        if (await this.pathExists(dir) && !allPaths.has(dir)) {
          const size = await this.getDirectorySize(dir);
          legacyPaths.push(dir);
          legacyBytes += size;
          allPaths.add(dir);
        }
      }

      if (legacyPaths.length > 0) {
        categories.push({
          name: "Legacy Installation (notebooklm-mcp-nodejs)",
          description: "Old installation data with -nodejs suffix and legacy config files",
          paths: legacyPaths,
          totalBytes: legacyBytes,
          optional: false,
        });
        totalSizeBytes += legacyBytes;
      }
    }

    // Category 2: Current Installation
    if (mode === "all" || mode === "deep") {
      const currentPaths: string[] = [];
      let currentBytes = 0;

      // If preserveLibrary is true, don't delete the data directory itself
      // Instead, only delete subdirectories
      const currentDirs = preserveLibrary
        ? [
            // Don't include data directory to preserve library.json
            this.currentPaths.config,
            this.currentPaths.cache,
            this.currentPaths.log,
            this.currentPaths.temp,
            // Only delete subdirectories, not the parent
            path.join(this.currentPaths.data, "browser_state"),
            path.join(this.currentPaths.data, "chrome_profile"),
            path.join(this.currentPaths.data, "chrome_profile_instances"),
          ]
        : [
            // Delete everything including data directory
            this.currentPaths.data,
            this.currentPaths.config,
            this.currentPaths.cache,
            this.currentPaths.log,
            this.currentPaths.temp,
            // Specific subdirectories (only if parent doesn't exist)
            path.join(this.currentPaths.data, "browser_state"),
            path.join(this.currentPaths.data, "chrome_profile"),
            path.join(this.currentPaths.data, "chrome_profile_instances"),
          ];

      for (const dir of currentDirs) {
        if (await this.pathExists(dir) && !allPaths.has(dir)) {
          const size = await this.getDirectorySize(dir);
          currentPaths.push(dir);
          currentBytes += size;
          allPaths.add(dir);
        }
      }

      if (currentPaths.length > 0) {
        const description = preserveLibrary
          ? "Active installation data and browser profiles (library.json will be preserved)"
          : "Active installation data and browser profiles";

        categories.push({
          name: "Current Installation (notebooklm-mcp)",
          description,
          paths: currentPaths,
          totalBytes: currentBytes,
          optional: false,
        });
        totalSizeBytes += currentBytes;
      }
    }

    // Category 3: NPM Cache
    if (mode === "all" || mode === "deep") {
      const npmPaths = await this.findNpmCache();
      if (npmPaths.length > 0) {
        let npmBytes = 0;
        for (const p of npmPaths) {
          if (!allPaths.has(p)) {
            npmBytes += await this.getDirectorySize(p);
            allPaths.add(p);
          }
        }

        if (npmBytes > 0) {
          categories.push({
            name: "NPM/NPX Cache",
            description: "NPX cached installations of notebooklm-mcp",
            paths: npmPaths,
            totalBytes: npmBytes,
            optional: false,
          });
          totalSizeBytes += npmBytes;
        }
      }
    }

    // Category 4: Claude CLI Logs
    if (mode === "all" || mode === "deep") {
      const claudeCliPaths = await this.findClaudeCliLogs();
      if (claudeCliPaths.length > 0) {
        let claudeCliBytes = 0;
        for (const p of claudeCliPaths) {
          if (!allPaths.has(p)) {
            claudeCliBytes += await this.getDirectorySize(p);
            allPaths.add(p);
          }
        }

        if (claudeCliBytes > 0) {
          categories.push({
            name: "Claude CLI MCP Logs",
            description: "MCP server logs from Claude CLI",
            paths: claudeCliPaths,
            totalBytes: claudeCliBytes,
            optional: false,
          });
          totalSizeBytes += claudeCliBytes;
        }
      }
    }

    // Category 5: Temporary Backups
    if (mode === "all" || mode === "deep") {
      const backupPaths = await this.findTemporaryBackups();
      if (backupPaths.length > 0) {
        let backupBytes = 0;
        for (const p of backupPaths) {
          if (!allPaths.has(p)) {
            backupBytes += await this.getDirectorySize(p);
            allPaths.add(p);
          }
        }

        if (backupBytes > 0) {
          categories.push({
            name: "Temporary Backups",
            description: "Temporary backup directories in system temp",
            paths: backupPaths,
            totalBytes: backupBytes,
            optional: false,
          });
          totalSizeBytes += backupBytes;
        }
      }
    }

    // Category 6: Claude Projects (deep mode only)
    if (mode === "deep") {
      const projectPaths = await this.findClaudeProjects();
      if (projectPaths.length > 0) {
        let projectBytes = 0;
        for (const p of projectPaths) {
          if (!allPaths.has(p)) {
            projectBytes += await this.getDirectorySize(p);
            allPaths.add(p);
          }
        }

        if (projectBytes > 0) {
          categories.push({
            name: "Claude Projects Cache",
            description: "Project-specific cache in Claude config",
            paths: projectPaths,
            totalBytes: projectBytes,
            optional: true,
          });
          totalSizeBytes += projectBytes;
        }
      }
    }

    // Category 7: Editor Logs (deep mode only)
    if (mode === "deep") {
      const editorPaths = await this.findEditorLogs();
      if (editorPaths.length > 0) {
        let editorBytes = 0;
        for (const p of editorPaths) {
          if (!allPaths.has(p)) {
            editorBytes += await this.getFileSize(p);
            allPaths.add(p);
          }
        }

        if (editorBytes > 0) {
          categories.push({
            name: "Editor Logs (Cursor/VSCode)",
            description: "MCP logs from code editors",
            paths: editorPaths,
            totalBytes: editorBytes,
            optional: true,
          });
          totalSizeBytes += editorBytes;
        }
      }
    }

    // Category 8: Trash Files (deep mode only)
    if (mode === "deep") {
      const trashPaths = await this.findTrashFiles();
      if (trashPaths.length > 0) {
        let trashBytes = 0;
        for (const p of trashPaths) {
          if (!allPaths.has(p)) {
            trashBytes += await this.getFileSize(p);
            allPaths.add(p);
          }
        }

        if (trashBytes > 0) {
          categories.push({
            name: "Trash Files",
            description: "Deleted notebooklm files in system trash",
            paths: trashPaths,
            totalBytes: trashBytes,
            optional: true,
          });
          totalSizeBytes += trashBytes;
        }
      }
    }

    return {
      categories,
      totalPaths: Array.from(allPaths),
      totalSizeBytes,
    };
  }

  /**
   * Perform cleanup with safety checks and detailed reporting
   */
  async performCleanup(
    mode: CleanupMode,
    preserveLibrary: boolean = false
  ): Promise<CleanupResult> {
    log.info(`🧹 Starting cleanup in "${mode}" mode...`);
    if (preserveLibrary) {
      log.info(`📚 Library preservation enabled - library.json will be kept!`);
    }

    const { categories, totalSizeBytes } = await this.getCleanupPaths(mode, preserveLibrary);
    const deletedPaths: string[] = [];
    const failedPaths: string[] = [];
    const categorySummary: Record<string, { count: number; bytes: number }> = {};

    // Delete by category
    for (const category of categories) {
      log.info(`\n📦 ${category.name} (${category.paths.length} items, ${this.formatBytes(category.totalBytes)})`);

      if (category.optional) {
        log.warning(`  ⚠️  Optional category - ${category.description}`);
      }

      let categoryDeleted = 0;
      let categoryBytes = 0;

      for (const itemPath of category.paths) {
        try {
          if (await this.pathExists(itemPath)) {
            const size = await this.getDirectorySize(itemPath);
            log.info(`  🗑️  Deleting: ${itemPath}`);
            await fs.rm(itemPath, { recursive: true, force: true });
            deletedPaths.push(itemPath);
            categoryDeleted++;
            categoryBytes += size;
            log.success(`  ✅ Deleted: ${itemPath} (${this.formatBytes(size)})`);
          }
        } catch (error) {
          log.error(`  ❌ Failed to delete: ${itemPath} - ${error}`);
          failedPaths.push(itemPath);
        }
      }

      categorySummary[category.name] = {
        count: categoryDeleted,
        bytes: categoryBytes,
      };
    }

    const success = failedPaths.length === 0;

    if (success) {
      log.success(`\n✅ Cleanup complete! Deleted ${deletedPaths.length} items (${this.formatBytes(totalSizeBytes)})`);
    } else {
      log.warning(`\n⚠️  Cleanup completed with ${failedPaths.length} errors`);
      log.success(`  Deleted: ${deletedPaths.length} items`);
      log.error(`  Failed: ${failedPaths.length} items`);
    }

    return {
      success,
      mode,
      deletedPaths,
      failedPaths,
      totalSizeBytes,
      categorySummary,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Check if a path exists
   */
  private async pathExists(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the size of a single file
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Get the total size of a directory (recursive)
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        return stats.size;
      }

      let totalSize = 0;
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const fileStats = await fs.stat(filePath);

        if (fileStats.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        } else {
          totalSize += fileStats.size;
        }
      }

      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * Format bytes to human-readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * Get platform-specific path info
   */
  getPlatformInfo(): {
    platform: string;
    legacyBasePath: string;
    currentBasePath: string;
    npmCachePath: string;
    claudeCliCachePath: string;
    claudeProjectsPath: string;
  } {
    const platform = process.platform;
    let platformName = "Unknown";

    switch (platform) {
      case "win32":
        platformName = "Windows";
        break;
      case "darwin":
        platformName = "macOS";
        break;
      case "linux":
        platformName = "Linux";
        break;
    }

    return {
      platform: platformName,
      legacyBasePath: this.legacyPaths.data,
      currentBasePath: this.currentPaths.data,
      npmCachePath: this.getNpmCachePath(),
      claudeCliCachePath: this.getClaudeCliCachePath(),
      claudeProjectsPath: this.getClaudeProjectsPath(),
    };
  }
}
