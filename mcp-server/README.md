# team-activity-hub-mcp-server

An MCP server that lets Claude see and update your team's [Team Activity
Hub](../README.md) — the live activity feed (GitHub commits/PRs + task
updates) and shared task board — directly from chat.

Once connected, you (or any teammate with Claude configured to use this
server) can ask things like:

- "What has the team been doing today?"
- "Show me what's still in progress"
- "Create a task for Alex to fix the login bug"
- "Mark task #12 as done"

## Requirements

- The Team Activity Hub app must already be deployed somewhere reachable
  (e.g. on Railway — see the main [README](../README.md)). This MCP server
  is a thin client around that app's API; it doesn't work standalone.
- Node.js 18+

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Configure in Claude Desktop / Cowork

Add this server to your MCP configuration (in Claude Desktop: Settings >
Developer > Edit Config, or wherever your Cowork/Claude Code MCP config
lives):

```json
{
  "mcpServers": {
    "team-activity-hub": {
      "command": "node",
      "args": ["/absolute/path/to/team-activity-hub/mcp-server/dist/index.js"],
      "env": {
        "HUB_BASE_URL": "https://your-app.up.railway.app",
        "HUB_TEAM_PASSWORD": "the-team-password",
        "HUB_BOT_NAME": "Claude"
      }
    }
  }
}
```

- `HUB_BASE_URL` — where your Team Activity Hub is deployed (no trailing slash).
- `HUB_TEAM_PASSWORD` — the same shared password your team uses to log into
  the dashboard.
- `HUB_BOT_NAME` (optional) — the name attributed to actions Claude takes
  (task creation/updates), defaults to "Claude".

Each teammate who wants Claude to see this data adds the same config
(pointing at the same `HUB_BASE_URL`) to their own Claude setup.

## Tools

- **team_activity_hub_list_activity** — read the live feed (commits, PRs, task changes)
- **team_activity_hub_list_tasks** — read the task board, optionally filtered by status/assignee
- **team_activity_hub_create_task** — create a new task (broadcasts live to everyone)
- **team_activity_hub_update_task** — update a task's title/assignee/status (broadcasts live)

## Development

```bash
npm run dev     # run with auto-reload against src/
npm run build   # compile TypeScript to dist/
npm start        # run the built server
```

## How auth works

The Hub uses a single shared team password (no per-user accounts). This
server logs in once with `HUB_TEAM_PASSWORD`, caches the session cookie, and
re-authenticates automatically if the session expires — so from Claude's
perspective it's just tool calls, no auth juggling required.
