import axios, { AxiosError, AxiosInstance } from "axios";
import { HUB_BASE_URL, HUB_TEAM_PASSWORD, HUB_BOT_NAME } from "../constants.js";

export interface Activity {
  id: number;
  type: "commit" | "pull_request" | "task";
  actor: string;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface Task {
  id: number;
  title: string;
  assignee: string | null;
  status: "todo" | "in_progress" | "done";
  created_at: string;
  updated_at: string;
}

/**
 * Thin client around the Team Activity Hub's session-cookie-based API.
 * Logs in once with the shared team password, caches the session cookie,
 * and transparently re-authenticates if the session expires.
 */
class HubClient {
  private axiosInstance: AxiosInstance;
  private sessionCookie: string | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor() {
    if (!HUB_BASE_URL) {
      throw new Error(
        "HUB_BASE_URL environment variable is required (e.g. https://your-app.up.railway.app)"
      );
    }
    if (!HUB_TEAM_PASSWORD) {
      throw new Error("HUB_TEAM_PASSWORD environment variable is required");
    }

    this.axiosInstance = axios.create({
      baseURL: HUB_BASE_URL,
      timeout: 15000,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true, // we handle status codes ourselves
    });
  }

  private async login(): Promise<void> {
    const response = await this.axiosInstance.post("/api/login", {
      name: HUB_BOT_NAME,
      password: HUB_TEAM_PASSWORD,
    });

    if (response.status !== 200) {
      throw new Error(
        `Failed to authenticate with Team Activity Hub (status ${response.status}). Check HUB_TEAM_PASSWORD.`
      );
    }

    const setCookie = response.headers["set-cookie"];
    if (!setCookie || setCookie.length === 0) {
      throw new Error("Login succeeded but no session cookie was returned.");
    }
    // Keep just the cookie pair (name=value), drop attributes like Path/HttpOnly.
    this.sessionCookie = setCookie[0].split(";")[0];
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionCookie) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  /**
   * Makes an authenticated request against the hub API, transparently
   * logging in (or re-logging in, if the session expired) as needed.
   */
  async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown
  ): Promise<T> {
    await this.ensureSession();

    const doRequest = () =>
      this.axiosInstance.request<T>({
        method,
        url: path,
        data: body,
        headers: this.sessionCookie ? { Cookie: this.sessionCookie } : {},
      });

    let response = await doRequest();

    if (response.status === 401) {
      // Session likely expired — log in again once and retry.
      this.sessionCookie = null;
      await this.ensureSession();
      response = await doRequest();
    }

    if (response.status < 200 || response.status >= 300) {
      const message =
        (response.data as { error?: string } | undefined)?.error ||
        `Request failed with status ${response.status}`;
      throw new HubApiError(message, response.status);
    }

    return response.data;
  }
}

export class HubApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "HubApiError";
  }
}

export function handleHubError(error: unknown): string {
  if (error instanceof HubApiError) {
    switch (error.status) {
      case 400:
        return `Error: ${error.message}`;
      case 401:
        return "Error: Could not authenticate with Team Activity Hub. Check HUB_TEAM_PASSWORD.";
      case 404:
        return "Error: Not found. Double-check the task ID.";
      default:
        return `Error: ${error.message} (status ${error.status})`;
    }
  }
  if (error instanceof AxiosError) {
    if (error.code === "ECONNABORTED") {
      return "Error: Request to Team Activity Hub timed out. Is HUB_BASE_URL reachable?";
    }
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return `Error: Could not reach Team Activity Hub at the configured HUB_BASE_URL. Check the URL and that the app is running.`;
    }
  }
  return `Error: Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

export const hubClient = new HubClient();
