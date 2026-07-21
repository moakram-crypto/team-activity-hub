import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Task, hubClient, handleHubError } from "../services/hubClient.js";
import { CHARACTER_LIMIT } from "../constants.js";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

const TaskStatusEnum = z.enum(["todo", "in_progress", "done"]);

const ListTasksInputSchema = z
  .object({
    status: TaskStatusEnum.optional().describe(
      "Only return tasks with this status. Omit to return all tasks."
    ),
    assignee: z
      .string()
      .max(200)
      .optional()
      .describe("Only return tasks assigned to this person (case-insensitive exact match)"),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' for a readable board or 'json' for structured data"),
  })
  .strict();

type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

const CreateTaskInputSchema = z
  .object({
    title: z
      .string()
      .min(1, "Title is required")
      .max(300, "Title must not exceed 300 characters")
      .describe("Short description of the task, e.g. 'Fix login redirect bug'"),
    assignee: z
      .string()
      .max(200)
      .optional()
      .describe("Name of the team member this task is for. Omit to leave unassigned."),
  })
  .strict();

type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

const UpdateTaskInputSchema = z
  .object({
    task_id: z.number().int().positive().describe("ID of the task to update"),
    title: z.string().min(1).max(300).optional().describe("New title, if renaming the task"),
    assignee: z
      .string()
      .max(200)
      .optional()
      .describe("New assignee name. Pass an empty string to unassign."),
    status: TaskStatusEnum.optional().describe(
      "New status: 'todo', 'in_progress', or 'done'"
    ),
  })
  .strict();

type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

function formatTasksMarkdown(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks found.";

  const byStatus: Record<string, Task[]> = { todo: [], in_progress: [], done: [] };
  for (const task of tasks) byStatus[task.status]?.push(task);

  const lines = ["# Task Board", ""];
  for (const [status, label] of [
    ["todo", "To do"],
    ["in_progress", "In progress"],
    ["done", "Done"],
  ] as const) {
    lines.push(`## ${label} (${byStatus[status].length})`);
    if (byStatus[status].length === 0) {
      lines.push("_none_");
    } else {
      for (const task of byStatus[status]) {
        const assignee = task.assignee ? ` — @${task.assignee}` : " — unassigned";
        lines.push(`- #${task.id} ${task.title}${assignee}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    "team_activity_hub_list_tasks",
    {
      title: "List Team Tasks",
      description: `Get the team's shared task board (todo / in progress / done).

Use this to answer "what is X working on", "what's left to do", or "show me the task board". Read-only — does not modify anything.

Args:
  - status ('todo' | 'in_progress' | 'done'): Filter to one column (default: all)
  - assignee (string): Filter to tasks assigned to this person (default: all)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format: { "count": number, "tasks": [{ "id", "title", "assignee", "status", "created_at", "updated_at" }] }`,
      inputSchema: ListTasksInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListTasksInput) => {
      try {
        let tasks = await hubClient.request<Task[]>("GET", "/api/tasks");
        if (params.status) tasks = tasks.filter((t) => t.status === params.status);
        if (params.assignee) {
          const needle = params.assignee.toLowerCase();
          tasks = tasks.filter((t) => t.assignee?.toLowerCase() === needle);
        }

        const output = { count: tasks.length, tasks };
        let text =
          params.response_format === ResponseFormat.MARKDOWN
            ? formatTasksMarkdown(tasks)
            : JSON.stringify(output, null, 2);

        if (text.length > CHARACTER_LIMIT) {
          text = text.slice(0, CHARACTER_LIMIT) + "\n\n[Truncated — narrow with 'status' or 'assignee'.]";
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

  server.registerTool(
    "team_activity_hub_create_task",
    {
      title: "Create Team Task",
      description: `Create a new task on the shared team task board. It appears instantly for everyone with the dashboard open, and shows up in the activity feed as created by this MCP's bot name (default "Claude").

Args:
  - title (string): Short description of the task, required
  - assignee (string, optional): Team member to assign it to

Returns: the created task { "id", "title", "assignee", "status": "todo", "created_at", "updated_at" }

Don't use this for updating an existing task — use team_activity_hub_update_task instead.`,
      inputSchema: CreateTaskInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: CreateTaskInput) => {
      try {
        const task = await hubClient.request<Task>("POST", "/api/tasks", {
          title: params.title,
          assignee: params.assignee,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created task #${task.id}: "${task.title}"${
                task.assignee ? ` (assigned to ${task.assignee})` : ""
              }`,
            },
          ],
          structuredContent: task as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleHubError(error) }] };
      }
    }
  );

  server.registerTool(
    "team_activity_hub_update_task",
    {
      title: "Update Team Task",
      description: `Update an existing task's title, assignee, or status. Changes broadcast instantly to everyone with the dashboard open.

Args:
  - task_id (number): ID of the task to update (get this from team_activity_hub_list_tasks)
  - title (string, optional): New title
  - assignee (string, optional): New assignee. Pass "" to unassign.
  - status ('todo' | 'in_progress' | 'done', optional): New status

At least one of title/assignee/status should be provided.

Returns: the updated task { "id", "title", "assignee", "status", "created_at", "updated_at" }

Error Handling:
  - Returns "Error: Not found" if task_id doesn't exist — call team_activity_hub_list_tasks to find the right ID.`,
      inputSchema: UpdateTaskInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: UpdateTaskInput) => {
      try {
        const task = await hubClient.request<Task>("PATCH", `/api/tasks/${params.task_id}`, {
          title: params.title,
          assignee: params.assignee,
          status: params.status,
        });
        return {
          content: [
            {
              type: "text",
              text: `Updated task #${task.id}: "${task.title}" — status: ${task.status}${
                task.assignee ? `, assignee: ${task.assignee}` : ""
              }`,
            },
          ],
          structuredContent: task as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleHubError(error) }] };
      }
    }
  );
}
