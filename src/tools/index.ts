/**
 * MCP Tool Implementations
 *
 * Implements all MCP tools for NotebookLM integration:
 * - ask_question: Ask NotebookLM with session support
 * - list_sessions: List all active sessions
 * - close_session: Close a specific session
 * - reset_session: Reset session chat history
 * - get_health: Server health check
 * - setup_auth: Interactive authentication setup
 *
 * Based on the Python implementation from tools/*.py
 */

import { SessionManager } from "../session/session-manager.js";
import { AuthManager } from "../auth/auth-manager.js";
import { NotebookLibrary } from "../library/notebook-library.js";
import type { AddNotebookInput, UpdateNotebookInput } from "../library/types.js";
import { CONFIG, applyBrowserOptions, type BrowserOptions } from "../config.js";
import { log } from "../utils/logger.js";
import type {
  AskQuestionResult,
  ToolResult,
  Tool,
  ProgressCallback,
} from "../types.js";
import { RateLimitError } from "../errors.js";
import { CleanupManager } from "../utils/cleanup-manager.js";

const FOLLOW_UP_REMINDER =
  "\n\nEXTREMELY IMPORTANT: Is that ALL you need to know? You can always ask another question using the same session ID! Think about it carefully: before you reply to the user, review their original request and this answer. If anything is still unclear or missing, ask me another question first.";

/**
 * Build dynamic tool description for ask_question based on active notebook or library
 */
function buildAskQuestionDescription(library: NotebookLibrary): string {
  const active = library.getActiveNotebook();

  if (active) {
    const topics = active.topics.join(", ");
    const useCases = active.use_cases.map((uc) => `  - ${uc}`).join("\n");

    return `# Conversational Research Partner (NotebookLM • Gemini 2.5 • Session RAG)

**Active Notebook:** ${active.name}
**Content:** ${active.description}
**Topics:** ${topics}

> Auth tip: If login is required, use the prompt 'notebooklm.auth-setup' and then verify with the 'get_health' tool. If authentication later fails (e.g., expired cookies), use the prompt 'notebooklm.auth-repair'.

## What This Tool Is
- Full conversational research with Gemini (LLM) grounded on your notebook sources
- Session-based: each follow-up uses prior context for deeper, more precise answers
- Source-cited responses designed to minimize hallucinations

## When To Use
${useCases}

## Rules (Important)
- Always prefer continuing an existing session for the same task
- If you start a new thread, create a new session and keep its session_id
- Ask clarifying questions before implementing; do not guess missing details
- If multiple notebooks could apply, propose the top 1–2 and ask which to use
- If task context changes, ask to reset the session or switch notebooks
- If authentication fails, use the prompts 'notebooklm.auth-repair' (or 'notebooklm.auth-setup') and verify with 'get_health'
- After every NotebookLM answer: pause, compare with the user's goal, and only respond if you are 100% sure the information is complete. Otherwise, plan the next NotebookLM question in the same session.

## Session Flow (Recommended)
\`\`\`javascript
// 1) Start broad (no session_id → creates one)
ask_question({ question: "Give me an overview of [topic]" })
// ← Save: result.session_id

// 2) Go specific (same session)
ask_question({ question: "Key APIs/methods?", session_id })

// 3) Cover pitfalls (same session)
ask_question({ question: "Common edge cases + gotchas?", session_id })

// 4) Ask for production example (same session)
ask_question({ question: "Show a production-ready example", session_id })
\`\`\`

## Automatic Multi-Pass Strategy (Host-driven)
- Simple prompts return once-and-done answers.
- For complex prompts, the host should issue follow-up calls:
  1. Implementation plan (APIs, dependencies, configuration, authentication).
  2. Pitfalls, gaps, validation steps, missing prerequisites.
- Keep the same session_id for all follow-ups, review NotebookLM's answer, and ask more questions until the problem is fully resolved.
- Before replying to the user, double-check: do you truly have everything? If not, queue another ask_question immediately.

## 🔥 REAL EXAMPLE

Task: "Implement error handling in n8n workflow"

Bad (shallow):
\`\`\`
Q: "How do I handle errors in n8n?"
A: [basic answer]
→ Implement → Probably missing edge cases!
\`\`\`

Good (deep):
\`\`\`
Q1: "What are n8n's error handling mechanisms?" (session created)
A1: [Overview of error handling]

Q2: "What's the recommended pattern for API errors?" (same session)
A2: [Specific patterns, uses context from Q1]

Q3: "How do I handle retry logic and timeouts?" (same session)
A3: [Detailed approach, builds on Q1+Q2]

Q4: "Show me a production example with all these patterns" (same session)
A4: [Complete example with full context]

→ NOW implement with confidence!
\`\`\`
    
## Notebook Selection
- Default: active notebook (${active.id})
- Or set notebook_id to use a library notebook
- Or set notebook_url for ad-hoc notebooks (not in library)
- If ambiguous which notebook fits, ASK the user which to use`;
  } else {
    return `# Conversational Research Partner (NotebookLM • Gemini 2.5 • Session RAG)

## No Active Notebook
- Visit https://notebooklm.google to create a notebook and get a share link
- Use **add_notebook** to add it to your library (explains how to get the link)
- Use **list_notebooks** to show available sources
- Use **select_notebook** to set one active

> Auth tip: If login is required, use the prompt 'notebooklm.auth-setup' and then verify with the 'get_health' tool. If authentication later fails (e.g., expired cookies), use the prompt 'notebooklm.auth-repair'.

Tip: Tell the user you can manage NotebookLM library and ask which notebook to use for the current task.`;
  }
}

