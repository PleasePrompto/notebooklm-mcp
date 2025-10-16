<div align="center">

# NotebookLM MCP Server

I fell in love with NotebookLM because it’s one of the best “RAG-style” research companions I’ve used. I used to upload docs, ask NotebookLM questions, then copy the answers back into Codex/Claude Code by hand. It worked, but it was clunky. So I built **notebooklm-mcp** so my code agents can talk to NotebookLM directly—no copy/paste, just grounded answers right inside the IDE chat.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-2025-green.svg)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/notebooklm-mcp.svg)](https://www.npmjs.com/package/notebooklm-mcp)
[![GitHub](https://img.shields.io/github/stars/PleasePrompto/notebooklm-mcp?style=social)](https://github.com/PleasePrompto/notebooklm-mcp)

</div>

---

## Why you might want this

* **Grounded answers on demand** – the server drives a real Chrome session, so Gemini always cites from your NotebookLM notebooks.
* **Agent-first flow** – speak naturally to Claude/Codex; it calls the MCP tools and every answer ends with a reminder to keep asking until the task is complete.
* **No hallucinations** – NotebookLM only answers with what’s in your notebooks. Feed it good documentation and you’ll get accurate output.
* **Library management** – add, update, remove, or search notebooks without leaving chat.
* **Persistent auth** – Chrome profile keeps cookies/sessions; switch Google accounts whenever you like.

Free NotebookLM accounts allow **50 chat turns per day**. Hit the cap? Re-run auth setup with another Google account and keep going.

> **💡 Cross-Client Sharing**: All MCP clients (Claude Code, Codex, etc.) share the same authentication and notebook library. Authenticate once, add notebooks once—switch between clients without re-login or re-adding notebooks.

**Preparation checklist**
1. Grab a Google account (throwaway is fine).
2. Visit <https://notebooklm.google/> and click **Try NotebookLM**.
3. Upload your docs via the **New** button. NotebookLM lets you store **100 notebooks**, each with **up to 50 sources** and roughly **500,000 words**—plenty for merged documentation sets.
4. Share the notebook: Click **Share** (top right) → change **Notebook access** from "Restricted" to **"Anyone with the link"** → optionally restrict **Viewer permissions** to **"Chat only"** → click **Copy link**. Give this link to Claude/Codex so it can add the notebook to your library.

---

## Quick tour

| Task | Say this in chat | Under the hood |
|------|------------------|----------------|
| First-time login | “Open NotebookLM auth setup so I can sign in.” | Launches Chrome, waits for manual login, saves auth state. |
| Health check | “Run the NotebookLM health check.” | Calls `get_health` and reports sessions/auth. |
| Add a notebook | “Add this NotebookLM link to our library.” | Calls `add_notebook`, gathers metadata, confirms with you first. |
| List notebooks | “Show me the notebooks we already stored.” | Calls `list_notebooks` and presents IDs/topics. |
| Switch notebooks | “Use the React docs notebook for this.” | Calls `select_notebook`. |
| Update notebook | “Rename the React notebook description to include Next.js 14.” | Calls `update_notebook` with the fields you approve. |
| Remove notebook | “Remove the old React notebook from our library.” | Calls `remove_notebook` after confirmation. |
| Deep research | “Plan the webhook workflow with NotebookLM before you answer.” | Iterative `ask_question` calls with the same session. |
| Fix auth | “NotebookLM says I’m logged out—repair authentication.” | Runs `get_health` → `setup_auth` → `get_health`. |
| Inspect library JSON | “Read `notebooklm://library`.” | Returns library metadata as JSON. |

Every `ask_question` reply ends with:
> EXTREMELY IMPORTANT: Is that ALL you need to know? …
so the agent remembers to plan follow-up questions before it answers you.

---

## Conversation-led quick start

### Conversation tips (inspired by the n8n workflow test)
- **State the goal and share the notebook upfront.** Claude instantly knew to add the n8n documentation notebook before researching.
- **Confirm library changes.** The agent asks before adding/updating/removing notebooks—say “yes/no” so your library stays tidy.
- **Let the agent interrogate NotebookLM.** Each answer ends with the reminder to keep asking questions; encourage it to follow through before replying to you.
- **Keep sessions scoped.** Start a new session for a new project so context doesn’t leak.
- **Review the output.** Spot-check JSON, node types, connections—if something’s off, the agent can recheck the doc and fix it.
- **Feed NotebookLM quality sources.** The answers are only as good as the docs you upload—no hallucinations, just your knowledge base.

1. **Install & register the server**
   ```bash
   npm install -g notebooklm-mcp   # or run with npx notebooklm-mcp
   ```
   Configure your MCP host, for example:
   ```json
   {
     "mcpServers": {
       "notebooklm": {
         "command": "npx",
         "args": ["notebooklm-mcp"],
         "env": {
           "AUTO_LOGIN_ENABLED": "false"
         }
       }
     }
   }
   ```

2. **Authenticate through chat**
   * Ask your agent to “open NotebookLM auth setup”.
   * Chrome opens; sign in with the Google account you want to use.
   * When NotebookLM loads, close the window. Optionally ask it to run `get_health` to confirm.

3. **Add notebooks as you go**
   * Paste a NotebookLM link: “Add https://notebooklm.google.com/notebook/abc123 to our library.”
   * The agent confirms metadata before writing to the library.

4. **Research before answering**
   * “Before you answer, research the n8n Gmail spam workflow in NotebookLM.”
   * The agent keeps the same `session_id`, asks successive questions, reads the reminder, and only then replies.

5. **Reauthenticate whenever needed**
   * “Reauthenticate with a different Google account.”
   * The server clears the profile, opens Chrome, and you sign in again.

---

## How it works under the hood

* Real Chrome instance via Playwright (Patchright) keeps cookies, fingerprint, and session storage persistent.
* `SessionManager` enforces timeouts, max sessions, and auto cleanup.
* Library metadata (`library.json`) lives under `${CONFIG.dataDir}`.
* Browser profile lives under `${CONFIG.chromeProfileDir}`; delete it to reset auth.
* All tools are exposed through MCP—no built-in prompts or slash commands.
* NotebookLM only answers from the notebooks you supply. If the info isn’t there, Gemini won’t invent it.

---

## Data Storage & Cross-Platform Support

**Shared State Architecture**: All MCP clients (Claude Code, Codex, etc.) share the same authentication, notebooks, and browser state. Authenticate once, add notebooks once, and they're available everywhere.

### Storage Locations

All data is stored in platform-specific directories using [env-paths](https://github.com/sindresorhus/env-paths):

| Platform | Base Path |
|----------|-----------|
| **Linux** | `~/.local/share/notebooklm-mcp/` |
| **macOS** | `~/Library/Application Support/notebooklm-mcp/` |
| **Windows** | `%LOCALAPPDATA%\notebooklm-mcp\` |

### What's Stored

* **Chrome Profile** (`chrome_profile/`) – Browser cookies, session storage, fingerprint (persistent across restarts)
* **Notebook Library** (`library.json`) – All notebooks you've added with metadata
* **Browser State** (`browser_state/`) – Auth snapshots (legacy/fallback)
* **Isolated Instances** (`chrome_profile_instances/`) – Temporary profiles for concurrent MCP server instances

### Platform Support

* **Linux**: ✅ Fully tested and production-ready
* **macOS**: Should work (dependencies support it, but not extensively tested)
* **Windows**: Untested (technically compatible, but no guarantees)

---

## FAQ

**Can I trust the auth flow?**
Yes. Chrome runs locally, and the server never handles your Google credentials beyond Playwright's APIs. Use a dedicated account if you prefer.

**What happens when NotebookLM hits the 50-query limit?**
You'll see a rate-limit error. Ask the agent to reopen auth setup with another account or wait until the next day. The free tier allows 50 chat turns/day—swap accounts via auth setup when you hit the cap.

**Do I need to manage session IDs manually?**
Claude/Codex usually keep it for you. If you call tools manually, capture the first `session_id` and reuse it for follow-ups.

**Can I show the browser while the agent runs?**
Yes—set `show_browser: true` on `ask_question`, or ask the agent to toggle it for debugging.

**Does the server still ship prompts or slash commands?**
No. Everything is driven by natural-language instructions.

**How do I keep the agent on track?**
Share the notebook link, grant permission for library edits, and remind it to plan with NotebookLM before replying—just like in the n8n workflow example above.

**What if Chrome crashes?**
The next `ask_question` recreates the browser context automatically.

**What if authentication fails?**
Ask the agent to repair auth—it will run `get_health`, reopen Chrome, and verify again.

**Should I back up my data?**
Yes—back up `library.json` (see Data Storage section above for location) if you switch machines or want to preserve your notebook library.

---

## Configuration highlights

| Variable | Default | Purpose |
|----------|---------|---------|
| `NOTEBOOK_URL` | `""` | Legacy default notebook (library usage is recommended instead). |
| `AUTO_LOGIN_ENABLED` | `false` | Enable scripted login (requires `LOGIN_EMAIL` + `LOGIN_PASSWORD`). |
| `HEADLESS` | `true` | Run Chrome headless (agents can override with `show_browser`). |
| `MAX_SESSIONS` | `10` | Maximum concurrent NotebookLM sessions. |
| `SESSION_TIMEOUT` | `900` | Inactive seconds before a session auto-closes. |
| `STEALTH_ENABLED` | `true` | Human-like typing/mouse behaviour. |

See [`docs/configuration.md`](./docs/configuration.md) for the full list (profile strategy, typing speeds, cleanup settings, etc.).

---

## Documentation

* [`docs/quickstart.md`](./docs/quickstart.md) – conversational setup.
* [`docs/tools.md`](./docs/tools.md) – tool/resource reference.
* [`docs/troubleshooting.md`](./docs/troubleshooting.md) – common issues & fixes.
* [`NOTEBOOKLM_USAGE.md`](./NOTEBOOKLM_USAGE.md) – chat scenarios and phrases.

---

## License

MIT
