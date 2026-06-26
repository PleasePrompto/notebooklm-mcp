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
} from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../utils/logger.js";

export interface HttpTransportOptions {
  port: number;
  host?: string;
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
      log.error(`❌ [HTTP] Unhandled request error: ${err}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal server error" }));
      }
    });
  });

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
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

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

  const body = await readJsonBody(req);

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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON request body");
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
