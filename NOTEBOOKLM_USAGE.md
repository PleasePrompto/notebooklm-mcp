# NotebookLM MCP – Chat-first usage

Operate the MCP server entirely from your conversation. Below are common phrases and best practices drawn from real sessions (like the n8n workflow example).

> 📘 For complete setup instructions, technical details, configuration options, and platform support, see the main [README](./README.md).

## 1. Preparation
- Have a Google account ready (throwaway accounts work fine).
- Visit <https://notebooklm.google/> and click **Try NotebookLM**.
- Create a notebook via the **New** button and upload your documentation. NotebookLM lets you store **100 notebooks**, each with **up to 50 sources** and roughly **500,000 words**—perfect for merged doc sets.
- **Share the notebook**: Click **Share** (top right) → change **Notebook access** from "Restricted" to **"Anyone with the link"** → optionally restrict **Viewer permissions** to **"Chat only"** → click **Copy link**. Give this link to Claude/Codex so it can add the notebook to your library.

> **💡 Cross-Client Sharing**: All MCP clients (Claude Code, Codex, etc.) share the same authentication and notebook library. Authenticate once, add notebooks once—switch between clients without re-login or re-adding notebooks. See the [Data Storage & Cross-Platform Support](./README.md#data-storage--cross-platform-support) section in the main README for storage locations and details.

## 2. Handy phrases
- **Auth setup:** “Open NotebookLM auth setup so I can sign in.”
- **Health check:** “Run the NotebookLM health check.”
- **Add notebook:** “Add this NotebookLM link to our library: <url>.”
- **List notebooks:** “Show me the notebooks we already stored.”
- **Switch notebooks:** “Use the <name/id> notebook for this task.”
- **Update notebook:** “Rename the n8n documentation notebook to highlight GPT integration.”
- **Remove notebook:** “Remove the old prototype notebook from our library.”
- **Deep research:** “Before you answer, research the full solution in NotebookLM.”
- **Repair auth:** “NotebookLM is failing—repair authentication.”
- **Inspect library JSON:** “Read `notebooklm://library`.”

## 3. Manual login flow
1. Ask for auth setup. Chrome launches.
2. Sign in with the Google account you prefer.
3. When NotebookLM loads, close the window. The server saves cookies, session storage, and headers.
4. Ask for a health check if you’d like confirmation (`get_health`).

## 4. Managing notebooks
- **Adding**: paste a NotebookLM link and approve the metadata recap. The library JSON is stored in `library.json` (see [Data Storage](./README.md#data-storage--cross-platform-support) for exact location on your platform).
- **Updating**: describe the change (e.g., topics, description, tags) and confirm before the agent calls `update_notebook`.
- **Removing**: explicitly confirm when the agent asks before it calls `remove_notebook` (actual NotebookLM notebooks remain untouched).

## 5. Research pattern
1. Tell the agent to research before answering.
2. It calls `ask_question`, keeping the same `session_id`, and every answer ends with:
   > EXTREMELY IMPORTANT: Is that ALL you need to know? …
3. Encourage it to ask follow-up questions until everything is clear.
4. Only once it’s satisfied does it respond to you.

## 6. Switching accounts
- “Reauthenticate with a different Google account.”
- The server wipes the profile, launches Chrome again, and you sign in manually.
- Handy when you hit the **50 chat turns/day** limit or want to separate projects.

## 7. Best practices
- Capture the first `session_id` if you script tool calls manually; reuse it for context.
- Ask for auth repair whenever NotebookLM reports expired cookies.
- Use `show_browser: true` on `ask_question` when you want to watch the browser during debugging.
- Disable stealth typing (`STEALTH_ENABLED=false`) before launching if you want faster, non-human interactions.
- Remember: NotebookLM only answers from the notebooks you supply—the richer the knowledge base, the better the outcome.

Happy building!
