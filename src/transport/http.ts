/**
 * Streamable-HTTP transport for the MCP server (issue #4).
 *
 * Hosts the MCP protocol over HTTP using the SDK's
 * `StreamableHTTPServerTransport`. Built on Node's stdlib `http` module so we
 * don't pull in Express just to forward requests. Two operations:
 *
 *   POST /mcp        — JSON-RPC requests/responses
 *   GET  /healthz    — liveness probe (200 OK with version)
 *
 * Multiple sessions are supported via the `Mcp-Session-Id` header — each
 * session keeps its own transport so concurrent clients don't tread on each
 * other. Session lifecycle is fully owned by the SDK; we just route.
 */

import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../utils/logger.js";

export interface HttpTransportOptions {
  port: number;
  host?: string;
  authToken?: string;
  allowedOrigins?: readonly string[];
  allowedHosts?: readonly string[];
  maxBodyBytes?: number;
  /** Connect callback invoked once per new session — wires the McpServer to the transport. */
  connect: (transport: StreamableHTTPServerTransport) => Promise<void>;
}

export interface HttpTransportHandle {
  server: HttpServer;
  close: () => Promise<void>;
}

const SESSION_HEADER = "mcp-session-id";

export async function startHttpTransport(opts: HttpTransportOptions): Promise<HttpTransportHandle> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer((req, res) => {
    void handleRequest(req, res, transports, opts).catch((err) => {
      if (err instanceof HttpRequestError) {
        log.warning(`⚠️  [HTTP] Rejected request: ${err.message}`);
      } else {
        log.error(`❌ [HTTP] Unhandled request error: ${err}`);
      }
      if (!res.headersSent) {
        const status = err instanceof HttpRequestError ? err.status : 500;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: status === 500 ? "internal server error" : String(err.message),
          })
        );
      }
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  const bindHost = opts.host ?? "127.0.0.1";
  if (!isLoopbackHost(bindHost) && !opts.authToken) {
    throw new Error("HTTP transport bound outside localhost requires NOTEBOOKLM_HTTP_AUTH_TOKEN");
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      log.success(
        `🌐 HTTP transport listening on http://${opts.host ?? "127.0.0.1"}:${opts.port}/mcp`
      );
      resolve();
    });
  });

  return {
    server,
    close: async () => {
      for (const t of transports.values()) {
        try {
          await t.close();
        } catch {
          /* ignore — best-effort shutdown */
        }
      }
      transports.clear();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

/**
 * Use the McpServer high-level Server class — it accepts any Transport.
 * Bridge helper kept for callers wiring an existing McpServer instance.
 */
export async function bindMcpServer(
  mcpServer: McpServer,
  transport: StreamableHTTPServerTransport
): Promise<void> {
  await mcpServer.connect(transport);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  transports: Map<string, StreamableHTTPServerTransport>,
  opts: HttpTransportOptions
): Promise<void> {
  applyHttpSecurity(req, res, opts);
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      Allow: "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (url.pathname === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", protocol: "mcp-streamable-http" }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found", expected: "/mcp" }));
    return;
  }

  const sessionId = headerString(req.headers[SESSION_HEADER]);

  if (req.method === "GET" || req.method === "DELETE") {
    // SSE streams + session termination — both routed by session.
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unknown session" }));
      return;
    }
    await transport.handleRequest(req, res);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json", Allow: "POST, GET, DELETE" });
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const body = await readJsonBody(req, opts.maxBodyBytes ?? 1024 * 1024);

  // Re-use existing session, or initialise a new one when the client says so.
  let transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport && isInitializeRequest(body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };
    await opts.connect(transport);
  }

  if (!transport) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "no transport for request — pass an `Mcp-Session-Id` header or send `initialize`",
      })
    );
    return;
  }

  await transport.handleRequest(req, res, body);
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maxBytes) {
      throw new HttpRequestError(413, `request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpRequestError(400, "invalid JSON request body");
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

class HttpRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

function applyHttpSecurity(
  req: IncomingMessage,
  res: ServerResponse,
  opts: HttpTransportOptions
): void {
  const hostHeader = headerString(req.headers.host);
  const hostname = hostHeader ? stripPort(hostHeader).toLowerCase() : "";
  const bindHost = (opts.host ?? "127.0.0.1").toLowerCase();
  const allowedHosts = new Set(
    (opts.allowedHosts ?? [bindHost, "localhost", "127.0.0.1", "::1"]).map((value) =>
      value.toLowerCase()
    )
  );
  if (!hostname || (!allowedHosts.has(hostname) && !isLoopbackHost(hostname))) {
    throw new HttpRequestError(403, "host is not allowed");
  }

  const origin = headerString(req.headers.origin);
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new HttpRequestError(403, "origin is invalid");
    }
    const explicitlyAllowed = new Set(opts.allowedOrigins ?? []).has(originUrl.origin);
    if (!explicitlyAllowed && !isLoopbackHost(originUrl.hostname)) {
      throw new HttpRequestError(403, "origin is not allowed");
    }
    res.setHeader("Access-Control-Allow-Origin", originUrl.origin);
    res.setHeader("Vary", "Origin");
  }

  if (opts.authToken && req.method !== "OPTIONS") {
    const authorization = headerString(req.headers.authorization);
    const supplied = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!safeTokenEquals(supplied, opts.authToken)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      throw new HttpRequestError(401, "missing or invalid bearer token");
    }
  }
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(1, end) : host;
  }
  return host.replace(/:\d+$/, "");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
