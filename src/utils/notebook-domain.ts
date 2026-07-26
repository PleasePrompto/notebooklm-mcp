/**
 * NotebookLM is reachable at two hosts Google keeps in sync by redirects:
 *   notebooklm.google.com  (canonical)   and   notebook.google.com  (rebrand alias).
 * Which one an AUTHENTICATED session lands on is account-dependent: personal →
 * notebooklm, some Workspace tenants → notebook (their OSID service cookie is bound
 * there). So host checks must accept BOTH.
 *
 * Parses the URL (not substring) so a host inside a `continue=` query param can't
 * false-match, and excludes `/login` so login-success detection doesn't fire on the
 * pre-auth page and save browser state before the OSID cookie is set.
 */
const NOTEBOOK_HOSTS = ["notebooklm.google.com", "notebook.google.com"];

/** True once the page is on the authenticated notebook app (either host, not /login). */
export function isNotebookAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return NOTEBOOK_HOSTS.includes(u.hostname) && !u.pathname.startsWith("/login");
  } catch {
    return false;
  }
}
