/**
 * Settings Manager
 *
 * Handles persistent configuration for the NotebookLM MCP Server.
 * Manages profiles, disabled tools, and environment variable overrides.
 */

import fs from "fs/promises";
import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export type ProfileName = "minimal" | "standard" | "full";

export interface Settings {
  profile: ProfileName;
  disabledTools: string[];
  customSettings?: Record<string, unknown>;
}

const DEFAULT_SETTINGS: Settings = {
  profile: "full",
  disabledTools: [],
};

const settingsSchema = z.object({
  profile: z.enum(["minimal", "standard", "full"]).default("full"),
  disabledTools: z.array(z.string()).default([]),
  customSettings: z.record(z.unknown()).optional(),
});

function isProfileName(value: string | undefined): value is ProfileName {
  return value === "minimal" || value === "standard" || value === "full";
}

const PROFILES: Record<ProfileName, string[]> = {
  minimal: [
    "ask_question",
    "get_health",
    "list_notebooks",
    "select_notebook",
    "get_notebook", // Added as it is read-only and useful
  ],
  standard: [
    "ask_question",
    "get_health",
    "list_notebooks",
    "select_notebook",
    "get_notebook",
    "setup_auth",
    "list_sessions",
    "add_notebook",
    "update_notebook",
    "search_notebooks",
  ],
  full: ["*"], // All tools
};

export class SettingsManager {
  private settingsPath: string;
  private settings: Settings;

  constructor() {
    // Use the config directory from env-paths defined in config.ts
    this.settingsPath = path.join(CONFIG.configDir, "settings.json");
    this.settings = this.loadSettings();
  }

  /**
   * Load settings from file, falling back to defaults
   */
  private loadSettings(): Settings {
    try {
      // Ensure config dir exists
      if (!existsSync(CONFIG.configDir)) {
        mkdirSync(CONFIG.configDir, { recursive: true });
      }

      if (existsSync(this.settingsPath)) {
        // Synchronous read keeps the constructor simple — settings are tiny
        // and we need them before any tool dispatch can happen.
        const data = readFileSync(this.settingsPath, "utf-8");
        return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(data) });
      }
    } catch (error) {
      log.warning(`⚠️  Failed to load settings: ${error}. Using defaults.`);
    }
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * Save current settings to file
   */
  async saveSettings(newSettings: Partial<Settings>): Promise<void> {
    const previousSettings = this.settings;
    const nextSettings = settingsSchema.parse({ ...this.settings, ...newSettings });
    const temporaryPath = `${this.settingsPath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(nextSettings, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      await fs.rename(temporaryPath, this.settingsPath);
      this.settings = nextSettings;
    } catch (error) {
      this.settings = previousSettings;
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new Error(`Failed to save settings: ${error}`, { cause: error });
    }
  }

  /**
   * Get effective configuration (merging File settings with Env Vars)
   */
  getEffectiveSettings(): Settings {
    const envProfileRaw = process.env.NOTEBOOKLM_PROFILE;
    const envProfile = isProfileName(envProfileRaw) ? envProfileRaw : undefined;
    const envDisabled = process.env.NOTEBOOKLM_DISABLED_TOOLS;

    const effectiveProfile = envProfile ?? this.settings.profile;

    let effectiveDisabled = [...this.settings.disabledTools];
    if (envDisabled) {
      const envDisabledList = envDisabled.split(",").map((t) => t.trim());
      effectiveDisabled = [...new Set([...effectiveDisabled, ...envDisabledList])];
    }

    return {
      profile: effectiveProfile,
      disabledTools: effectiveDisabled,
      customSettings: this.settings.customSettings,
    };
  }

  /**
   * Filter tools based on effective configuration
   */
  filterTools(allTools: Tool[]): Tool[] {
    const { profile, disabledTools } = this.getEffectiveSettings();
    const allowedTools = PROFILES[profile];

    return allTools.filter((tool) => {
      // 1. Check if allowed by profile (unless profile is full/wildcard)
      if (!allowedTools.includes("*") && !allowedTools.includes(tool.name)) {
        return false;
      }

      // 2. Check if explicitly disabled
      if (disabledTools.includes(tool.name)) {
        return false;
      }

      return true;
    });
  }

  getSettingsPath(): string {
    return this.settingsPath;
  }

  getProfiles(): Record<ProfileName, string[]> {
    return PROFILES;
  }
}
