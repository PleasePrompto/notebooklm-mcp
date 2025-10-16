/**
 * NotebookLM Library Types
 *
 * Defines the structure for managing multiple NotebookLM notebooks
 * in a persistent library that Claude can manage autonomously.
 */

/**
 * Single notebook entry in the library
 */
export interface NotebookEntry {
  // Identification
  id: string; // Unique identifier (slug format, e.g., "n8n-docs")
  url: string; // NotebookLM URL
  name: string; // Display name (e.g., "n8n Workflow Automation")

  // Metadata for Claude's autonomous decision-making
  description: string; // What knowledge is in this notebook
  topics: string[]; // Topics covered
  content_types: string[]; // Types of content (docs, examples, etc.)
  use_cases: string[]; // When to use this notebook

  // Usage tracking
  added_at: string; // ISO timestamp when added
  last_used: string; // ISO timestamp of last use
  use_count: number; // How many times used

  // Optional tags for organization
  tags?: string[]; // Custom tags for filtering
}

/**
 * The complete notebook library
 */
export interface Library {
  notebooks: NotebookEntry[]; // All notebooks in library
  active_notebook_id: string | null; // Currently selected notebook
  last_modified: string; // ISO timestamp of last modification
  version: string; // Library format version (for future migrations)
}

/**
 * Input for adding a new notebook
 */
export interface AddNotebookInput {
  url: string; // Required: NotebookLM URL
  name: string; // Required: Display name
  description: string; // Required: What's in it
  topics: string[]; // Required: Topics covered
  content_types?: string[]; // Optional: defaults to ["documentation", "examples"]
  use_cases?: string[]; // Optional: defaults based on description
  tags?: string[]; // Optional: custom tags
}

/**
 * Input for updating a notebook
 */
export interface UpdateNotebookInput {
  id: string; // Required: which notebook to update
  name?: string;
  description?: string;
  topics?: string[];
  content_types?: string[];
  use_cases?: string[];
  tags?: string[];
  url?: string; // Allow changing URL
}

/**
 * Statistics about library usage
 */
export interface LibraryStats {
  total_notebooks: number;
  active_notebook: string | null;
  most_used_notebook: string | null;
  total_queries: number;
  last_modified: string;
}
