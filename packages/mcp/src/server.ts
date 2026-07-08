/**
 * codingverse MCP server — wires the 4 tools to a stdio JSON-RPC transport.
 *
 * Uses the low-level `Server` + `setRequestHandler` API from the MCP SDK
 * (stable in v1.29.0; the high-level `McpServer` is the newer alternative but
 * the low-level API matches our plain-JSON-schema tool definitions cleanly).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, listTools } from "./tools.js";

/**
 * Start the codingverse MCP server on stdio. Resolves once the server is
 * connected to the transport; the process stays alive serving requests until
 * stdin closes.
 */
export async function startServer(): Promise<void> {
  const server = new Server(
    { name: "codingverse", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return callTool(name, args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[cv-mcp] codingverse MCP server listening on stdio");
}

export { callTool, listTools } from "./tools.js";
