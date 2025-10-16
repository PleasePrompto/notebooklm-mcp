<div align="center">

# NotebookLM MCP Server

Connect Claude and Codex to Google's NotebookLM for grounded, source-based AI research.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-2025-green.svg)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/notebooklm-mcp.svg)](https://www.npmjs.com/package/notebooklm-mcp)
[![GitHub](https://img.shields.io/github/stars/PleasePrompto/notebooklm-mcp?style=social)](https://github.com/PleasePrompto/notebooklm-mcp)

</div>

---

## What it does

This MCP server enables Claude Code and Codex to communicate directly with NotebookLM in an agentic way—turning them into genuine research assistants that iteratively query your documentation. When faced with complex tasks, your agent automatically asks NotebookLM multiple questions, reads the responses, identifies knowledge gaps, and asks follow-ups—just like a human researcher would. Each answer triggers deeper questions until comprehensive understanding is achieved.

Behind this is NotebookLM, Google's RAG-powered tool using Gemini. The key difference from traditional RAG: NotebookLM doesn't just retrieve text chunks—it generates intelligent, contextual answers. This creates a genuine AI-to-AI conversation where Claude/Codex asks questions and Gemini responds with synthesized knowledge from your docs. It answers exclusively from documents you upload—no hallucinations, just grounded information with citations. The server manages authentication, maintains conversation context across questions, and handles multiple notebook libraries seamlessly.

I built this because copying answers between NotebookLM and my editor was getting tedious. But more importantly: **Now Claude/Codex knows exactly what questions to ask to get the knowledge it needs for the task.** It researches my documentation while writing code, and the whole workflow stays in one place.

---

## Example: Real research in action

<details>
<summary><b>See how Codex built a complete n8n workflow through research</b></summary>

```
Setup: Created NotebookLM notebook with complete n8n documentation
Added to library: "Add https://notebooklm.google.com/notebook/[n8n-docs] to our library"

User: "I want to create an n8n workflow that checks Gmail every morning,
      sends new emails to ChatGPT for spam evaluation, then moves spam
      to GPT_SPAM_DETECTOR folder. You don't know n8n, so research everything."

Codex → NotebookLM: "How do I fetch new Gmail messages in n8n?"
NotebookLM: "Use Gmail Trigger with polling, or Gmail node with Get Many operation..."

Codex → NotebookLM: "How to extract email body from Gmail API payload?"
NotebookLM: "Body is base64url encoded in payload.parts, use Function node to decode..."

Codex → NotebookLM: "How to parse OpenAI response as JSON in IF node?"
NotebookLM: "Set responseFormat to json, then use expression {{ $json.spam }} in IF condition..."

Codex → NotebookLM: "Which Gmail operations for adding label and removing from inbox?"
NotebookLM: "Use addLabel operation with labelNamesOrIds array, then removeLabel for INBOX..."

Codex: "Based on my research, here's your complete workflow JSON..."
[Delivered working spam_detector_workflow.json with all nodes properly configured]
```

The agent asked targeted follow-ups, building complete n8n expertise before generating the workflow.

</details>

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
<summary>Other MCP clients</summary>

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

## Quick Start

### 1. Prepare your notebook

Visit [notebooklm.google.com](https://notebooklm.google.com/) and create a notebook with your documentation. NotebookLM accepts PDFs, websites, Google Docs, YouTube videos, and more.

To share: **Share** → **Notebook access** → **"Anyone with the link"** → **Copy link**

### 2. Authenticate

```
"Open NotebookLM auth setup"
```

Chrome opens for Google sign-in. The window closes automatically once authenticated. Your session persists in the Chrome profile.

### 3. Add notebooks (optional)

You can use notebooks directly without adding them to the library:
```
"Answer how webhooks work. Documentation is here: [notebooklm-link]"
```

Or add them to the library for automatic usage:
```
"Add this NotebookLM link to our library: [your-link]"
```

**Why use the library?** Your agent automatically recognizes relevant notebooks by their tags and metadata. When you work on an API, it will automatically use the corresponding notebook without being asked.

### 4. Research

```
"Research the webhook implementation in NotebookLM before writing the code"
```

Your agent will ask multiple questions, gather context, and synthesize a complete understanding.

---

## Key Features

### Iterative research sessions
The server maintains conversation context with session IDs, enabling your agent to ask follow-up questions based on previous answers. Each response includes a reminder prompt that pushes the agent to dig deeper until fully understanding the topic.

### Smart notebook library
Store multiple NotebookLM notebooks with tags and metadata. Your agent automatically selects relevant notebooks based on the task at hand. Working on an API? It knows to use your API documentation notebook without being told.

### Direct or managed notebooks
Use notebooks on-the-fly by providing links in your request, or add them to the library for automatic selection. The server handles both patterns seamlessly.

### Persistent browser automation
Real Chrome instance maintains cookies, sessions, and auth state across restarts. Once authenticated, your session persists—no daily re-login needed.

### Cross-client sharing
All MCP clients (Claude Code, Codex, etc.) share the same authentication and notebook library. Set up once, use everywhere. Switch between clients mid-task without losing context.

### Scale & flexibility
- Manage 100 notebooks in your library
- Each notebook: 50 sources, ~500,000 words
- 50 free queries daily per Google account
- Quick account switching for unlimited research

### Account protection
Built-in humanization features help protect your Google accounts: randomized typing speeds, natural mouse movements, realistic delays between actions. The server mimics human behavior to reduce detection risk.

---

## How it works

The server runs a real Chrome instance via Playwright, maintaining cookies and session state in a persistent profile. When you authenticate, it saves the browser state to `~/.local/share/notebooklm-mcp/chrome_profile/` (Linux) or equivalent on other platforms.

Each research query maintains a session ID for context. The server reminds your agent to ask follow-up questions, creating genuine research sessions rather than one-shot queries.

Your notebook library lives in `library.json`, separate from NotebookLM itself. This lets you organize notebooks locally while NotebookLM handles the document processing.

---

## Common patterns

| Intent | Say | Result |
|--------|-----|--------|
| Authenticate | "Open NotebookLM auth setup" | Chrome opens for login |
| Add notebook | "Add [link] to library" | Saves notebook metadata |
| List notebooks | "Show our notebooks" | Lists all saved notebooks |
| Switch context | "Use the API docs notebook" | Changes active notebook |
| Deep research | "Research this thoroughly in NotebookLM" | Multi-question session |
| Fix auth | "Repair NotebookLM authentication" | Clears and re-authenticates |

---

## Configuration

<details>
<summary>Environment variables</summary>

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

## FAQ

**Is my Google account secure?**
Chrome runs locally. Credentials never leave your machine. The persistent profile stores session data like any browser would.

**What happens at the rate limit?**
Free tier allows 50 queries daily. Re-authenticate with another account or wait until tomorrow.

**Can I see the browser?**
Just tell your agent to show the browser when researching: "Research this and show me the browser." You'll see the live chat with NotebookLM.

**What if Chrome crashes?**
The server automatically recreates the browser context on the next query.

---

## Documentation

- [`docs/usage-guide.md`](./docs/usage-guide.md) – Advanced patterns and workflows
- [`docs/tools.md`](./docs/tools.md) – Tool API reference
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) – Common issues
- [`docs/configuration.md`](./docs/configuration.md) – All configuration options

---

## Disclaimer

While I've built in humanization features to make the browser automation more natural, I can't guarantee Google won't flag automated usage. Use at your own discretion—I recommend dedicated accounts for automation rather than your primary Google account. Think of it like web scraping: probably fine, but play it safe!

---

## License

MIT