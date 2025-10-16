/**
 * Custom Error Types for NotebookLM MCP Server
 */

/**
 * Error thrown when NotebookLM rate limit is exceeded
 *
 * Free users have 50 queries/day limit.
 * This error indicates the user should:
 * - Use re_auth tool to switch Google accounts
 * - Wait until tomorrow for quota reset
 * - Upgrade to Google AI Pro/Ultra for higher limits
 */
export class RateLimitError extends Error {
  constructor(message: string = "NotebookLM rate limit reached (50 queries/day for free accounts)") {
    super(message);
    this.name = "RateLimitError";

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RateLimitError);
    }
  }
}
