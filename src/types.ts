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
}

/**
 * Tool call result for MCP (generic wrapper for tool responses)
 */
export interface ToolResult<T = any> {
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
    properties: Record<string, any>;
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
 * Options for waiting for answers
 */
export interface WaitForAnswerOptions {
  question?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  ignoreTexts?: string[];
  debug?: boolean;
}

/**
 * Progress callback function for MCP progress notifications
 */
export type ProgressCallback = (
  message: string,
  progress?: number,
  total?: number
) => Promise<void>;

/**
 * Global state for the server
 */
export interface ServerState {
  playwright: any;
  sessionManager: any;
  authManager: any;
}
