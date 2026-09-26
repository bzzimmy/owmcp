#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerExecute } from "./tools/execute.js";
import { registerLogs } from "./tools/logs.js";
import { registerStatus } from "./tools/status.js";

const server = new McpServer({ name: "owmcp", version: "0.1.0" });

registerStatus(server);
registerExecute(server);
registerLogs(server);

await server.connect(new StdioServerTransport());
console.error("owmcp running on stdio");
