## Troubleshooting

Browser closed / `newPage` errors
- Symptom: `browserContext.newPage: Target page/context/browser has been closed`.
- Fix: The server auto‑recovers (recreates context and page). Re‑run the tool.

Profile lock / `ProcessSingleton` errors
- Cause: Another Chrome is using the base profile.
- Fix: `NOTEBOOK_PROFILE_STRATEGY=auto` (default) falls back to isolated per‑instance profiles; or set `isolated`.

Authentication issues
- Ask the agent to repair authentication; it will run `get_health` → `setup_auth` → `get_health`.
- For CLI auto‑login, set `AUTO_LOGIN_ENABLED=true` with `LOGIN_EMAIL`, `LOGIN_PASSWORD`.

Typing speed too slow/fast
- Adjust `TYPING_WPM_MIN`/`MAX`; or disable stealth typing by setting `STEALTH_ENABLED=false`.

Rate limit reached
- Symptom: "NotebookLM rate limit reached (50 queries/day for free accounts)".
- Fix: Use `re_auth` tool to switch to a different Google account, or wait until tomorrow.
- Upgrade: Google AI Pro/Ultra gives 5x higher limits.

No notebooks found
- Ask to add the NotebookLM link you need.
- Ask to list the stored notebooks, then choose the one to activate.
