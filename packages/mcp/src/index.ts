/**
 * @codingverse/mcp — MCP server exposing codingverse pack/search/expand/get_file
 * as tools over stdio. Entry point: `startServer()` (wired from `bin.ts`).
 */
export { startServer } from "./server.js";
export { callTool, listTools } from "./tools.js";
