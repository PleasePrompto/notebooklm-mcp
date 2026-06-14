/**
 * Global type definitions for NotebookLM MCP Server
 */

/**
 * Session information returned by the API
 */
export interface SessionInfo {
  id: string;
  created_at: number;
  last_activity: number;
  age_seconds: number;
  inactive_seconds: number;
  message_count: number;
  notebook_url: string;
}

/**
 * Result from asking a question
 */
export interface AskQuestionResult {
  status: "success" | "error";
  question: string;
  answer?: string;
  error?: string;
  notebook_url: string;
  session_id?: string;
  session_info?: {
    age_seconds: number;
    message_count: number;
    last_activity: number;
  };
  /**
   * Provenance envelope (issue #42). Tells the host agent that `answer` is
   * LLM-generated synthesis over user-uploaded (potentially attacker-
   * influenceable) documents, not a deterministic retrieval result.
   */
  _provenance?: {
    provider: "google-notebooklm";
    model: "gemini-2.5";
    via: "chrome-automation";
    grounding: "user-uploaded-documents";
    ai_generated: true;
  };
  /**
   * Structured citations extracted from the answer (issue #20). Populated when
   * the caller passes `source_format` other than `none`.
   */
  sources?: Array<{
    marker: string;
    number: number;
    sourceName: string;
    sourceText: string;
  }>;
  /**
   * Effective `source_format` used to render `answer`. Mirrors what the caller
   * requested (or the default `none`) so downstream tools can adapt.
   */
  source_format?: "none" | "inline" | "footnotes" | "json";
}

/**
 * Tool call result for MCP (generic wrapper for tool responses)
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * MCP Tool definition
 */
export interface Tool {
  name: string;
  title?: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Options for human-like typing
 */
export interface TypingOptions {
  wpm?: number; // Words per minute
  withTypos?: boolean;
}

/**
 * Progress callback function for MCP progress notifications
 */
export type ProgressCallback = (
  message: string,
  progress?: number,
  total?: number
) => Promise<void>;
