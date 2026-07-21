# Team Activity Hub

A real-time dashboard for a small team: a live activity feed (GitHub commits
and PRs, plus task updates) and a shared task board. Everyone who's logged in
sees changes the instant they happen — no refresh needed.

- **Login:** one shared team password (set by you), each person just types
  their own name so activity is attributed correctly.
- **Task board:** create tasks, assign them, drag them (well, use the
  dropdown) between To do / In progress / Done. Every change broadcasts
  live to everyone connected.
- **GitHub activity:** a webhook receiver picks up pushes and pull requests
  from any repo you point at it and drops them into the same live feed.

## Run locally

```bash
npm install
cp .env.example .env   # then edit TEAM_PASSWORD, SESSION_SECRET
npm start
```

Open http://localhost:3000, enter the team password, and you're in. Open a
second browser (or incognito window) and log in again to see updates sync
live between the two.

## Deploy on Railway (so your team can actually reach it)

This app needs to run somewhere always-on so teammates can hit it from their
own computers — running it on just your laptop won't work for that. Railway
has a free tier and deploys straight from a GitHub repo.

1. Push this repo to GitHub (if you haven't already).
2. Go to **railway.app**, sign in (GitHub login is easiest), and click
   **New Project > Deploy from GitHub repo**.
3. Pick this repo. Railway auto-detects it's a Node app and builds it.
4. Under your new service's **Variables** tab, add:
   - `TEAM_PASSWORD` — the password your team will log in with
   - `SESSION_SECRET` — any long random string
   - `GITHUB_WEBHOOK_SECRET` — any long random string (you'll reuse this in
     step 6 below)
5. Under **Settings > Networking**, click **Generate Domain** to get a public
   URL like `team-activity-hub-production.up.railway.app`. Share that URL
   with your team — that's what they open to log in.
6. **Persisting data across redeploys:** this app stores its data in a local
   `data.json` file. On Railway, add a **Volume** (Settings > Volumes) and
   mount it at `/app` (or wherever your app runs from) so `data.json`
   survives redeploys. Without a volume, a redeploy resets the activity feed
   and task board.

### Wiring up GitHub so commits/PRs show up live

For each repo you want tracked:

1. Go to the repo on GitHub > **Settings > Webhooks > Add webhook**.
2. **Payload URL:** `https://<your-railway-domain>/webhook/github`
3. **Content type:** `application/json`
4. **Secret:** the same value you set for `GITHUB_WEBHOOK_SECRET` on Railway.
5. **Which events:** choose "Let me select individual events" and check
   **Pushes** and **Pull requests** (or just pick "Send me everything" —
   the app ignores event types it doesn't recognize).
6. Save. GitHub will send a test ping; you should see it succeed (green
   checkmark) in the webhook's "Recent Deliveries" tab.

Repeat for every repo your team wants visible in the shared feed.

## How it works

- **Backend:** Express + Socket.io. All API routes require a logged-in
  session; Socket.io shares that same session so only authenticated
  teammates receive live updates.
- **Storage:** a plain JSON file (`data.json`) — no database server to
  set up. Fine for a small team; swap in Postgres later if you outgrow it.
- **Auth:** one shared password (set via `TEAM_PASSWORD`). Good enough for a
  small trusted team; if you need individual accounts later, that's a bigger
  change (real user table + per-user passwords).

## Limitations to know about

- Data lives in a single JSON file — great for simplicity, but it means no
  concurrent-write guarantees beyond "small team clicking buttons
  occasionally." It won't hold up under heavy simultaneous traffic.
- The shared-password model means anyone with the password can post as any
  name they type — there's no verification that "Alex" is really Alex.
- Only `push` and `pull_request` GitHub events are handled today. Other
  event types (issues, comments, releases) are easy to add in
  `handleGitHubEvent` in `server.js` if you want them later.