/**
 * Build Tool Definitions with NotebookLibrary context
 */
export function buildToolDefinitions(library: NotebookLibrary): Tool[] {
  return [
    {
      name: "ask_question",
      description: buildAskQuestionDescription(library),
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask NotebookLM",
          },
          session_id: {
            type: "string",
            description:
              "Optional session ID for contextual conversations. If omitted, a new session is created.",
          },
          notebook_id: {
            type: "string",
            description:
              "Optional notebook ID from your library. If omitted, uses the active notebook. " +
              "Use list_notebooks to see available notebooks.",
          },
          notebook_url: {
            type: "string",
            description:
              "Optional notebook URL (overrides notebook_id). Use this for ad-hoc queries to notebooks not in your library.",
          },
          show_browser: {
            type: "boolean",
            description:
              "Show browser window for debugging (simple version). " +
              "For advanced control (typing speed, stealth, etc.), use browser_options instead.",
          },
          browser_options: {
            type: "object",
            description:
              "Optional browser behavior settings. Claude can control everything: " +
              "visibility, typing speed, stealth mode, timeouts. Useful for debugging or fine-tuning.",
            properties: {
              show: {
                type: "boolean",
                description: "Show browser window (default: from ENV or false)",
              },
              headless: {
                type: "boolean",
                description: "Run browser in headless mode (default: true)",
              },
              timeout_ms: {
                type: "number",
                description: "Browser operation timeout in milliseconds (default: 30000)",
              },
              stealth: {
                type: "object",
                description: "Human-like behavior settings to avoid detection",
                properties: {
                  enabled: {
                    type: "boolean",
                    description: "Master switch for all stealth features (default: true)",
                  },
                  random_delays: {
                    type: "boolean",
                    description: "Random delays between actions (default: true)",
                  },
                  human_typing: {
                    type: "boolean",
                    description: "Human-like typing patterns (default: true)",
                  },
                  mouse_movements: {
                    type: "boolean",
                    description: "Realistic mouse movements (default: true)",
                  },
                  typing_wpm_min: {
                    type: "number",
                    description: "Minimum typing speed in WPM (default: 160)",
                  },
                  typing_wpm_max: {
                    type: "number",
                    description: "Maximum typing speed in WPM (default: 240)",
                  },
                  delay_min_ms: {
                    type: "number",
                    description: "Minimum delay between actions in ms (default: 100)",
                  },
                  delay_max_ms: {
                    type: "number",
                    description: "Maximum delay between actions in ms (default: 400)",
                  },
                },
              },
              viewport: {
                type: "object",
                description: "Browser viewport size",
                properties: {
                  width: {
                    type: "number",
                    description: "Viewport width in pixels (default: 1920)",
                  },
                  height: {
                    type: "number",
                    description: "Viewport height in pixels (default: 1080)",
                  },
                },
              },
            },
          },
        },
        required: ["question"],
      },
    },
    {
      name: "add_notebook",
      description:
        `PERMISSION REQUIRED — Only when user explicitly asks to add a notebook.

## Conversation Workflow (Mandatory)
When the user says: "I have a NotebookLM with X"

1) Ask URL: "What is the NotebookLM URL?"
2) Ask content: "What knowledge is inside?" (1–2 sentences)
3) Ask topics: "Which topics does it cover?" (3–5)
4) Ask use cases: "When should we consult it?"
5) Propose metadata and confirm:
   - Name: [suggested]
   - Description: [from user]
   - Topics: [list]
   - Use cases: [list]
   "Add it to your library now?"
6) Only after explicit "Yes" → call this tool

## Rules
- Do not add without user permission
- Do not guess metadata — ask concisely
- Confirm summary before calling the tool

## Example
User: "I have a notebook with n8n docs"
You: Ask URL → content → topics → use cases; propose summary
User: "Yes"
You: Call add_notebook

## How to Get a NotebookLM Share Link

Visit https://notebooklm.google/ → Login (free: 100 notebooks, 50 sources each, 500k words, 50 daily queries)
1) Click "+ New" (top right) → Upload sources (docs, knowledge)
2) Click "Share" (top right) → Select "Anyone with the link"
3) Click "Copy link" (bottom left) → Give this link to Claude

(Upgraded: Google AI Pro/Ultra gives 5x higher limits)`,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The NotebookLM notebook URL",
          },
          name: {
            type: "string",
            description: "Display name for the notebook (e.g., 'n8n Documentation')",
          },
          description: {
            type: "string",
            description: "What knowledge/content is in this notebook",
          },
          topics: {
            type: "array",
            items: { type: "string" },
            description: "Topics covered in this notebook",
          },
          content_types: {
            type: "array",
            items: { type: "string" },
            description:
              "Types of content (e.g., ['documentation', 'examples', 'best practices'])",
          },
          use_cases: {
            type: "array",
            items: { type: "string" },
            description: "When should Claude use this notebook (e.g., ['Implementing n8n workflows'])",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for organization",
          },
        },
        required: ["url", "name", "description", "topics"],
      },
    },
    {
      name: "list_notebooks",
      description:
        "List all library notebooks with metadata (name, topics, use cases, URL). " +
        "Use this to present options, then ask which notebook to use for the task.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_notebook",
      description: "Get detailed information about a specific notebook by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The notebook ID",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "select_notebook",
      description:
        `Set a notebook as the active default (used when ask_question has no notebook_id).

## When To Use
- User switches context: "Let's work on React now"
- User asks explicitly to activate a notebook
- Obvious task change requires another notebook

## Auto-Switching
- Safe to auto-switch if the context is clear and you announce it:
  "Switching to React notebook for this task..."
- If ambiguous, ask: "Switch to [notebook] for this task?"

## Example
User: "Now let's build the React frontend"
You: "Switching to React notebook..." (call select_notebook)`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The notebook ID to activate",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "update_notebook",
      description:
        `Update notebook metadata based on user intent.

## Pattern
1) Identify target notebook and fields (topics, description, use_cases, tags, url)
2) Propose the exact change back to the user
3) After explicit confirmation, call this tool

## Examples
- User: "React notebook also covers Next.js 14"
  You: "Add 'Next.js 14' to topics for React?"
  User: "Yes" → call update_notebook

- User: "Include error handling in n8n description"
  You: "Update the n8n description to mention error handling?"
  User: "Yes" → call update_notebook

Tip: You may update multiple fields at once if requested.`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The notebook ID to update",
          },
          name: {
            type: "string",
            description: "New display name",
          },
          description: {
            type: "string",
            description: "New description",
          },
          topics: {
            type: "array",
            items: { type: "string" },
            description: "New topics list",
          },
          content_types: {
            type: "array",
            items: { type: "string" },
            description: "New content types",
          },
          use_cases: {
            type: "array",
            items: { type: "string" },
            description: "New use cases",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "New tags",
          },
          url: {
            type: "string",
            description: "New notebook URL",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "remove_notebook",
      description:
        `Dangerous — requires explicit user confirmation.

## Confirmation Workflow
1) User requests removal ("Remove the React notebook")
2) Look up full name to confirm
3) Ask: "Remove '[notebook_name]' from your library? (Does not delete the actual NotebookLM notebook)"
4) Only on explicit "Yes" → call remove_notebook

Never remove without permission or based on assumptions.

Example:
User: "Delete the old React notebook"
You: "Remove 'React Best Practices' from your library?"
User: "Yes" → call remove_notebook`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The notebook ID to remove",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "search_notebooks",
      description:
        "Search library by query (name, description, topics, tags). " +
        "Use to propose relevant notebooks for the task and then ask which to use.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_library_stats",
      description: "Get statistics about your notebook library (total notebooks, usage, etc.)",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_sessions",
      description:
        "List all active sessions with stats (age, message count, last activity). " +
        "Use to continue the most relevant session instead of starting from scratch.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "close_session",
      description: "Close a specific session by session ID. Ask before closing if the user might still need it.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID to close",
          },
        },
        required: ["session_id"],
      },
    },
    {
      name: "reset_session",
      description:
        "Reset a session's chat history (keep same session ID). " +
        "Use for a clean slate when the task changes; ask the user before resetting.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID to reset",
          },
        },
        required: ["session_id"],
      },
    },
    {
      name: "get_health",
      description:
        "Get server health status including authentication state, active sessions, and configuration. " +
        "Use this to verify the server is ready before starting research workflows.\n\n" +
        "If authenticated=false and having persistent issues:\n" +
        "Consider running cleanup_data(preserve_library=true) + setup_auth for fresh start with clean browser session.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "setup_auth",
      description:
        "Google authentication for NotebookLM access - opens a browser window for manual login to your Google account. " +
        "Returns immediately after opening the browser. You have up to 10 minutes to complete the login. " +
        "Use 'get_health' tool afterwards to verify authentication was saved successfully. " +
        "Use this for first-time authentication or when auto-login credentials are not available. " +
        "For switching accounts or rate-limit workarounds, use 're_auth' tool instead.\n\n" +
        "TROUBLESHOOTING for persistent auth issues:\n" +
        "If setup_auth fails or you encounter browser/session issues:\n" +
        "1. Ask user to close ALL Chrome/Chromium instances\n" +
        "2. Run cleanup_data(confirm=true, preserve_library=true) to clean old data\n" +
        "3. Run setup_auth again for fresh start\n" +
        "This helps resolve conflicts from old browser sessions and installation data.",
      inputSchema: {
        type: "object",
        properties: {
          show_browser: {
            type: "boolean",
            description:
              "Show browser window (simple version). Default: true for setup. " +
              "For advanced control, use browser_options instead.",
          },
          browser_options: {
            type: "object",
            description:
              "Optional browser settings. Control visibility, timeouts, and stealth behavior.",
            properties: {
              show: {
                type: "boolean",
                description: "Show browser window (default: true for setup)",
              },
              headless: {
                type: "boolean",
                description: "Run browser in headless mode (default: false for setup)",
              },
              timeout_ms: {
                type: "number",
                description: "Browser operation timeout in milliseconds (default: 30000)",
              },
            },
          },
        },
      },
    },
    {
      name: "re_auth",
      description:
        "Switch to a different Google account or re-authenticate. " +
        "Use this when:\n" +
        "- NotebookLM rate limit is reached (50 queries/day for free accounts)\n" +
        "- You want to switch to a different Google account\n" +
        "- Authentication is broken and needs a fresh start\n\n" +
        "This will:\n" +
        "1. Close all active browser sessions\n" +
        "2. Delete all saved authentication data (cookies, Chrome profile)\n" +
        "3. Open browser for fresh Google login\n\n" +
        "After completion, use 'get_health' to verify authentication.\n\n" +
        "TROUBLESHOOTING for persistent auth issues:\n" +
        "If re_auth fails repeatedly:\n" +
        "1. Ask user to close ALL Chrome/Chromium instances\n" +
        "2. Run cleanup_data(confirm=false, preserve_library=true) to preview old files\n" +
        "3. Run cleanup_data(confirm=true, preserve_library=true) to clean everything except library\n" +
        "4. Run re_auth again for completely fresh start\n" +
        "This removes old installation data and browser sessions that can cause conflicts.",
      inputSchema: {
        type: "object",
        properties: {
          show_browser: {
            type: "boolean",
            description:
              "Show browser window (simple version). Default: true for re-auth. " +
              "For advanced control, use browser_options instead.",
          },
          browser_options: {
            type: "object",
            description:
              "Optional browser settings. Control visibility, timeouts, and stealth behavior.",
            properties: {
              show: {
                type: "boolean",
                description: "Show browser window (default: true for re-auth)",
              },
              headless: {
                type: "boolean",
                description: "Run browser in headless mode (default: false for re-auth)",
              },
              timeout_ms: {
                type: "number",
                description: "Browser operation timeout in milliseconds (default: 30000)",
              },
            },
          },
        },
      },
    },
    {
      name: "cleanup_data",
      description:
        "ULTRATHINK Deep Cleanup - Scans entire system for ALL NotebookLM MCP data files across 8 categories. Always runs in deep mode, shows categorized preview before deletion.\n\n" +
        "⚠️ CRITICAL: Close ALL Chrome/Chromium instances BEFORE running this tool! Open browsers can prevent cleanup and cause issues.\n\n" +
        "Categories scanned:\n" +
        "1. Legacy Installation (notebooklm-mcp-nodejs) - Old paths with -nodejs suffix\n" +
        "2. Current Installation (notebooklm-mcp) - Active data, browser profiles, library\n" +
        "3. NPM/NPX Cache - Cached installations from npx\n" +
        "4. Claude CLI MCP Logs - MCP server logs from Claude CLI\n" +
        "5. Temporary Backups - Backup directories in system temp\n" +
        "6. Claude Projects Cache - Project-specific cache (optional)\n" +
        "7. Editor Logs (Cursor/VSCode) - MCP logs from code editors (optional)\n" +
        "8. Trash Files - Deleted notebooklm files in system trash (optional)\n\n" +
        "Works cross-platform (Linux, Windows, macOS). Safe by design: shows detailed preview before deletion, requires explicit confirmation.\n\n" +
        "LIBRARY PRESERVATION: Set preserve_library=true to keep your notebook library.json file while cleaning everything else.\n\n" +
        "RECOMMENDED WORKFLOW for fresh start:\n" +
        "1. Ask user to close ALL Chrome/Chromium instances\n" +
        "2. Run cleanup_data(confirm=false, preserve_library=true) to preview\n" +
        "3. Run cleanup_data(confirm=true, preserve_library=true) to execute\n" +
        "4. Run setup_auth or re_auth for fresh browser session\n\n" +
        "Use cases: Clean reinstall, troubleshooting auth issues, removing all traces before uninstall, cleaning old browser sessions and installation data.",
      inputSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description:
              "Confirmation flag. Tool shows preview first, then user confirms deletion. " +
              "Set to true only after user has reviewed the preview and explicitly confirmed.",
          },
          preserve_library: {
            type: "boolean",
            description:
              "Preserve library.json file during cleanup. Default: false. " +
              "Set to true to keep your notebook library while deleting everything else (browser data, caches, logs).",
            default: false,
          },
        },
        required: ["confirm"],
      },
    },
  ];
}

