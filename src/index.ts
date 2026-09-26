#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "owmcp", version: "0.1.0" });

// Tools go here: server.registerTool(...)

await server.connect(new StdioServerTransport());
console.error("owmcp running on stdio");
