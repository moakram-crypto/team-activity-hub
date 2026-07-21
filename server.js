require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

const db = require("./db");

const PORT = process.env.PORT || 3000;
const TEAM_PASSWORD = process.env.TEAM_PASSWORD || "change-me";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
});

app.use(sessionMiddleware);
// Share the same session with Socket.io connections
io.engine.use(sessionMiddleware);

// GitHub webhook needs the raw body to verify the signature, so give it its
// own body parser before the generic express.json() below.
app.post(
  "/webhook/github",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-hub-signature-256"];

    if (GITHUB_WEBHOOK_SECRET) {
      if (!signature) {
        return res.status(401).send("Missing signature");
      }
      const expected =
        "sha256=" +
        crypto
          .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
          .update(req.body)
          .digest("hex");
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (
        sigBuf.length !== expBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expBuf)
      ) {
        return res.status(401).send("Invalid signature");
      }
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (err) {
      return res.status(400).send("Invalid JSON");
    }

    const event = req.headers["x-github-event"];
    handleGitHubEvent(event, payload);
    res.status(204).end();
  }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

app.post("/api/login", (req, res) => {
  const { password, name } = req.body || {};
  if (password !== TEAM_PASSWORD) {
    return res.status(401).json({ error: "Wrong password" });
  }
  req.session.authed = true;
  req.session.name = (name || "Someone").trim() || "Someone";
  res.json({ ok: true, name: req.session.name });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (req.session && req.session.authed) {
    return res.json({ authed: true, name: req.session.name });
  }
  res.json({ authed: false });
});

app.get("/api/activity", requireAuth, (req, res) => {
  res.json(db.listActivity());
});

app.get("/api/tasks", requireAuth, (req, res) => {
  res.json(db.listTasks());
});

app.post("/api/tasks", requireAuth, (req, res) => {
  const { title, assignee } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title is required" });
  }
  const task = db.createTask({ title, assignee });
  broadcastTask(task);

  const activity = db.addActivity({
    type: "task",
    actor: req.session.name,
    message: `created task "${task.title}"${
      task.assignee ? ` for ${task.assignee}` : ""
    }`,
  });
  broadcastActivity(activity);

  res.status(201).json(task);
});

app.patch("/api/tasks/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { title, assignee, status } = req.body || {};
  const task = db.updateTask(id, { title, assignee, status });
  if (!task) return res.status(404).json({ error: "Task not found" });

  broadcastTask(task);

  const activity = db.addActivity({
    type: "task",
    actor: req.session.name,
    message: `updated task "${task.title}"${
      status ? ` -> ${status}` : ""
    }`,
  });
  broadcastActivity(activity);

  res.json(task);
});

function broadcastActivity(activity) {
  io.emit("activity:new", activity);
}

function broadcastTask(task) {
  io.emit("task:update", task);
}

function handleGitHubEvent(event, payload) {
  if (event === "push") {
    const repo = payload.repository && payload.repository.full_name;
    const pusher = (payload.pusher && payload.pusher.name) || "someone";
    const commits = payload.commits || [];
    commits.forEach((commit) => {
      const activity = db.addActivity({
        type: "commit",
        actor: commit.author ? commit.author.name : pusher,
        message: `pushed to ${repo}: ${commit.message.split("\n")[0]}`,
        meta: { url: commit.url, sha: commit.id, repo },
      });
      broadcastActivity(activity);
    });
  } else if (event === "pull_request") {
    const pr = payload.pull_request;
    const repo = payload.repository && payload.repository.full_name;
    if (!pr) return;
    const activity = db.addActivity({
      type: "pull_request",
      actor: pr.user ? pr.user.login : "someone",
      message: `${payload.action} PR #${pr.number} in ${repo}: ${pr.title}`,
      meta: { url: pr.html_url, repo },
    });
    broadcastActivity(activity);
  }
}

io.on("connection", (socket) => {
  const session = socket.request.session;
  if (!session || !session.authed) {
    socket.disconnect(true);
    return;
  }
});

server.listen(PORT, () => {
  console.log(`Team Activity Hub running on http://localhost:${PORT}`);
});
