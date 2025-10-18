<div align="center">

# NotebookLM MCP Server

An MCP server that enables Claude Code, Codex, Cursor, and other MCP clients to communicate directly with [**Google's NotebookLM**](https://notebooklm.google/).

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-2025-green.svg)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/notebooklm-mcp.svg)](https://www.npmjs.com/package/notebooklm-mcp)
[![GitHub](https://img.shields.io/github/stars/PleasePrompto/notebooklm-mcp?style=social)](https://github.com/PleasePrompto/notebooklm-mcp)
[![Changelog](https://img.shields.io/badge/changelog-1.1.0-blue)](https://github.com/PleasePrompto/notebooklm-mcp/blob/main/CHANGELOG.md)

</div>

---

## Why I Built This

I've been using AI assistants for a long time to work with documentation—upload API docs, library references, etc., and ask questions about them. But there's always been a problem: **hallucinations**. When the AI doesn't find something in the docs, it often makes stuff up anyway.

[**NotebookLM**](https://notebooklm.google/) is Google's AI-powered research assistant (powered by Gemini) that solves this. It has one killer feature: **it only responds based on the documentation you upload**. If something cannot be found in the information base, it doesn't respond. No hallucinations, just grounded information with citations.

But I was getting tired of the copy-paste dance between NotebookLM and my editor. So I built this MCP server to let Claude Code, Codex, Cursor, and other MCP clients communicate directly with NotebookLM. Now my AI assistant asks NotebookLM the questions it needs while writing code, and everything stays in one place.

---

## Installation

### Claude Code
```bash
claude mcp add notebooklm npx notebooklm-mcp@latest
```

### Codex
```bash
codex mcp add notebooklm -- npx notebooklm-mcp@latest
```

<details>
<summary>Gemini</summary>

```bash
gemini mcp add notebooklm npx notebooklm-mcp@latest
```
</details>

<details>
<summary>Cursor</summary>

Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "npx",
      "args": ["-y", "notebooklm-mcp@latest"]
    }
  }
}
```
</details>

<details>
<summary>amp</summary>

```bash
amp mcp add notebooklm -- npx notebooklm-mcp@latest
```
</details>

<details>
<summary>VS Code</summary>

```bash
code --add-mcp '{"name":"notebooklm","command":"npx","args":["notebooklm-mcp@latest"]}'
```
</details>

<details>
<summary>Other MCP clients</summary>

**Generic MCP config:**
```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "npx",
      "args": ["notebooklm-mcp@latest"]
    }
  }
}
```
</details>

---

## How to Use - Super Simple

1. **Add the MCP server** (see installation above)

2. **Log in to NotebookLM**

   Say in the chat (Claude/Codex):
   ```
   "Log me in to NotebookLM"
   ```
   A Chrome window opens → log in to Google (feel free to use a disposable Google account—never trust the internet!)

3. **Create your notebook**

   Go to [notebooklm.google.com](https://notebooklm.google.com/) and create a notebook with your documentation (PDFs, websites, Google Docs, YouTube videos, etc.)

   To share: **Share** → **Notebook access** → **"Anyone with the link"** → **Copy link**

4. **Tell Claude/Codex about it**
   ```
   "Hey, I have a notebook with information about XY. Please search for it in the notebook: [your-link]"
   ```

   Or add it to your library for automatic usage:
   ```
   "Add this NotebookLM link to our library: [your-link]"
   ```

That's it! Claude/Codex will now ask NotebookLM questions automatically when working on your task.

---

## Real Example: n8n Workflow

n8n is still new enough that Claude and GPT often hallucinate nodes and functions. So I:

1. Downloaded the complete n8n documentation (~1,200 markdown files)
2. Had Claude merge them into 50 files
3. Uploaded them to NotebookLM
4. Told Claude: **"You don't really know your way around n8n, so you need to get informed! Build me a workflow that checks Gmail for spam. Here's the NotebookLM link."**

Now it's working really well. You can watch the conversation unfold:

**Claude → NotebookLM:** "How does Gmail integration work in n8n?"
**NotebookLM:** "Use Gmail Trigger with polling, or Gmail node with Get Many operation..."

**Claude → NotebookLM:** "How do I extract the email body from Gmail API payload?"
**NotebookLM:** "Body is base64url encoded in payload.parts, use Function node to decode..."

**Claude → NotebookLM:** "How to parse OpenAI response as JSON in IF node?"
**NotebookLM:** "Set responseFormat to json, then use expression {{ $json.spam }} in IF condition..."

**Claude → NotebookLM:** "Which Gmail operations add labels and remove from inbox?"
**NotebookLM:** "Use addLabel operation with labelNamesOrIds array, then removeLabel for INBOX..."

**Claude:** "Based on my research, here's your complete workflow JSON..."

It's pretty interesting to follow the conversation. Claude asks targeted follow-ups, building complete expertise before generating anything.

---

## How It Works

When you give Claude/Codex a task, it automatically asks NotebookLM multiple questions—just like a human researcher would. Each answer triggers deeper questions until it has comprehensive understanding.

Behind the scenes:
- The server runs a real Chrome instance (via Playwright) that logs into NotebookLM
- Your session persists across restarts—no daily re-login needed
- You can save notebooks to a local library with tags and metadata
- Claude automatically picks the right notebook based on your task
- All MCP clients share the same authentication and library

NotebookLM doesn't just retrieve text chunks—it generates intelligent, contextual answers using Gemini. This creates a genuine AI-to-AI conversation where Claude asks questions and Gemini responds with synthesized knowledge from your docs.

---

## Key Features

### Automatic question asking
Claude asks NotebookLM whatever it needs to know—no manual copy-paste required.

### No hallucinations
NotebookLM answers exclusively from documents you upload. If it doesn't know, it doesn't guess.

### Smart notebook library
Store multiple NotebookLM notebooks with tags. Claude automatically selects relevant ones based on your task.

### Persistent sessions
Once authenticated, your Chrome session stays active. No need to log in every day.

### Cross-client sharing
Set up once in Claude Code, use it in Codex too. All clients share the same auth and library.

### Deep cleanup tool
Start fresh anytime: Scans your entire system for all NotebookLM data (caches, logs, temp files) and removes it with a categorized preview. Perfect for troubleshooting or clean reinstalls.

### Scale & flexibility
- Manage 100 notebooks in your library
- Each notebook: 50 sources, ~500,000 words
- 50 free queries daily per Google account
- Quick account switching for unlimited research

---

## Common Patterns

| Intent | Say | Result |
|--------|-----|--------|
| Authenticate | "Open NotebookLM auth setup" | Chrome opens for login |
| Add notebook | "Add [link] to library" | Saves notebook metadata |
| List notebooks | "Show our notebooks" | Lists all saved notebooks |
| Research first | "Research this in NotebookLM before coding" | Multi-question session |
| Fix auth | "Repair NotebookLM authentication" | Clears and re-authenticates |
| Clean restart | "Run NotebookLM cleanup" | Removes all data for fresh start |

---

## FAQ

**Is my Google account secure?**
Chrome runs locally. Credentials never leave your machine. The persistent profile stores session data like any browser would.

**What happens at the rate limit?**
Free tier allows 50 queries daily. Re-authenticate with another account or wait until tomorrow.

**Can I see the browser?**
Yes! Just tell Claude: "Research this and show me the browser." You'll see the live chat with NotebookLM.

**What if Chrome crashes?**
The server automatically recreates the browser context on the next query.

**Having issues? Try a clean start**
Run the cleanup tool to remove all NotebookLM data and start fresh while preserving your notebook library.

**What to say:** "Run NotebookLM cleanup and preserve my library"

**What happens:**
1. You'll see a categorized preview of exactly what will be deleted (browser data, caches, logs, old installation files)
2. Your notebook library stays intact - no need to re-add notebooks
3. After cleanup, just re-authenticate for a completely fresh browser session

**Important:** Close all Chrome/Chromium instances before cleanup!

**Useful for:** Authentication issues, browser conflicts, corrupted data, or when switching accounts.

---

## Configuration

**No config files needed!** Everything works out of the box with sensible defaults.

For advanced users: customize via environment variables or tool parameters (`show_browser`, etc.)

<details>
<summary>Environment variables (optional)</summary>

| Variable | Default | Purpose |
|----------|---------|---------|
| `HEADLESS` | `true` | Run Chrome invisibly |
| `MAX_SESSIONS` | `10` | Concurrent research sessions |
| `SESSION_TIMEOUT` | `900` | Seconds before session cleanup |
| `STEALTH_ENABLED` | `true` | Human-like interaction patterns |

Full configuration in [`docs/configuration.md`](./docs/configuration.md).

</details>

<details>
<summary>Storage locations</summary>

| Platform | Path |
|----------|------|
| Linux | `~/.local/share/notebooklm-mcp/` |
| macOS | `~/Library/Application Support/notebooklm-mcp/` |
| Windows | `%LOCALAPPDATA%\notebooklm-mcp\` |

Stores Chrome profile, library.json, and browser state.

</details>

---

## More Documentation

- [`docs/usage-guide.md`](./docs/usage-guide.md) – Advanced patterns and workflows
- [`docs/tools.md`](./docs/tools.md) – Tool API reference
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) – Common issues
- [`docs/configuration.md`](./docs/configuration.md) – All configuration options

---

## Disclaimer

This tool automates browser interactions with NotebookLM to make your workflow more efficient. However, a few friendly reminders:

**About browser automation:**
While I've built in humanization features (realistic typing speeds, natural delays, mouse movements) to make the automation behave more naturally, I can't guarantee Google won't detect or flag automated usage. I recommend using a dedicated Google account for automation rather than your primary account—think of it like web scraping: probably fine, but better safe than sorry!

**About CLI tools and AI agents:**
CLI tools like Claude Code, Codex, and similar AI-powered assistants are incredibly powerful, but they can make mistakes. Please use them with care and awareness:
- Always review changes before committing or deploying
- Test in safe environments first
- Keep backups of important work
- Remember: AI agents are assistants, not infallible oracles

I built this tool for myself because I was tired of the copy-paste dance between NotebookLM and my editor. I'm sharing it in the hope it helps others too, but I can't take responsibility for any issues, data loss, or account problems that might occur. Use at your own discretion and judgment.

That said, if you run into problems or have questions, feel free to open an issue on GitHub. I'm happy to help troubleshoot!

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

---

## License

MIT
