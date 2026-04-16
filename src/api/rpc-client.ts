/**
 * RPC Client for NotebookLM's internal batchexecute API.
 *
 * Ported from jacob-bd/notebooklm-mcp-cli base.py (MIT license).
 *
 * Uses Patchright's page context to make fetch() calls from within the
 * browser, which ensures cookies are sent correctly with proper domain
 * matching. This avoids the CookieMismatch issue that occurs when sending
 * cookies via a flat Cookie header from Node.js.
 */

import type { Page, BrowserContext } from "patchright";
import { log } from "../utils/logger.js";

const BASE_URL = "https://notebooklm.google.com";
const BATCHEXECUTE_URL = `${BASE_URL}/_/LabsTailwindUi/data/batchexecute`;
const BL_FALLBACK = "boq_labs-tailwind-frontend_20260108.06_p0";

/**
 * Cookie data (kept for API compatibility, but not used for auth anymore).
 */
export interface CookieData {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

/**
 * Authentication error from NotebookLM API.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * RPC error from NotebookLM API.
 */
export class RPCError extends Error {
  public readonly errorCode: number;
  public readonly detailType: string;

  constructor(message: string, errorCode: number, detailType: string = "") {
    super(message);
    this.name = "RPCError";
    this.errorCode = errorCode;
    this.detailType = detailType;
  }
}

/**
 * Internal interface for the response from browser-side fetch.
 */
interface BrowserFetchResult {
  ok: boolean;
  status: number;
  url: string;
  text: string;
}

/**
 * Direct HTTP client for NotebookLM's batchexecute API.
 *
 * Uses a Patchright Page to make requests from within the browser context,
 * ensuring proper cookie domain matching.
 */
export class RPCClient {
  private page: Page | null = null;
  private context: BrowserContext | null = null;
  private csrfToken: string = "";
  private sessionId: string = "";
  private buildLabel: string = "";
  private initialized: boolean = false;

  /**
   * Set the browser page to use for API calls.
   * The page must be on a notebooklm.google.com origin.
   */
  setPage(page: Page): void {
    this.page = page;
    this.initialized = false;
  }

  /**
   * Set the browser context (used to create a page if none provided).
   */
  setContext(context: BrowserContext): void {
    this.context = context;
    this.initialized = false;
  }

  /**
   * Initialize by extracting CSRF token from the current page.
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.csrfToken) return;

    if (!this.page && this.context) {
      // Create a new page and navigate to NotebookLM
      this.page = await this.context.newPage();
      await this.page.goto(`${BASE_URL}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Wait for page to load
      await this.page.waitForTimeout(2000);
    }

    if (!this.page) {
      throw new Error("No page or context available for RPC client");
    }

    log.info("  [RPC] Extracting auth tokens from browser page...");

    const currentUrl = this.page.url();
    if (!currentUrl.includes("notebooklm.google.com")) {
      // Navigate to NotebookLM
      await this.page.goto(`${BASE_URL}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await this.page.waitForTimeout(2000);

      const newUrl = this.page.url();
      if (newUrl.includes("accounts.google.com")) {
        throw new AuthenticationError(
          "Authentication expired. Please re-authenticate using setup_auth or re_auth."
        );
      }
    }

    // Extract tokens from page HTML via page.evaluate (runs in browser context)
    const tokens = await this.page.evaluate((): { csrf: string; sid: string; bl: string } => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = globalThis as any;
      const html: string = doc.document.documentElement.outerHTML;
      const csrfMatch = html.match(/"SNlM0e":"([^"]+)"/);
      const sidMatch = html.match(/"FdrFJe":"([^"]+)"/);
      const blMatch = html.match(/"cfb2h":"([^"]+)"/);
      return {
        csrf: csrfMatch ? csrfMatch[1] : "",
        sid: sidMatch ? sidMatch[1] : "",
        bl: blMatch ? blMatch[1] : "",
      };
    });

    if (!tokens.csrf) {
      throw new Error("Could not extract CSRF token from NotebookLM page");
    }

    this.csrfToken = tokens.csrf;
    this.sessionId = tokens.sid;
    this.buildLabel = tokens.bl;
    this.initialized = true;

    log.info(`  [RPC] Tokens extracted (csrf=${this.csrfToken.slice(0, 10)}...)`);
  }

  /**
   * Build the batchexecute request body.
   */
  private buildRequestBody(rpcId: string, params: unknown): string {
    const paramsJson = JSON.stringify(params);
    const fReq = [[[rpcId, paramsJson, null, "generic"]]];
    const fReqJson = JSON.stringify(fReq);

    const parts = [`f.req=${encodeURIComponent(fReqJson)}`];
    if (this.csrfToken) {
      parts.push(`at=${encodeURIComponent(this.csrfToken)}`);
    }

    return parts.join("&") + "&";
  }

