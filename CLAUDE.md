# NotebookLM MCP Server (Fork with Studio Artifacts)

## What This Fork Adds

This fork of [PleasePrompto/notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp) adds **studio artifact generation** -- the ability to create NotebookLM's rich media outputs programmatically via MCP tools.

### New Tools

| Tool | Description |
|------|-------------|
| `studio_create` | Unified tool to create any studio artifact type |
| `studio_status` | Check generation status and get download URLs |
| `studio_delete` | Delete an artifact (irreversible) |

### Supported Artifact Types

| Type | Options |
|------|---------|
| **Audio Overview** | Formats: deep_dive, brief, critique, debate. Lengths: short, default, long |
| **Video Overview** | Formats: explainer, brief, cinematic. Styles: classic, whiteboard, kawaii, anime, watercolor, retro_print, heritage, paper_craft |
| **Infographic** | Orientations: landscape, portrait, square. Styles: sketch_note, professional, bento_grid, editorial, instructional, bricks, clay, anime, kawaii, scientific |
| **Slide Deck** | Formats: detailed_deck, presenter_slides. Lengths: short, default |
| **Report** | Formats: Briefing Doc, Study Guide, Blog Post, Create Your Own |
| **Quiz** | Difficulty: easy, medium, hard. Configurable question count |
| **Flashcards** | Difficulty: easy, medium, hard |
| **Mind Map** | Auto-generates and saves concept relationship visualization |
| **Data Table** | Structured data extraction from sources |

All types support `focus_prompt` for guiding generation and `language` for localization.

## Architecture Decision: Direct RPC (not browser automation)

Studio artifacts are created via **direct HTTP calls** to NotebookLM's internal `batchexecute` API, not by clicking through the UI. This is:

- **Faster**: No browser rendering or DOM manipulation needed
- **More reliable**: No CSS selectors to break when the UI changes
- **Lighter**: Only needs cookies, not a running browser instance

The implementation:
1. Extracts Google auth cookies from the existing Patchright browser context
2. Fetches a CSRF token from the NotebookLM page
3. Makes POST requests to `/_/LabsTailwindUi/data/batchexecute` with reverse-engineered RPC payloads

### Reference Implementation

The RPC protocol and payload structures are ported from [jacob-bd/notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) (Python, MIT license). Key files studied:
- `core/base.py` -- batchexecute protocol (~300 lines)
- `core/studio.py` -- studio creation methods (~1,300 lines)
- `core/constants.py` -- RPC IDs and enum codes

## New Source Files

```
src/api/
  constants.ts       -- RPC IDs, studio type codes, enum mappings
  rpc-client.ts      -- batchexecute HTTP client (cookie auth, CSRF, retry)
  studio-client.ts   -- Studio artifact creation/polling/deletion methods
src/tools/
  definitions/
    studio.ts        -- MCP tool schemas for studio_create, studio_status, studio_delete
  studio-handlers.ts -- Bridges MCP tools to StudioClient (cookie extraction, param mapping)
```

## How to Test

```bash
# Build
bun install && bun run build

# Test via MCP (add to Claude's MCP config)
# The server registers studio tools alongside existing Q&A tools

# Example: Create an audio overview
# Use studio_create with:
#   notebook_url: "https://notebooklm.google.com/notebook/<id>"
#   artifact_type: "audio"
#   audio_format: "deep_dive"

# Check status
# Use studio_status with the same notebook_url

# The auth is shared with the existing browser session
# Run setup_auth first if not already authenticated
```

## What Works

- All 9 artifact types are implemented with full parameter support
- Cookie extraction from Patchright browser context
- CSRF token auto-extraction and refresh on expiry
- Auth retry on 401/403 errors
- Status polling with artifact URL extraction
- Artifact deletion

## Known Limitations

- Artifact generation is async -- you must poll studio_status to check completion
- Audio/video generation can take 1-5 minutes
- The batchexecute API is undocumented and may change without notice
- Download URLs are extracted from status response but download itself is not implemented
- Mind map generation is a two-step process (generate JSON + save)

## Upstream

- **Repo**: [PleasePrompto/notebooklm-mcp](https://github.com/PleasePrompto/notebooklm-mcp)
- **Version**: v1.2.1
- **Tools**: 16 (Q&A, notebook library, session management, auth)

## Development

```bash
bun install          # Install dependencies
bun run build        # Build (tsc)
bun run dev          # Dev mode with watch
```
