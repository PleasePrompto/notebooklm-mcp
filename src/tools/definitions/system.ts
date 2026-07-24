import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * System / auth / cleanup tools. The cross-tool first-run workflow lives in
 * the server-level `instructions` string (see src/index.ts) so individual
 * descriptions stay focused on what each tool does, not how the suite
 * fits together.
 */
export const systemTools: Tool[] = [
  {
    name: "get_health",
    description:
      "Inspect server state. Returns:\n" +
      "  • `authenticated` — whether saved Google cookies are still valid\n" +
      "  • `notebook_url`, `active_notebook_id`, `active_notebook_name` —\n" +
      "    the currently selected library notebook (or null)\n" +
      "  • `total_notebooks` — library size\n" +
      "  • `active_sessions`, `max_sessions`, `session_timeout` — runtime\n" +
      "    session stats (timeout in seconds; sessions auto-close after this)\n" +
      "  • `headless`, `auto_login_enabled`, `stealth_enabled` — config\n" +
      "Use this first thing in a new conversation. If `authenticated=false`, " +
      "run `setup_auth` (or `re_auth` to switch accounts).",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      title: "Get server health",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "setup_auth",
    description:
      "Open a browser window for first-time Google login. Returns immediately " +
      "after spawning the browser; the user has up to 10 minutes to complete " +
      "sign-in, then cookies are persisted for future runs. Existing profile " +
      "data is preserved; use `re_auth` when a clean login is required.\n\n" +
      "When to use:\n" +
      "  • `get_health` reports `authenticated=false` for the first time\n" +
      "  • Auto-login credentials are not configured\n" +
      "  • `re_auth` is the right call when you want to *switch* accounts " +
      "or recover from a daily-quota lockout\n\n" +
      "After login finishes, call `get_health` to verify success.\n\n" +
      "If the browser session feels broken (auth keeps failing, stale cookies), " +
      "run `cleanup_data(confirm=true, preserve_library=true)` first, then " +
      "retry `setup_auth`.",
    inputSchema: {
      type: "object",
      properties: {
        show_browser: {
          type: "boolean",
          description:
            "Show the browser window. Default: true (must be visible so the " +
            "user can interact). For advanced control use `browser_options`.",
        },
        browser_options: {
          type: "object",
          description:
            "Advanced browser settings. Override visibility, timeout, or " +
            "headless mode (default: visible, 30 s).",
          properties: {
            show: { type: "boolean" },
            headless: { type: "boolean" },
            timeout_ms: { type: "number" },
          },
        },
      },
    },
    annotations: {
      title: "Set up Google authentication",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "re_auth",
    description:
      "Switch to a different Google account or recover from broken auth. " +
      "Closes all active sessions, deletes saved cookies and Chrome profile, " +
      "and opens a fresh login browser.\n\n" +
      "Common triggers:\n" +
      "  • NotebookLM's 50 queries/day free-tier limit is reached and the " +
      "user wants to rotate to another Google account\n" +
      "  • `setup_auth` failed and a clean slate is needed\n\n" +
      "After login, call `get_health` to verify. For very stuck states, run " +
      "`cleanup_data(confirm=true, preserve_library=true)` before `re_auth`.",
    inputSchema: {
      type: "object",
      properties: {
        show_browser: {
          type: "boolean",
          description: "Show the browser window. Default: true.",
        },
        browser_options: {
          type: "object",
          properties: {
            show: { type: "boolean" },
            headless: { type: "boolean" },
            timeout_ms: { type: "number" },
          },
        },
      },
    },
    annotations: {
      title: "Re-authenticate",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "cleanup_data",
    description:
      "Two-phase deep cleanup of all server data on disk (auth state, " +
      "browser profiles, caches, MCP logs, temp backups). Cross-platform " +
      "(Linux/macOS/Windows). Always close all Chrome/Chromium instances " +
      "first — open browsers can lock files.\n\n" +
      "Phase 1 (preview): call with `confirm: false`. Returns a categorised " +
      "list of paths and total size. **No deletion happens.**\n" +
      "Phase 2 (delete): after the user reviews the preview and approves, " +
      "call with `confirm: true`.\n\n" +
      "Set `preserve_library: true` to keep the notebook library file " +
      "(library.json) while wiping everything else — recommended when " +
      "troubleshooting auth.\n\n" +
      "Typical recovery flow:\n" +
      "  1. cleanup_data(confirm=false, preserve_library=true)  // preview\n" +
      "  2. cleanup_data(confirm=true, preserve_library=true)   // execute\n" +
      "  3. setup_auth (or re_auth)",
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description:
            "false = preview only (default). true = actually delete after " +
            "user reviewed the preview.",
        },
        preserve_library: {
          type: "boolean",
          description:
            "Keep notebook library.json while deleting everything else. " +
            "Default: false. Set true when only auth/browser state is broken.",
          default: false,
        },
      },
      required: ["confirm"],
    },
    annotations: {
      title: "Cleanup all data",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