  /**
   * Build the batchexecute URL with query parameters.
   */
  private buildUrl(rpcId: string, sourcePath: string = "/"): string {
    const params = new URLSearchParams({
      rpcids: rpcId,
      "source-path": sourcePath,
      bl: this.buildLabel || BL_FALLBACK,
      hl: "en",
      rt: "c",
    });

    if (this.sessionId) {
      params.set("f.sid", this.sessionId);
    }

    return `${BATCHEXECUTE_URL}?${params.toString()}`;
  }

  /**
   * Parse the batchexecute response.
   */
  private parseResponse(responseText: string): unknown[] {
    let text = responseText;
    if (text.startsWith(")]}'")) {
      text = text.slice(4);
    }

    const lines = text.trim().split("\n");
    const results: unknown[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        continue;
      }

      const byteCount = parseInt(line, 10);
      if (!isNaN(byteCount)) {
        i++;
        if (i < lines.length) {
          try {
            const data = JSON.parse(lines[i]);
            results.push(data);
          } catch {
            // Not valid JSON
          }
          i++;
        }
      } else {
        try {
          const data = JSON.parse(line);
          results.push(data);
        } catch {
          // Not valid JSON
        }
        i++;
      }
    }

    return results;
  }

  /**
   * Extract the result for a specific RPC ID from parsed response.
   */
  private extractRpcResult(parsedResponse: unknown[], rpcId: string): unknown {
    for (const chunk of parsedResponse) {
      if (!Array.isArray(chunk)) continue;

      for (const item of chunk) {
        if (!Array.isArray(item) || item.length < 3) continue;
        if (item[0] !== "wrb.fr" || item[1] !== rpcId) continue;

        // Check for error in item[5]
        if (item.length > 5 && Array.isArray(item[5]) && item[5].length > 0) {
          const errorCode = typeof item[5][0] === "number" ? item[5][0] : null;

          if (errorCode !== null) {
            if (errorCode === 16) {
              throw new AuthenticationError("RPC Error 16: Authentication expired");
            }

            let detailType = "";
            if (item[5].length > 2 && Array.isArray(item[5][2])) {
              for (const detail of item[5][2]) {
                if (Array.isArray(detail) && detail.length > 0 && typeof detail[0] === "string") {
                  detailType = detail[0];
                  break;
                }
              }
            }

            const grpcCodes: Record<number, string> = {
              3: "INVALID_ARGUMENT",
              5: "NOT_FOUND",
              7: "PERMISSION_DENIED",
              16: "UNAUTHENTICATED",
            };
            const friendlyType = detailType || grpcCodes[errorCode] || "unknown";

            throw new RPCError(
              `API error (code ${errorCode}): ${friendlyType}`,
              errorCode,
              detailType
            );
          }
        }

        const resultStr = item[2];
        if (typeof resultStr === "string") {
          try {
            return JSON.parse(resultStr);
          } catch {
            return resultStr;
          }
        }
        return resultStr;
      }
    }

    return null;
  }

  /**
   * Execute an RPC call using the browser page's fetch context.
   */
  async callRpc(
    rpcId: string,
    params: unknown,
    path: string = "/",
    timeout: number = 30000,
    retried: boolean = false
  ): Promise<unknown> {
    await this.initialize();

    if (!this.page) {
      throw new Error("No browser page available for RPC calls");
    }

    const body = this.buildRequestBody(rpcId, params);
    const url = this.buildUrl(rpcId, path);

    try {
      // Execute fetch from within the browser page context
      // This ensures cookies are sent with proper domain matching
      const result: BrowserFetchResult = await this.page.evaluate(
        async ({ url, body, csrfToken, timeout }) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "X-Same-Domain": "1",
                ...(csrfToken ? { "X-Goog-Csrf-Token": csrfToken } : {}),
              },
              body,
              signal: controller.signal,
              credentials: "include",
            });

            clearTimeout(timeoutId);

            return {
              ok: response.ok,
              status: response.status,
              url: response.url,
              text: await response.text(),
            };
          } catch (error: any) {
            clearTimeout(timeoutId);
            throw new Error(error.message || String(error));
          }
        },
        { url, body, csrfToken: this.csrfToken, timeout }
      );

      if (!result.ok) {
        const isAuthError = [400, 401, 403].includes(result.status);
        if (isAuthError && !retried) {
          log.warning("  [RPC] Auth error, refreshing tokens and retrying...");
          this.initialized = false;
          return this.callRpc(rpcId, params, path, timeout, true);
        }
        throw new Error(`HTTP ${result.status}`);
      }

      const parsed = this.parseResponse(result.text);
      return this.extractRpcResult(parsed, rpcId);
    } catch (error) {
      if (error instanceof AuthenticationError && !retried) {
        log.warning("  [RPC] Authentication expired, refreshing tokens...");
        this.initialized = false;
        return this.callRpc(rpcId, params, path, timeout, true);
      }
      throw error;
    }
  }

  /**
   * Close the RPC client's page if it was created internally.
   */
  async close(): Promise<void> {
    // Don't close the page -- it may be shared with other code
    this.page = null;
    this.context = null;
    this.initialized = false;
  }
}
