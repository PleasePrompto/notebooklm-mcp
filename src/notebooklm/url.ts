const NOTEBOOKLM_HOSTS = new Set(["notebook.google.com", "notebooklm.google.com"]);
const NOTEBOOK_PATH = /^\/notebook\/[a-zA-Z0-9_-]+\/?$/;

export function isNotebookLmPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && NOTEBOOKLM_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Validate and normalize a NotebookLM notebook URL before it is persisted or
 * opened in the authenticated browser context.
 */
export function normalizeNotebookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Notebook URL must be a valid absolute URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Notebook URL must use HTTPS");
  }
  if (!NOTEBOOKLM_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Notebook URL host must be notebook.google.com or notebooklm.google.com");
  }
  if (!NOTEBOOK_PATH.test(url.pathname)) {
    throw new Error("Notebook URL must match https://notebook.google.com/notebook/<notebook-id>");
  }

  url.hash = "";
  return url.toString();
}
