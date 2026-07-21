import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Activity, hubClient, handleHubError } from "../services/hubClient.js";
import { CHARACTER_LIMIT } from "../constants.js";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

const ListActivityInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe("Maximum number of activity entries to return (default: 50)"),
    type: z
      .enum(["commit", "pull_request", "task", "all"])
      .default("all")
      .describe(
        "Filter to only this activity type: 'commit' (GitHub pushes), 'pull_request' (GitHub PRs), 'task' (task board changes), or 'all'"
      ),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' for a readable feed or 'json' for structured data"),
  })
  .strict();

type ListActivityInput = z.infer<typeof ListActivityInputSchema>;

function formatActivityMarkdown(items: Activity[]): string {
  if (items.length === 0) return "No activity yet.";

  const lines = ["# Team Activity Feed", ""];
  for (const item of items) {
    const badge =
      item.type === "commit" ? "📦 commit" : item.type === "pull_request" ? "🔀 PR" : "✅ task";
    lines.push(`- **[${badge}]** ${item.actor} ${item.message} _(${item.created_at})_`);
  }
  return lines.join("\n");
}

export function registerActivityTools(server: McpServer): void {
  server.registerTool(
    "team_activity_hub_list_activity",
    {
      title: "List Team Activity",
      description: `Get the team's live activity feed: GitHub commits, pull requests, and task board changes, newest first.

Use this to answer questions like "what has the team been doing today", "who pushed code recently", or "what changed on the task board". This does NOT create or modify anything — read-only.

Args:
  - limit (number): Max entries to return, 1-500 (default: 50)
  - type ('commit' | 'pull_request' | 'task' | 'all'): Filter to one activity type (default: 'all')
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format: { "count": number, "activity": [{ "id", "type", "actor", "message", "meta", "created_at" }] }

Examples:
  - "What has the team pushed to GitHub today?" -> type="commit"
  - "Show me recent task updates" -> type="task"
  - "What's everyone been up to?" -> type="all"`,
      inputSchema: ListActivityInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListActivityInput) => {
      try {
        const all = await hubClient.request<Activity[]>("GET", "/api/activity");
        const filtered =
          params.type === "all" ? all : all.filter((a) => a.type === params.type);
        const limited = filtered.slice(0, params.limit);

        const output = { count: limited.length, activity: limited };

        let text: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          text = formatActivityMarkdown(limited);
        } else {
          text = JSON.stringify(output, null, 2);
        }

        if (text.length > CHARACTER_LIMIT) {
          text =
            text.slice(0, CHARACTER_LIMIT) +
            `\n\n[Truncated — response exceeded ${CHARACTER_LIMIT} characters. Use a smaller 'limit' or a 'type' filter.]`;
        }

        return {
          content: [{ type: "text", text }],
          structuredContent: output,
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleHubError(error) }] };
      }
    }
  );
}
