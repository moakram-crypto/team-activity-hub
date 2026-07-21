// Simple JSON-file-backed store. No native dependencies, so it installs and
// deploys anywhere without a build step. Fine for a small team's activity
// feed + task board; swap for a real database later if you outgrow it.
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    return { activity: [], tasks: [], nextActivityId: 1, nextTaskId: 1 };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error("Failed to read data.json, starting fresh:", err.message);
    return { activity: [], tasks: [], nextActivityId: 1, nextTaskId: 1 };
  }
}

let state = load();

function save() {
  // Synchronous write: this app's write volume is low (a team clicking
  // buttons), so blocking briefly is simpler and safer than racing async
  // writes against each other.
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function addActivity({ type, actor, message, meta }) {
  const activity = {
    id: state.nextActivityId++,
    type,
    actor,
    message,
    meta: meta || null,
    created_at: new Date().toISOString(),
  };
  state.activity.unshift(activity);
  state.activity = state.activity.slice(0, 500); // keep it bounded
  save();
  return activity;
}

function listActivity(limit = 100) {
  return state.activity.slice(0, limit);
}

function listTasks() {
  return [...state.tasks].sort((a, b) => b.id - a.id);
}

function getTaskById(id) {
  return state.tasks.find((t) => t.id === id) || null;
}

function createTask({ title, assignee }) {
  const task = {
    id: state.nextTaskId++,
    title,
    assignee: assignee || null,
    status: "todo",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.tasks.push(task);
  save();
  return task;
}

function updateTask(id, fields) {
  const task = getTaskById(id);
  if (!task) return null;

  if (fields.title !== undefined) task.title = fields.title;
  if (fields.assignee !== undefined) task.assignee = fields.assignee;
  if (fields.status !== undefined) task.status = fields.status;
  task.updated_at = new Date().toISOString();

  save();
  return task;
}

module.exports = {
  addActivity,
  listActivity,
  listTasks,
  createTask,
  updateTask,
};
