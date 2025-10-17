## Tools

### Core
- `ask_question`
  - Parameters: `question` (string, required), optional `session_id`, `notebook_id`, `notebook_url`, `show_browser`.
  - Returns NotebookLM's answer plus the follow-up reminder.
- `list_sessions`, `close_session`, `reset_session`
  - Inspect or manage active browser sessions.
- `get_health`
  - Summaries auth status, active sessions, and configuration.
- `setup_auth`
  - Opens the persistent Chrome profile so you can log in manually.
- `re_auth`
  - Switch to a different Google account or re-authenticate.
  - Use when NotebookLM rate limit is reached (50 queries/day for free accounts).
  - Closes all sessions, clears auth data, and opens browser for fresh login.

### Notebook library
- `add_notebook` – Safe conversational add; expects confirmation before writing.
- `list_notebooks` – Returns id, name, topics, URL, metadata for every entry.
- `get_notebook` – Fetch a single notebook by id.
- `select_notebook` – Set the active default notebook.
- `update_notebook` – Modify metadata fields.
- `remove_notebook` – Removes entries from the library (not the original NotebookLM notebook).
- `search_notebooks` – Simple query across name/description/topics/tags.
- `get_library_stats` – Aggregate statistics (total notebooks, usage counts, etc.).

### Resources
- `notebooklm://library`
  - JSON representation of the full library: active notebook, stats, individual notebooks.
- `notebooklm://library/{id}`
  - Fetch metadata for a specific notebook. The `{id}` completion pulls from the library automatically.

**Remember:** Every `ask_question` response ends with a reminder that nudges your agent to keep asking until the user’s task is fully addressed.
