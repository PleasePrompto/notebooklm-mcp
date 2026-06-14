/**
 * CLI Handler
 *
 * Handles CLI commands for configuration management.
 * Executed when the server is run with 'config' arguments.
 */

import type { ProfileName } from "./settings-manager.js";
import { SettingsManager } from "./settings-manager.js";

export class CliHandler {
  private settingsManager: SettingsManager;

  constructor() {
    this.settingsManager = new SettingsManager();
  }

  async handleCommand(args: string[]): Promise<void> {
    const command = args[0];
    const subCommand = args[1];

    if (command !== "config") {
      return;
    }

    try {
      switch (subCommand) {
        case "set":
          await this.handleSet(args.slice(2));
          break;
        case "get":
          this.handleGet();
          break;
        case "reset":
          await this.handleReset();
          break;
        default:
          this.printHelp();
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  private async handleSet(args: string[]): Promise<void> {
    const key = args[0];
    const value = args[1];

    if (!key || !value) {
      throw new Error("Usage: config set <key> <value>");
    }

    if (key === "profile") {
      if (!["minimal", "standard", "full"].includes(value)) {
        throw new Error("Invalid profile. Allowed: minimal, standard, full");
      }
      await this.settingsManager.saveSettings({ profile: value as ProfileName });
      console.error(`✅ Profile set to: ${value}`);
    } else if (key === "disabled-tools") {
      const tools = value
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      await this.settingsManager.saveSettings({ disabledTools: tools });
      console.error(`✅ Disabled tools set to: ${tools.join(", ") || "(none)"}`);
    } else {
      throw new Error(`Unknown setting: ${key}. Allowed: profile, disabled-tools`);
    }
  }

  private handleGet(): void {
    const settings = this.settingsManager.getEffectiveSettings();
    const profiles = this.settingsManager.getProfiles();

    console.error("🔧 Current Configuration:");
    console.error(`  Profile: ${settings.profile}`);
    console.error(
      `  Disabled Tools: ${settings.disabledTools.length > 0 ? settings.disabledTools.join(", ") : "(none)"}`
    );
    console.error(`  Settings File: ${this.settingsManager.getSettingsPath()}`);
    console.error("");
    console.error("📋 Active Tools in this profile:");

    const activeInProfile = profiles[settings.profile];
    if (activeInProfile.includes("*")) {
      console.error("  - All Tools (except disabled)");
    } else {
      activeInProfile.forEach((t) => console.error(`  - ${t}`));
    }
  }

  private async handleReset(): Promise<void> {
    await this.settingsManager.saveSettings({
      profile: "full",
      disabledTools: [],
    });
    console.error("✅ Configuration reset to defaults (Profile: full, No disabled tools)");
  }

  private printHelp(): void {
    console.error(`
Usage: npx notebooklm-mcp config <command> [args]

Commands:
  config get                       Show current configuration
  config set profile <name>        Set profile (minimal, standard, full)
  config set disabled-tools <list> Set disabled tools (comma-separated)
  config reset                     Reset to default settings

Profiles:
  minimal   Essential read-only tools (low token usage)
  standard  Read + Library management
  full      All tools enabled
    `);
  }
}
