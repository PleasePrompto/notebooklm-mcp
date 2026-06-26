import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Library tools — manage the local catalogue of NotebookLM notebooks the
 * user has registered with this server. The cross-tool ID flow (where
 * `id` comes from, where it's used) lives in the server-level
 * `instructions` string.
 */
export const notebookManagementTools: Tool[] = [
  {
    name: "add_notebook",
    description:
      "Register a NotebookLM notebook in the local library so it can be " +
      "queried with `ask_question`, ingested into with `add_source`, etc.\n\n" +
      "## Required URL\n" +
      "The user must supply a NotebookLM share-link. To produce one:\n" +
      "  1. Open https://notebooklm.google\n" +
      '  2. Open the notebook → click "Share" (top right)\n' +
      '  3. Set "Anyone with the link" → "Copy link"\n\n' +
      "## Permission workflow\n" +
      "Do NOT call this tool unprompted. The expected dialogue is:\n" +
      "  1. Ask for the URL\n" +
      "  2. Ask what knowledge it contains (1–2 sentences) → `description`\n" +
      "  3. Ask which topics it covers (3–5) → `topics`\n" +
      "  4. Ask when it should be consulted → `use_cases`\n" +
      "  5. Propose a `name` and the metadata back to the user\n" +
      "  6. Only after explicit confirmation, call `add_notebook`.\n\n" +
      "Free-tier limits: 100 notebooks · 50 sources each · 50 queries/day. " +
      "Google AI Pro/Ultra raises these 5×.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "NotebookLM share URL. Format: " +
            "`https://notebooklm.google.com/notebook/<uuid>` (with optional " +
            "`?authuser=N` suffix).",
        },
        name: {
          type: "string",
          description: "Display name (e.g. 'n8n Documentation').",
        },
        description: {
          type: "string",
          description: "1–2 sentence summary of what the notebook contains.",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "3–5 topics covered. Used by `search_notebooks`.",
        },
        content_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Content classification, e.g. ['documentation', 'examples', 'best practices'].",
        },
        use_cases: {
          type: "array",
          items: { type: "string" },
          description:
            "When the LLM should consult this notebook, e.g. ['Implementing n8n workflows'].",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional free-form tags for organisation.",
        },
      },
      required: ["url", "name", "description", "topics"],
    },
    annotations: {
      title: "Add notebook to library",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "list_notebooks",
    description:
      "List every notebook in the local library with its metadata " +
      "(`id`, `name`, `description`, `topics`, `tags`, `url`, `use_count`, " +
      "etc.). Use the returned `id` for `select_notebook`, `update_notebook`, " +
      "`get_notebook`, `remove_notebook`, or as `notebook_id` on " +
      "`ask_question` / `add_source` / audio tools.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      title: "List notebooks",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_notebook",
    description:
      "Fetch full metadata for one notebook by id. Use to verify what's " +
      "currently stored before calling `update_notebook`, or to show the " +
      "user the exact `description`/`topics`/`use_cases` Claude has for it.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id, as returned by `list_notebooks`/`search_notebooks`.",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Get notebook",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "select_notebook",
    description:
      "Mark a notebook as the active default. After this, `ask_question`, " +
      "`add_source`, and the audio tools resolve to that notebook when the " +
      "caller omits `notebook_id` / `notebook_url`.\n\n" +
      "When to call:\n" +
      "  • The user explicitly switches context (e.g. \"Let's work on " +
      'React now")\n' +
      "  • Task obviously needs a different notebook than the current one — " +
      'announce the switch ("Switching to the React notebook…") before ' +
      "calling.\n" +
      "  • If the right notebook is ambiguous, ask the user first instead " +
      "of guessing.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id to activate (from `list_notebooks`).",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Select active notebook",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "update_notebook",
    description:
      "Patch metadata fields on an existing notebook. Pass `id` plus any " +
      "subset of `name`, `description`, `topics`, `content_types`, " +
      "`use_cases`, `tags`, `url` — only supplied fields change.\n\n" +
      "Workflow: identify the target notebook → propose the exact change " +
      "back to the user → call only after explicit confirmation. Multiple " +
      "fields can be updated in one call.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id to update (from `list_notebooks`).",
        },
        name: { type: "string", description: "New display name." },
        description: { type: "string", description: "New 1–2 sentence summary." },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Replacement topics list (full replacement, not append).",
        },
        content_types: {
          type: "array",
          items: { type: "string" },
          description: "Replacement content classification.",
        },
        use_cases: {
          type: "array",
          items: { type: "string" },
          description: "Replacement use-cases.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Replacement tags.",
        },
        url: {
          type: "string",
          description: "New NotebookLM share URL (rarely needed).",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Update notebook metadata",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "remove_notebook",
    description:
      "Remove a notebook from the local library. **Does NOT delete the " +
      "actual NotebookLM notebook on Google's side** — only the local " +
      "metadata entry. Active sessions on this notebook are closed.\n\n" +
      "Confirmation workflow: look up the notebook by id, ask the user " +
      "\"Remove '[name]' from your library?\" — only call after a clear yes.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notebook id to remove (from `list_notebooks`).",
        },
      },
      required: ["id"],
    },
    annotations: {
      title: "Remove notebook from library",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "search_notebooks",
    description:
      "Search the library by free-text query — matches against `name`, " +
      "`description`, `topics`, and `tags`. Returns notebook objects with " +
      "their `id` so you can chain into `select_notebook` etc.\n\n" +
      'Use this when the user references a notebook by topic ("the React ' +
      'one") instead of by exact name. If multiple notebooks match, ' +
      "propose the top 1–2 and let the user choose.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords (case-insensitive).",
        },
      },
      required: ["query"],
    },
    annotations: {
      title: "Search notebooks",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_library_stats",
    description:
      "Aggregate statistics about the local notebook library: " +
      "`total_notebooks`, `active_notebook` (id), `most_used_notebook`, " +
      "`total_queries`, `last_modified`. Useful as a quick health check or " +
      'when the user asks "what notebooks do I have?".',
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      title: "Get library statistics",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];
