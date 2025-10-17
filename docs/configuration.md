## Configuration

Environment variables (optional)
- Auth
  - `AUTO_LOGIN_ENABLED` — `true|false` (default `false`)
  - `LOGIN_EMAIL`, `LOGIN_PASSWORD` — for auto‑login if enabled
  - `AUTO_LOGIN_TIMEOUT_MS` (default `120000`)
- Stealth / Human-like behavior
  - `STEALTH_ENABLED` — `true|false` (default `true`) — Master switch for all stealth features
  - `STEALTH_RANDOM_DELAYS` — `true|false` (default `true`)
  - `STEALTH_HUMAN_TYPING` — `true|false` (default `true`)
  - `STEALTH_MOUSE_MOVEMENTS` — `true|false` (default `true`)
- Typing speed (human‑like)
  - `TYPING_WPM_MIN` (default 160), `TYPING_WPM_MAX` (default 240)
- Delays (human‑like)
  - `MIN_DELAY_MS` (default 100), `MAX_DELAY_MS` (default 400)
- Browser
  - `HEADLESS` (default `true`), `BROWSER_TIMEOUT` (ms, default `30000`)
- Sessions
  - `MAX_SESSIONS` (default 10), `SESSION_TIMEOUT` (s, default 900)
- Multi‑instance profile strategy
  - `NOTEBOOK_PROFILE_STRATEGY` — `auto|single|isolated` (default `auto`)
  - `NOTEBOOK_CLONE_PROFILE` — clone base profile into isolated dir (default `false`)
- Cleanup (to prevent disk bloat)
  - `NOTEBOOK_CLEANUP_ON_STARTUP` (default `true`)
  - `NOTEBOOK_CLEANUP_ON_SHUTDOWN` (default `true`)
  - `NOTEBOOK_INSTANCE_TTL_HOURS` (default `72`)
  - `NOTEBOOK_INSTANCE_MAX_COUNT` (default `20`)
- Library metadata (optional hints)
  - `NOTEBOOK_DESCRIPTION`, `NOTEBOOK_TOPICS`, `NOTEBOOK_CONTENT_TYPES`, `NOTEBOOK_USE_CASES`
  - `NOTEBOOK_URL` — optional; leave empty and manage notebooks via the library

Paths (using [env-paths](https://github.com/sindresorhus/env-paths))
- **Linux**: `~/.local/share/notebooklm-mcp/`
- **macOS**: `~/Library/Application Support/notebooklm-mcp/`
- **Windows**: `%LOCALAPPDATA%\notebooklm-mcp\`

Subdirectories:
- Chrome profile: `chrome_profile/`
- Browser state: `browser_state/`
- Library: `library.json`
- Chrome instances: `chrome_profile_instances/`

