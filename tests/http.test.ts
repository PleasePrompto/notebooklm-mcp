import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { startHttpTransport } from "../src/transport/http.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

test("HTTP health endpoint accepts local requests and rejects hostile origins", async () => {
  const handle = await startHttpTransport({
    port: 0,
    host: "127.0.0.1",
    connect: async () => undefined,
  });

  try {
    const address = handle.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/healthz`;

    const healthy = await fetch(url);
    assert.equal(healthy.status, 200);

    const hostile = await fetch(url, {
      headers: { Origin: "https://attacker.example" },
    });
    assert.equal(hostile.status, 403);
  } finally {
    await handle.close();
  }
});

test("non-loopback HTTP binding requires a bearer token", async () => {
  await assert.rejects(
    startHttpTransport({
      port: 0,
      host: "0.0.0.0",
      connect: async () => undefined,
    }),
    /requires NOTEBOOKLM_HTTP_AUTH_TOKEN/
  );
});

test("creates an independent MCP server for each concurrent HTTP client", async () => {
  let serverCount = 0;
  const handle = await startHttpTransport({
    port: 0,
    host: "127.0.0.1",
    connect: async (transport) => {
      const instance = ++serverCount;
      const server = new Server(
        { name: `test-server-${instance}`, version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: `tool-${instance}`,
            description: "test tool",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }));
      await server.connect(transport);
    },
  });

  const address = handle.server.address() as AddressInfo;
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const clientA = new Client({ name: "client-a", version: "1.0.0" });
  const clientB = new Client({ name: "client-b", version: "1.0.0" });

  try {
    await Promise.all([
      clientA.connect(new StreamableHTTPClientTransport(endpoint)),
      clientB.connect(new StreamableHTTPClientTransport(endpoint)),
    ]);
    const [toolsA, toolsB] = await Promise.all([clientA.listTools(), clientB.listTools()]);

    assert.equal(serverCount, 2);
    assert.notEqual(toolsA.tools[0]?.name, toolsB.tools[0]?.name);
  } finally {
    await Promise.allSettled([clientA.close(), clientB.close()]);
    await handle.close();
  }
});
