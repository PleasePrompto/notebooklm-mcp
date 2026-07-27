import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { NotebookLibrary } from "../../library/notebook-library.js";
import { getTopicsLine, getUseCaseBullets } from "../../library/metadata.js";

/**
 * Build dynamic tool description for ask_question based on active notebook or library
 */
export function buildAskQuestionDescription(library: NotebookLibrary): string {
  const active = library.getActiveNotebook();
  const bt = "`"; // Backtick helper to avoid template literal issues

  if (active) {
    // Safe accessors — older library.json files may omit topics/use_cases (issue #33).
    const topics = getTopicsLine(active);
    const useCases = getUseCaseBullets(active);

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
${bt}${bt}${bt}javascript
// 1) Start broad (no session_id → creates one)
ask_question({ question: "Give me an overview of [topic]" })
// ← Save: result.session_id

// 2) Go specific (same session)
ask_question({ question: "Key APIs/methods?", session_id })

// 3) Cover pitfalls (same session)
ask_question({ question: "Common edge cases + gotchas?", session_id })

// 4) Ask for production example (same session)
ask_question({ question: "Show a production-ready example", session_id })
${bt}${bt}${bt}

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
${bt}${bt}${bt}
Q: "How do I handle errors in n8n?"
A: [basic answer]
→ Implement → Probably missing edge cases!
${bt}${bt}${bt}

Good (deep):
${bt}${bt}${bt}
Q1: "What are n8n's error handling mechanisms?" (session created)
A1: [Overview of error handling]

Q2: "What's the recommended pattern for API errors?" (same session)
A2: [Specific patterns, uses context from Q1]

Q3: "How do I handle retry logic and timeouts?" (same session)
A3: [Detailed approach, builds on Q1+Q2]

Q4: "Show me a production example with all these patterns" (same session)
A4: [Complete example with full context]

→ NOW implement with confidence!
${bt}${bt}${bt}
    
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

export const askQuestionTool: Tool = {
  name: "ask_question",
  // Description will be set dynamically using buildAskQuestionDescription
  description: "Dynamic description placeholder",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The question to ask NotebookLM. Plain natural language; can be " +
          "multi-line. Gemini responds grounded on the notebook's sources.",
      },
      session_id: {
        type: "string",
        description:
          "Reuse an existing browser session for follow-up questions. " +
          "Pass back the `session_id` returned in a prior `ask_question` " +
          "response — NotebookLM keeps the prior conversation in context, " +
          "so follow-ups get sharper. Omit for a fresh session. " +
          "`list_sessions` enumerates live sessions.",
      },
      notebook_id: {
        type: "string",
        description:
          "Library notebook id (from `list_notebooks` / `search_notebooks`). " +
          "Defaults to the active notebook (see `select_notebook`) when omitted.",
      },
      notebook_url: {
        type: "string",
        description:
          "Direct NotebookLM URL — overrides `notebook_id`. Use for ad-hoc " +
          "queries against notebooks not yet in your library. Format: " +
          "`https://notebooklm.google.com/notebook/<uuid>`.",
      },
      source_format: {
        type: "string",
        enum: ["none", "inline", "footnotes", "json"],
        description:
          "How citations are returned alongside the answer:\n" +
          "  • `none` (default) — raw answer, no citation extraction (fastest)\n" +
          '  • `footnotes` — answer plus a `Sources:` block, e.g. `[1] DocName — "excerpt…"`\n' +
          '  • `inline` — `[N]` markers in the answer are replaced with `[N] (DocName: "excerpt…")`\n' +
          "  • `json` — answer text untouched; structured `sources` array on the response\n\n" +
          "Use `none` for snappy chat. Use `json` when downstream code needs to " +
          "process citations programmatically. Use `footnotes`/`inline` when " +
          "showing the answer to a human reader.",
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
  annotations: {
    title: "Ask NotebookLM (Gemini 2.5)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
