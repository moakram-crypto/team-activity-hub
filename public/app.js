const loginScreen = document.getElementById("login-screen");
const dashboardScreen = document.getElementById("dashboard-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const meName = document.getElementById("me-name");
const connStatus = document.getElementById("conn-status");

const taskForm = document.getElementById("task-form");
const activityFeed = document.getElementById("activity-feed");

const columns = {
  todo: document.getElementById("col-todo"),
  in_progress: document.getElementById("col-in_progress"),
  done: document.getElementById("col-done"),
};

let socket = null;

function showDashboard(name) {
  loginScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
  meName.textContent = name;
  loadInitialData();
  connectSocket();
}

function showLogin() {
  dashboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

async function checkSession() {
  const res = await fetch("/api/me");
  const data = await res.json();
  if (data.authed) {
    showDashboard(data.name);
  } else {
    showLogin();
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const name = document.getElementById("login-name").value;
  const password = document.getElementById("login-password").value;

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    loginError.textContent = data.error || "Login failed";
    return;
  }

  const data = await res.json();
  showDashboard(data.name);
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  showLogin();
});

taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  const assignee = document.getElementById("task-assignee").value.trim();
  if (!title) return;

  await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, assignee }),
  });

  document.getElementById("task-title").value = "";
  document.getElementById("task-assignee").value = "";
});

async function loadInitialData() {
  const [tasks, activity] = await Promise.all([
    fetch("/api/tasks").then((r) => r.json()),
    fetch("/api/activity").then((r) => r.json()),
  ]);

  Object.values(columns).forEach((col) => (col.innerHTML = ""));
  tasks.forEach(renderTask);

  activityFeed.innerHTML = "";
  activity.forEach(renderActivity);
}

function renderTask(task) {
  const existing = document.getElementById(`task-${task.id}`);
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.className = "card";
  card.id = `task-${task.id}`;

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = task.title;
  card.appendChild(title);

  if (task.assignee) {
    const assignee = document.createElement("div");
    assignee.className = "card-assignee";
    assignee.textContent = `@ ${task.assignee}`;
    card.appendChild(assignee);
  }

  const select = document.createElement("select");
  ["todo", "in_progress", "done"].forEach((status) => {
    const opt = document.createElement("option");
    opt.value = status;
    opt.textContent = status.replace("_", " ");
    if (status === task.status) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", async () => {
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: select.value }),
    });
  });
  card.appendChild(select);

  const column = columns[task.status] || columns.todo;
  column.prepend(card);
}

function renderActivity(activity) {
  const li = document.createElement("li");
  const badge = document.createElement("span");
  badge.className = `badge ${activity.type}`;
  badge.textContent = activity.type.replace("_", " ");

  const text = document.createElement("span");
  text.textContent = `${activity.actor} ${activity.message}`;

  const meta = document.createElement("div");
  meta.className = "activity-meta";
  meta.textContent = new Date(activity.created_at).toLocaleString();

  li.appendChild(badge);
  li.appendChild(text);
  li.appendChild(meta);
  activityFeed.prepend(li);
}

function connectSocket() {
  socket = io();

  socket.on("connect", () => {
    connStatus.textContent = "live";
    connStatus.classList.add("online");
  });

  socket.on("disconnect", () => {
    connStatus.textContent = "reconnecting…";
    connStatus.classList.remove("online");
  });

  socket.on("activity:new", renderActivity);
  socket.on("task:update", renderTask);
}

checkSession();
