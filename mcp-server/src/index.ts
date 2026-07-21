#!/usr/bin/env node
/**
 * MCP server for Team Activity Hub.
 *
 * Exposes the team's live activity feed (GitHub commits/PRs + task updates)
 * and shared task board as MCP tools, so Claude can see and update what the
 * team is working on directly from chat.
 *
 * Supports two transports, chosen via the TRANSPORT env var:
 *   - "stdio" (default): for local Claude Desktop config. Only reachable by
 *     local sessions running on the same machine as this process.
 *   - "http": for deploying as a real web service and registering as a
 *     custom connector. This is the one remote Cowork sessions can reach.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerTaskTools } from "./tools/tasks.js";

function buildServer(): McpServer {
  const server = new McpServer({
    name: "team-activity-hub-mcp-server",
    version: "1.0.0",
  });
  registerActivityTools(server);
  registerTaskTools(server);
  return server;
}

function checkRequiredEnv(): void {
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
}

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Team Activity Hub MCP server running via stdio");
}

async function runHttp(): Promise<void> {
  const accessToken = process.env.MCP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error(
      "ERROR: MCP_ACCESS_TOKEN environment variable is required for HTTP transport (this protects your tools from being called by anyone who finds the URL)"
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/mcp", async (req, res) => {
    // Claude's custom connector UI takes just a URL (no custom headers) and
    // otherwise expects OAuth, which is overkill here. So we accept the
    // token either as a query param (?token=...) — for pasting straight
    // into the connector URL field — or as a Bearer header, for anything
    // that can set headers (curl, other MCP clients).
    const authHeader = req.headers["authorization"];
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const providedToken =
      authHeader === `Bearer ${accessToken}` ? accessToken : queryToken;

    if (providedToken !== accessToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Stateless: a fresh server + transport per request. Simpler to run and
    // scale than session-based streaming, and fine for this server since
    // tools have no cross-request state of their own (the Hub API holds it).
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`Team Activity Hub MCP server running via HTTP on port ${port}`);
  });
}

checkRequiredEnv();

const transportMode = process.env.TRANSPORT || "stdio";
if (transportMode === "http") {
  runHttp().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
