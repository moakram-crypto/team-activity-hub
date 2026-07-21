#!/usr/bin/env node
/**
 * MCP server for Team Activity Hub.
 *
 * Exposes the team's live activity feed (GitHub commits/PRs + task updates)
 * and shared task board as MCP tools, so Claude can see and update what the
 * team is working on directly from chat.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerTaskTools } from "./tools/tasks.js";

const server = new McpServer({
  name: "team-activity-hub-mcp-server",
  version: "1.0.0",
});

registerActivityTools(server);
registerTaskTools(server);

async function main(): Promise<void> {
  if (!process.env.HUB_BASE_URL) {
    console.error(
      "ERROR: HUB_BASE_URL environment variable is required (e.g. https://your-app.up.railway.app)"
    );
    process.exit(1);
  }
  if (!process.env.HUB_TEAM_PASSWORD) {
    console.error("ERROR: HUB_TEAM_PASSWORD environment variable is required");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Team Activity Hub MCP server running via stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
