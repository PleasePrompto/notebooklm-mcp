## Quick Start (chat-first)

1. **Install the server**
   ```bash
   npm install -g notebooklm-mcp   # or run with npx notebooklm-mcp
   ```

2. **Register it with your MCP host**
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

3. **Ask your agent to authenticate**
   - “Open NotebookLM auth setup so I can sign in.”
   - Chrome launches; sign in with the Google account you want to use.
   - Close the window once NotebookLM loads. Optionally say “Run the NotebookLM health check” to call `get_health`.

4. **Add notebooks via chat**
   - Paste a public NotebookLM link: “Add https://notebooklm.google.com/notebook/abc123 to our library.”
   - The agent confirms metadata with you before calling `add_notebook`.

5. **Research before answering**
   - “Before you reply, research the full webhook workflow in NotebookLM.”
   - The agent keeps the same `session_id`, reads the reminder in each answer, and only then responds.

6. **Reauthenticate whenever needed**
   - “Reauthenticate with a different Google account.”
   - The server clears the profile and launches Chrome again for manual login.

Tips
- NotebookLM free tier: 50 chat turns per day. Switch accounts by repeating the auth setup.
- Leave `NOTEBOOK_URL` empty and manage notebooks in the library (`library.json` under `${CONFIG.dataDir}`).
- Authentication failing? Ask for an auth repair; the agent runs `get_health` → `setup_auth` → `get_health` with your approval before resetting sessions.
