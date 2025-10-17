# Advanced Usage Guide

This guide covers advanced usage patterns, best practices, and detailed examples for the NotebookLM MCP server.

> 📘 For installation and quick start, see the main [README](../README.md).

## Research Patterns

### The Iterative Research Pattern

The server is designed to make your agent **ask questions automatically** with NotebookLM. Here's how to leverage this:

1. **Start with broad context**
   ```
   "Before implementing the webhook system, research the complete webhook architecture in NotebookLM, including error handling, retry logic, and security considerations."
   ```

2. **The agent will automatically**:
   - Ask an initial question to NotebookLM
   - Read the reminder at the end of each response
   - Ask follow-up questions to gather more details
   - Continue until it has comprehensive understanding
   - Only then provide you with a complete answer

3. **Session management**
   - The agent maintains the same `session_id` throughout the research
   - This preserves context across multiple questions
   - Sessions auto-cleanup after 15 minutes of inactivity

### Deep Dive Example

```
User: "I need to implement OAuth2 with refresh tokens. Research the complete flow first."

Agent behavior:
1. Asks NotebookLM: "How does OAuth2 refresh token flow work?"
2. Gets answer with reminder to ask more
3. Asks: "What are the security best practices for storing refresh tokens?"
4. Asks: "How to handle token expiration and renewal?"
5. Asks: "What are common implementation pitfalls?"
6. Synthesizes all answers into comprehensive implementation plan
```

## Notebook Management Strategies

### Multi-Project Setup

Organize notebooks by project or domain:

```
Production Docs Notebook → APIs, deployment, monitoring
Development Notebook → Local setup, debugging, testing
Architecture Notebook → System design, patterns, decisions
Legacy Code Notebook → Old systems, migration guides
```

### Notebook Switching Patterns

```
"For this bug fix, use the Legacy Code notebook."
"Switch to the Architecture notebook for this design discussion."
"Use the Production Docs for deployment steps."
```

### Metadata Best Practices

When adding notebooks, provide rich metadata:
```
"Add this notebook with description: 'Complete React 18 documentation including hooks, performance, and migration guides' and tags: react, frontend, hooks, performance"
```

## Authentication Management

### Account Rotation Strategy

Free tier provides 50 queries/day per account. Maximize usage:

1. **Primary account** → Main development work
2. **Secondary account** → Testing and validation
3. **Backup account** → Emergency queries when others are exhausted

```
"Switch to secondary account" → When approaching limit
"Check health status" → Verify which account is active
```

### Handling Auth Failures

The agent can self-repair authentication:

```
"NotebookLM says I'm logged out—repair authentication"
```

This triggers: `get_health` → `setup_auth` → `get_health`

## Advanced Configuration

### Performance Optimization

For faster interactions during development:
```bash
STEALTH_ENABLED=false  # Disable human-like typing
TYPING_WPM_MAX=500     # Increase typing speed
HEADLESS=false         # See what's happening
```

### Debugging Sessions

Enable browser visibility to watch the live conversation:
```
"Research this issue and show me the browser"
```

Your agent automatically enables browser visibility for that research session.

### Session Management

Monitor active sessions:
```
"List all active NotebookLM sessions"
"Close inactive sessions to free resources"
"Reset the stuck session for notebook X"
```

## Complex Workflows

### Multi-Stage Research

For complex implementations requiring multiple knowledge sources:

```
Stage 1: "Research the API structure in the API notebook"
Stage 2: "Switch to Architecture notebook and research the service patterns"
Stage 3: "Use the Security notebook to research authentication requirements"
Stage 4: "Synthesize all findings into implementation plan"
```

### Validation Workflow

Cross-reference information across notebooks:

```
1. "In Production notebook, find the current API version"
2. "Switch to Migration notebook, check compatibility notes"
3. "Verify in Architecture notebook if this aligns with our patterns"
```

## Tool Integration Patterns

### Direct Tool Calls

For manual scripting, capture and reuse session IDs:

```json
// First call - capture session_id
{
  "tool": "ask_question",
  "question": "What is the webhook structure?",
  "notebook_id": "abc123"
}

// Follow-up - reuse session_id
{
  "tool": "ask_question",
  "question": "Show me error handling examples",
  "session_id": "captured_session_id_here"
}
```

### Resource URIs

Access library data programmatically:
- `notebooklm://library` - Full library JSON
- `notebooklm://library/{id}` - Specific notebook metadata

## Best Practices

### 1. **Context Preservation**
- Always let the agent complete its research cycle
- Don't interrupt between questions in a research session
- Use descriptive notebook names for easy switching

### 2. **Knowledge Base Quality**
- Upload comprehensive documentation to NotebookLM
- Merge related docs into single notebooks (up to 500k words)
- Update notebooks when documentation changes

### 3. **Error Recovery**
- The server auto-recovers from browser crashes
- Sessions rebuild automatically if context is lost
- Profile corruption triggers automatic cleanup

### 4. **Resource Management**
- Close unused sessions to free memory
- The server maintains max 10 concurrent sessions
- Inactive sessions auto-close after 15 minutes

### 5. **Security Considerations**
- Use dedicated Google accounts for NotebookLM
- Never share authentication profiles between projects
- Backup `library.json` for important notebook collections

## Troubleshooting Patterns

### When NotebookLM returns incomplete answers
```
"The answer seems incomplete. Ask NotebookLM for more specific details about [topic]"
```

### When hitting rate limits
```
"We've hit the rate limit. Re-authenticate with the backup account"
```

### When browser seems stuck
```
"Reset all NotebookLM sessions and try again"
```

## Example Conversations

### Complete Feature Implementation
```
User: "I need to implement a webhook system with retry logic"

You: "Research webhook patterns with retry logic in NotebookLM first"
Agent: [Researches comprehensively, asking 4-5 follow-up questions]
Agent: "Based on my research, here's the implementation..."
[Provides detailed code with patterns from NotebookLM]
```

### Architecture Decision
```
User: "Should we use microservices or monolith for this feature?"

You: "Research our architecture patterns and decision criteria in the Architecture notebook"
Agent: [Gathers context about existing patterns, scalability needs, team constraints]
Agent: "According to our architecture guidelines..."
[Provides recommendation based on documented patterns]
```

---

Remember: The power of this integration lies in letting your agent **ask multiple questions** – gathering context and building comprehensive understanding before responding. Don't rush the research phase!