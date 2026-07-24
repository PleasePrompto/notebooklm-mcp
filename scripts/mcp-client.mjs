import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL(process.env.NOTEBOOKLM_MCP_URL ?? "http://127.0.0.1:3000/mcp");
const action = process.argv[2] ?? "health";
const client = new Client({ name: "notebooklm-mcp-local-client", version: "1.0.0" });

function printToolResult(result) {
  const text = result.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

  if (text) {
    console.log(text);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const tools = await client.listTools();
  console.log(`Connected to ${endpoint.href}`);
  console.log(`Available tools: ${tools.tools.length}`);

  if (action === "health") {
    printToolResult(await client.callTool({ name: "get_health", arguments: {} }));
  } else if (action === "auth") {
    console.log("Opening the interactive Google authentication flow...");
    printToolResult(
      await client.callTool(
        {
          name: "setup_auth",
          arguments: { show_browser: true },
        },
        undefined,
        {
          timeout: 600_000,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: 650_000,
        }
      )
    );
  } else if (action === "ask") {
    const question =
      process.argv.slice(3).join(" ").trim() ||
      "Responde únicamente: sesión de NotebookLM funcionando.";
    console.log(`Question: ${question}`);
    printToolResult(
      await client.callTool(
        {
          name: "ask_question",
          arguments: { question },
        },
        undefined,
        {
          timeout: 180_000,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: 240_000,
        }
      )
    );
  } else {
    throw new Error(`Unknown action "${action}". Use "health", "auth", or "ask".`);
  }
} finally {
  await client.close();
}
