export const HUB_BASE_URL = (process.env.HUB_BASE_URL || "").replace(/\/+$/, "");
export const HUB_TEAM_PASSWORD = process.env.HUB_TEAM_PASSWORD || "";
export const HUB_BOT_NAME = process.env.HUB_BOT_NAME || "Claude";

// Maximum size of a single tool response, in characters. Keeps large
// activity/task lists from overwhelming the model's context.
export const CHARACTER_LIMIT = 25000;
