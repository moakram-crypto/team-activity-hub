# team-activity-hub-mcp-server

An MCP server that lets Claude see and update your team's [Team Activity
Hub](../README.md) — the live activity feed (GitHub commits/PRs + task
updates) and shared task board — directly from chat.

Once connected, you (or any teammate with this connector enabled) can ask
things like:

- "What has the team been doing today?"
- "Show me what's still in progress"
- "Create a task for Alex to fix the login bug"
- "Mark task #12 as done"

## Two ways to run this, for two kinds of Claude sessions

Claude Cowork sessions run in one of two places: **locally** on your own
computer, or **remotely** on Anthropic's servers (this is the default/beta
mode most people are on). This matters a lot here:

- **Local sessions** can reach MCP servers running as a process on your
  machine (`stdio` transport, configured in `claude_desktop_config.json`).
- **Remote sessions cannot reach anything running only on your machine.**
  They can only reach MCP servers exposed as a real web service, added as a
  **custom connector** in Claude's settings.

If you're not sure which you're on, assume remote — it's the default — and
use the HTTP setup below. The stdio setup is included for completeness if
you know you're using a local desktop session.

## Requirements

- The Team Activity Hub app must already be deployed somewhere reachable
  (e.g. on Railway — see the main [README](../README.md)). This MCP server
  is a thin client around that app's API; it doesn't work standalone.
- Node.js 18+

## Setup (both modes)

```bash
cd mcp-server
npm install
npm run build
```

---

## Option A: HTTP (for remote Cowork sessions — most people want this)

### 1. Deploy this as its own Railway service

This lives in the same repo as the Hub app but is a separate deployable
service (it has its own `package.json` in this `mcp-server/` folder).

1. In Railway, click **New > GitHub Repo** and pick this repo again (or
   **New Service** inside your existing project).
2. Under **Settings > Root Directory**, set it to `mcp-server` — this tells
   Railway to build/run from this subfolder, not the Hub app at the repo
   root.
3. Under **Variables**, add:
   - `HUB_BASE_URL` — your deployed Hub's URL (e.g.
     `https://team-activity-hub-production.up.railway.app`)
   - `HUB_TEAM_PASSWORD` — same team password the Hub uses
   - `HUB_BOT_NAME` — optional, defaults to "Claude"
   - `TRANSPORT` — set to `http`
   - `MCP_ACCESS_TOKEN` — make up a long random string. This protects your
     tools from being called by anyone who finds the URL (see below for why
     it's a query param, not a header).
4. Under **Settings > Networking**, click **Generate Domain** to get this
   service's own public URL, e.g. `team-activity-hub-mcp-production.up.railway.app`.

### 2. Add it as a custom connector in Claude

Claude's custom connector UI takes a single URL and otherwise expects OAuth
— it doesn't have a field for arbitrary headers. So this server accepts its
access token as a query parameter on that URL instead of (or in addition to)
an `Authorization` header.

1. In Claude, go to **Settings > Connectors > Add custom connector**.
2. For the URL, use:
   ```
   https://<your-mcp-domain>/mcp?token=<your MCP_ACCESS_TOKEN>
   ```
3. Leave the OAuth fields blank, click **Add**.
4. Enable the connector for a conversation via the **+** button > Connectors.
5. Ask Claude something like "what's on the team task board?" to confirm it
   can call the tools.

**Security note:** anyone with this full URL (including the token) can call
these tools, which can read and write your team's task board. Treat it like
a password — don't paste it somewhere public, and rotate `MCP_ACCESS_TOKEN`
on Railway (then update the connector URL) if you ever suspect it leaked.

---

## Option B: stdio (only works for local desktop Cowork sessions)

Add this to `claude_desktop_config.json` (Claude menu > Settings > Developer
> Edit Config on macOS):

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

Fully quit and reopen Claude Desktop afterward. `TRANSPORT` is left unset
here, which defaults to `stdio`.

**If this doesn't show up:** your Cowork session is almost certainly running
remotely (the current default), and remote sessions cannot reach locally
configured MCP servers at all — no restart fixes that. Use Option A instead.

## Tools

- **team_activity_hub_list_activity** — read the live feed (commits, PRs, task changes)
- **team_activity_hub_list_tasks** — read the task board, optionally filtered by status/assignee
- **team_activity_hub_create_task** — create a new task (broadcasts live to everyone)
- **team_activity_hub_update_task** — update a task's title/assignee/status (broadcasts live)

## Development

```bash
npm run dev                    # stdio, with auto-reload against src/
npm run build                  # compile TypeScript to dist/
npm start                      # run the built server (stdio by default)

# Run in HTTP mode locally, e.g. to test before deploying:
HUB_BASE_URL=http://localhost:3000 \
HUB_TEAM_PASSWORD=your-password \
TRANSPORT=http PORT=3100 MCP_ACCESS_TOKEN=dev-token \
npm start
```

## How auth works

Two separate credentials are involved, and it's worth keeping them straight:

1. **`HUB_TEAM_PASSWORD`** — this server's own login to the Hub's API. It
   logs in once, caches the session cookie, and re-authenticates
   automatically if the session expires.
2. **`MCP_ACCESS_TOKEN`** (HTTP mode only) — controls who can call *this*
   MCP server at all. Without it, anyone who found your Railway URL could
   invoke the tools (and thus read/write your team's data) without ever
   knowing the Hub's password.