/**
 * MCP Tool Handlers
 */
export class ToolHandlers {
  private sessionManager: SessionManager;
  private authManager: AuthManager;
  private library: NotebookLibrary;

  constructor(sessionManager: SessionManager, authManager: AuthManager, library: NotebookLibrary) {
    this.sessionManager = sessionManager;
    this.authManager = authManager;
    this.library = library;
  }

  /**
   * Handle ask_question tool
   */
  async handleAskQuestion(
    args: {
      question: string;
      session_id?: string;
      notebook_id?: string;
      notebook_url?: string;
      show_browser?: boolean;
      browser_options?: BrowserOptions;
    },
    sendProgress?: ProgressCallback
  ): Promise<ToolResult<AskQuestionResult>> {
    const { question, session_id, notebook_id, notebook_url, show_browser, browser_options } = args;

    log.info(`🔧 [TOOL] ask_question called`);
    log.info(`  Question: "${question.substring(0, 100)}..."`);
    if (session_id) {
      log.info(`  Session ID: ${session_id}`);
    }
    if (notebook_id) {
      log.info(`  Notebook ID: ${notebook_id}`);
    }
    if (notebook_url) {
      log.info(`  Notebook URL: ${notebook_url}`);
    }

    try {
      // Resolve notebook URL
      let resolvedNotebookUrl = notebook_url;

      if (!resolvedNotebookUrl && notebook_id) {
        const notebook = this.library.incrementUseCount(notebook_id);
        if (!notebook) {
          throw new Error(`Notebook not found in library: ${notebook_id}`);
        }

        resolvedNotebookUrl = notebook.url;
        log.info(`  Resolved notebook: ${notebook.name}`);
      } else if (!resolvedNotebookUrl) {
        const active = this.library.getActiveNotebook();
        if (active) {
          const notebook = this.library.incrementUseCount(active.id);
          if (!notebook) {
            throw new Error(`Active notebook not found: ${active.id}`);
          }
          resolvedNotebookUrl = notebook.url;
          log.info(`  Using active notebook: ${notebook.name}`);
        }
      }

      // Progress: Getting or creating session
      await sendProgress?.("Getting or creating browser session...", 1, 5);

      // Apply browser options temporarily
      const originalConfig = { ...CONFIG };
      const effectiveConfig = applyBrowserOptions(browser_options, show_browser);
      Object.assign(CONFIG, effectiveConfig);

      // Calculate overrideHeadless parameter for session manager
      // show_browser takes precedence over browser_options.headless
      let overrideHeadless: boolean | undefined = undefined;
      if (show_browser !== undefined) {
        overrideHeadless = show_browser;
      } else if (browser_options?.show !== undefined) {
        overrideHeadless = browser_options.show;
      } else if (browser_options?.headless !== undefined) {
        overrideHeadless = !browser_options.headless;
      }

      try {
        // Get or create session (with headless override to handle mode changes)
        const session = await this.sessionManager.getOrCreateSession(
          session_id,
          resolvedNotebookUrl,
          overrideHeadless
        );

      // Progress: Asking question
      await sendProgress?.("Asking question to NotebookLM...", 2, 5);

      // Ask the question (pass progress callback)
      const rawAnswer = await session.ask(question, sendProgress);
      const answer = `${rawAnswer.trimEnd()}${FOLLOW_UP_REMINDER}`;

      // Get session info
      const sessionInfo = session.getInfo();

      const result: AskQuestionResult = {
        status: "success",
        question,
        answer,
        session_id: session.sessionId,
        notebook_url: session.notebookUrl,
        session_info: {
          age_seconds: sessionInfo.age_seconds,
          message_count: sessionInfo.message_count,
          last_activity: sessionInfo.last_activity,
        },
      };

        // Progress: Complete
        await sendProgress?.("Question answered successfully!", 5, 5);

        log.success(`✅ [TOOL] ask_question completed successfully`);
        return {
          success: true,
          data: result,
        };
      } finally {
        // Restore original CONFIG
        Object.assign(CONFIG, originalConfig);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Special handling for rate limit errors
      if (error instanceof RateLimitError || errorMessage.toLowerCase().includes("rate limit")) {
        log.error(`🚫 [TOOL] Rate limit detected`);
        return {
          success: false,
          error:
            "NotebookLM rate limit reached (50 queries/day for free accounts).\n\n" +
            "You can:\n" +
            "1. Use the 're_auth' tool to login with a different Google account\n" +
            "2. Wait until tomorrow for the quota to reset\n" +
            "3. Upgrade to Google AI Pro/Ultra for 5x higher limits\n\n" +
            `Original error: ${errorMessage}`,
        };
      }

      log.error(`❌ [TOOL] ask_question failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle list_sessions tool
   */
  async handleListSessions(): Promise<
    ToolResult<{
      active_sessions: number;
      max_sessions: number;
      session_timeout: number;
      oldest_session_seconds: number;
      total_messages: number;
      sessions: Array<{
        id: string;
        created_at: number;
        last_activity: number;
        age_seconds: number;
        inactive_seconds: number;
        message_count: number;
        notebook_url: string;
      }>;
    }>
  > {
    log.info(`🔧 [TOOL] list_sessions called`);

    try {
      const stats = this.sessionManager.getStats();
      const sessions = this.sessionManager.getAllSessionsInfo();

      const result = {
        active_sessions: stats.active_sessions,
        max_sessions: stats.max_sessions,
        session_timeout: stats.session_timeout,
        oldest_session_seconds: stats.oldest_session_seconds,
        total_messages: stats.total_messages,
        sessions: sessions.map((info) => ({
          id: info.id,
          created_at: info.created_at,
          last_activity: info.last_activity,
          age_seconds: info.age_seconds,
          inactive_seconds: info.inactive_seconds,
          message_count: info.message_count,
          notebook_url: info.notebook_url,
        })),
      };

      log.success(
        `✅ [TOOL] list_sessions completed (${result.active_sessions} sessions)`
      );
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] list_sessions failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle close_session tool
   */
  async handleCloseSession(args: {
    session_id: string;
  }): Promise<
    ToolResult<{ status: string; message: string; session_id: string }>
  > {
    const { session_id } = args;

    log.info(`🔧 [TOOL] close_session called`);
    log.info(`  Session ID: ${session_id}`);

    try {
      const closed = await this.sessionManager.closeSession(session_id);

      if (closed) {
        log.success(`✅ [TOOL] close_session completed`);
        return {
          success: true,
          data: {
            status: "success",
            message: `Session ${session_id} closed successfully`,
            session_id,
          },
        };
      } else {
        log.warning(`⚠️  [TOOL] Session ${session_id} not found`);
        return {
          success: false,
          error: `Session ${session_id} not found`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] close_session failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle reset_session tool
   */
  async handleResetSession(args: {
    session_id: string;
  }): Promise<
    ToolResult<{ status: string; message: string; session_id: string }>
  > {
    const { session_id } = args;

    log.info(`🔧 [TOOL] reset_session called`);
    log.info(`  Session ID: ${session_id}`);

    try {
      const session = this.sessionManager.getSession(session_id);

      if (!session) {
        log.warning(`⚠️  [TOOL] Session ${session_id} not found`);
        return {
          success: false,
          error: `Session ${session_id} not found`,
        };
      }

      await session.reset();

      log.success(`✅ [TOOL] reset_session completed`);
      return {
        success: true,
        data: {
          status: "success",
          message: `Session ${session_id} reset successfully`,
          session_id,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] reset_session failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle get_health tool
   */
  async handleGetHealth(): Promise<
    ToolResult<{
      status: string;
      authenticated: boolean;
      notebook_url: string;
      active_sessions: number;
      max_sessions: number;
      session_timeout: number;
      total_messages: number;
      headless: boolean;
      auto_login_enabled: boolean;
      stealth_enabled: boolean;
      troubleshooting_tip?: string;
    }>
  > {
    log.info(`🔧 [TOOL] get_health called`);

    try {
      // Check authentication status
      const statePath = await this.authManager.getValidStatePath();
      const authenticated = statePath !== null;

      // Get session stats
      const stats = this.sessionManager.getStats();

      const result = {
        status: "ok",
        authenticated,
        notebook_url: CONFIG.notebookUrl || "not configured",
        active_sessions: stats.active_sessions,
        max_sessions: stats.max_sessions,
        session_timeout: stats.session_timeout,
        total_messages: stats.total_messages,
        headless: CONFIG.headless,
        auto_login_enabled: CONFIG.autoLoginEnabled,
        stealth_enabled: CONFIG.stealthEnabled,
        // Add troubleshooting tip if not authenticated
        ...((!authenticated) && {
          troubleshooting_tip:
            "For fresh start with clean browser session: Close all Chrome instances → " +
            "cleanup_data(confirm=true, preserve_library=true) → setup_auth"
        }),
      };

      log.success(`✅ [TOOL] get_health completed`);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] get_health failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle setup_auth tool
   *
   * Opens a browser window for manual login with live progress updates.
   * The operation waits synchronously for login completion (up to 10 minutes).
   */
  async handleSetupAuth(
    args: {
      show_browser?: boolean;
      browser_options?: BrowserOptions;
    },
    sendProgress?: ProgressCallback
  ): Promise<
    ToolResult<{
      status: string;
      message: string;
      authenticated: boolean;
      duration_seconds?: number;
    }>
  > {
    const { show_browser, browser_options } = args;

    // CRITICAL: Send immediate progress to reset timeout from the very start
    await sendProgress?.("Initializing authentication setup...", 0, 10);

    log.info(`🔧 [TOOL] setup_auth called`);
    if (show_browser !== undefined) {
      log.info(`  Show browser: ${show_browser}`);
    }

    const startTime = Date.now();

    // Apply browser options temporarily
    const originalConfig = { ...CONFIG };
    const effectiveConfig = applyBrowserOptions(browser_options, show_browser);
    Object.assign(CONFIG, effectiveConfig);

    try {
      // Progress: Starting
      await sendProgress?.("Preparing authentication browser...", 1, 10);

      log.info(`  🌐 Opening browser for interactive login...`);

      // Progress: Opening browser
      await sendProgress?.("Opening browser window...", 2, 10);

      // Perform setup with progress updates (uses CONFIG internally)
      const success = await this.authManager.performSetup(sendProgress);

      const durationSeconds = (Date.now() - startTime) / 1000;

      if (success) {
        // Progress: Complete
        await sendProgress?.("Authentication saved successfully!", 10, 10);

        log.success(`✅ [TOOL] setup_auth completed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: true,
          data: {
            status: "authenticated",
            message: "Successfully authenticated and saved browser state",
            authenticated: true,
            duration_seconds: durationSeconds,
          },
        };
      } else {
        log.error(`❌ [TOOL] setup_auth failed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: false,
          error: "Authentication failed or was cancelled",
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const durationSeconds = (Date.now() - startTime) / 1000;
      log.error(`❌ [TOOL] setup_auth failed: ${errorMessage} (${durationSeconds.toFixed(1)}s)`);
      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      // Restore original CONFIG
      Object.assign(CONFIG, originalConfig);
    }
  }

  /**
   * Handle re_auth tool
   *
   * Performs a complete re-authentication:
   * 1. Closes all active browser sessions
   * 2. Deletes all saved authentication data (cookies, Chrome profile)
   * 3. Opens browser for fresh Google login
   *
   * Use for switching Google accounts or recovering from rate limits.
   */
  async handleReAuth(
    args: {
      show_browser?: boolean;
      browser_options?: BrowserOptions;
    },
    sendProgress?: ProgressCallback
  ): Promise<
    ToolResult<{
      status: string;
      message: string;
      authenticated: boolean;
      duration_seconds?: number;
    }>
  > {
    const { show_browser, browser_options } = args;

    await sendProgress?.("Preparing re-authentication...", 0, 12);
    log.info(`🔧 [TOOL] re_auth called`);
    if (show_browser !== undefined) {
      log.info(`  Show browser: ${show_browser}`);
    }

    const startTime = Date.now();

    // Apply browser options temporarily
    const originalConfig = { ...CONFIG };
    const effectiveConfig = applyBrowserOptions(browser_options, show_browser);
    Object.assign(CONFIG, effectiveConfig);

    try {
      // 1. Close all active sessions
      await sendProgress?.("Closing all active sessions...", 1, 12);
      log.info("  🛑 Closing all sessions...");
      await this.sessionManager.closeAllSessions();
      log.success("  ✅ All sessions closed");

      // 2. Clear all auth data
      await sendProgress?.("Clearing authentication data...", 2, 12);
      log.info("  🗑️  Clearing all auth data...");
      await this.authManager.clearAllAuthData();
      log.success("  ✅ Auth data cleared");

      // 3. Perform fresh setup
      await sendProgress?.("Starting fresh authentication...", 3, 12);
      log.info("  🌐 Starting fresh authentication setup...");
      const success = await this.authManager.performSetup(sendProgress);

      const durationSeconds = (Date.now() - startTime) / 1000;

      if (success) {
        await sendProgress?.("Re-authentication complete!", 12, 12);
        log.success(`✅ [TOOL] re_auth completed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: true,
          data: {
            status: "authenticated",
            message:
              "Successfully re-authenticated with new account. All previous sessions have been closed.",
            authenticated: true,
            duration_seconds: durationSeconds,
          },
        };
      } else {
        log.error(`❌ [TOOL] re_auth failed (${durationSeconds.toFixed(1)}s)`);
        return {
          success: false,
          error: "Re-authentication failed or was cancelled",
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const durationSeconds = (Date.now() - startTime) / 1000;
      log.error(
        `❌ [TOOL] re_auth failed: ${errorMessage} (${durationSeconds.toFixed(1)}s)`
      );
      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      // Restore original CONFIG
      Object.assign(CONFIG, originalConfig);
    }
  }

  /**
   * Handle add_notebook tool
   */
  async handleAddNotebook(args: AddNotebookInput): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] add_notebook called`);
    log.info(`  Name: ${args.name}`);

    try {
      const notebook = this.library.addNotebook(args);
      log.success(`✅ [TOOL] add_notebook completed: ${notebook.id}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] add_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle list_notebooks tool
   */
  async handleListNotebooks(): Promise<ToolResult<{ notebooks: any[] }>> {
    log.info(`🔧 [TOOL] list_notebooks called`);

    try {
      const notebooks = this.library.listNotebooks();
      log.success(`✅ [TOOL] list_notebooks completed (${notebooks.length} notebooks)`);
      return {
        success: true,
        data: { notebooks },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] list_notebooks failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle get_notebook tool
   */
  async handleGetNotebook(args: { id: string }): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] get_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.getNotebook(args.id);
      if (!notebook) {
        log.warning(`⚠️  [TOOL] Notebook not found: ${args.id}`);
        return {
          success: false,
          error: `Notebook not found: ${args.id}`,
        };
      }

      log.success(`✅ [TOOL] get_notebook completed: ${notebook.name}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] get_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle select_notebook tool
   */
  async handleSelectNotebook(args: { id: string }): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] select_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.selectNotebook(args.id);
      log.success(`✅ [TOOL] select_notebook completed: ${notebook.name}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] select_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle update_notebook tool
   */
  async handleUpdateNotebook(args: UpdateNotebookInput): Promise<ToolResult<{ notebook: any }>> {
    log.info(`🔧 [TOOL] update_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.updateNotebook(args);
      log.success(`✅ [TOOL] update_notebook completed: ${notebook.name}`);
      return {
        success: true,
        data: { notebook },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] update_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle remove_notebook tool
   */
  async handleRemoveNotebook(args: { id: string }): Promise<ToolResult<{ removed: boolean; closed_sessions: number }>> {
    log.info(`🔧 [TOOL] remove_notebook called`);
    log.info(`  ID: ${args.id}`);

    try {
      const notebook = this.library.getNotebook(args.id);
      if (!notebook) {
        log.warning(`⚠️  [TOOL] Notebook not found: ${args.id}`);
        return {
          success: false,
          error: `Notebook not found: ${args.id}`,
        };
      }

      const removed = this.library.removeNotebook(args.id);
      if (removed) {
        const closedSessions = await this.sessionManager.closeSessionsForNotebook(
          notebook.url
        );
        log.success(`✅ [TOOL] remove_notebook completed`);
        return {
          success: true,
          data: { removed: true, closed_sessions: closedSessions },
        };
      } else {
        log.warning(`⚠️  [TOOL] Notebook not found: ${args.id}`);
        return {
          success: false,
          error: `Notebook not found: ${args.id}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] remove_notebook failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle search_notebooks tool
   */
  async handleSearchNotebooks(args: { query: string }): Promise<ToolResult<{ notebooks: any[] }>> {
    log.info(`🔧 [TOOL] search_notebooks called`);
    log.info(`  Query: "${args.query}"`);

    try {
      const notebooks = this.library.searchNotebooks(args.query);
      log.success(`✅ [TOOL] search_notebooks completed (${notebooks.length} results)`);
      return {
        success: true,
        data: { notebooks },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] search_notebooks failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle get_library_stats tool
   */
  async handleGetLibraryStats(): Promise<ToolResult<any>> {
    log.info(`🔧 [TOOL] get_library_stats called`);

    try {
      const stats = this.library.getStats();
      log.success(`✅ [TOOL] get_library_stats completed`);
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] get_library_stats failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle cleanup_data tool
   *
   * ULTRATHINK Deep Cleanup - scans entire system for ALL NotebookLM MCP files
   */
  async handleCleanupData(
    args: { confirm: boolean; preserve_library?: boolean }
  ): Promise<
    ToolResult<{
      status: string;
      mode: string;
      preview?: {
        categories: Array<{
          name: string;
          description: string;
          paths: string[];
          totalBytes: number;
          optional: boolean;
        }>;
        totalPaths: number;
        totalSizeBytes: number;
      };
      result?: {
        deletedPaths: string[];
        failedPaths: string[];
        totalSizeBytes: number;
        categorySummary: Record<string, { count: number; bytes: number }>;
      };
    }>
  > {
    const { confirm, preserve_library = false } = args;

    log.info(`🔧 [TOOL] cleanup_data called`);
    log.info(`  Confirm: ${confirm}`);
    log.info(`  Preserve Library: ${preserve_library}`);

    const cleanupManager = new CleanupManager();

    try {
      // Always run in deep mode
      const mode = "deep";

      if (!confirm) {
        // Preview mode - show what would be deleted
        log.info(`  📋 Generating cleanup preview (mode: ${mode})...`);

        const preview = await cleanupManager.getCleanupPaths(mode, preserve_library);
        const platformInfo = cleanupManager.getPlatformInfo();

        log.info(`  Found ${preview.totalPaths.length} items (${cleanupManager.formatBytes(preview.totalSizeBytes)})`);
        log.info(`  Platform: ${platformInfo.platform}`);

        return {
          success: true,
          data: {
            status: "preview",
            mode,
            preview: {
              categories: preview.categories,
              totalPaths: preview.totalPaths.length,
              totalSizeBytes: preview.totalSizeBytes,
            },
          },
        };
      } else {
        // Cleanup mode - actually delete files
        log.info(`  🗑️  Performing cleanup (mode: ${mode})...`);

        const result = await cleanupManager.performCleanup(mode, preserve_library);

        if (result.success) {
          log.success(`✅ [TOOL] cleanup_data completed - deleted ${result.deletedPaths.length} items`);
        } else {
          log.warning(`⚠️  [TOOL] cleanup_data completed with ${result.failedPaths.length} errors`);
        }

        return {
          success: result.success,
          data: {
            status: result.success ? "completed" : "partial",
            mode,
            result: {
              deletedPaths: result.deletedPaths,
              failedPaths: result.failedPaths,
              totalSizeBytes: result.totalSizeBytes,
              categorySummary: result.categorySummary,
            },
          },
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`❌ [TOOL] cleanup_data failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Cleanup all resources (called on server shutdown)
   */
  async cleanup(): Promise<void> {
    log.info(`🧹 Cleaning up tool handlers...`);
    await this.sessionManager.closeAllSessions();
    log.success(`✅ Tool handlers cleanup complete`);
  }
}
