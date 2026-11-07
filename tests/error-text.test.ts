import { describe, expect, it, vi } from "vitest";
import { extractSafeDetail, TeamworkClient } from "../src/client.js";
import { ApiError, UsageError } from "../src/errors.js";
import { apiCommand } from "../src/cli/commands/api.js";

describe("Teamwork's reason for a refusal", () => {
  it("reads the v1, v3 and Desk shapes", () => {
    expect(extractSafeDetail({ MESSAGE: "Project not found", STATUS: "Error" })).toBe("Project not found");
    expect(
      extractSafeDetail({ errors: [{ title: "Bad Request", detail: "dueAt must be a date" }] })
    ).toBe("Bad Request: dueAt must be a date");
    expect(extractSafeDetail({ error: "Ticket closed" })).toBe("Ticket closed");
  });

  it("shows short and long messages whole, without masking the middle", () => {
    expect(extractSafeDetail({ message: "Not found" })).toBe("Not found");
    const long = "You do not have permission to add tasks in this project";
    expect(extractSafeDetail({ message: long })).toBe(long);
  });

  it("removes the key if a reply repeats it, and cuts very long text", () => {
    expect(extractSafeDetail({ message: "bad key twp_secret_123" }, "twp_secret_123")).toBe("bad key ****");
    expect(extractSafeDetail({ message: "x".repeat(500) }).length).toBe(300);
  });

  it("ignores an HTML error page", () => {
    expect(extractSafeDetail("<html><body>502</body></html>")).toBe("no response detail");
  });

  it("gives a next step for the common refusals", () => {
    for (const status of [404, 422, 429, 503]) {
      const e = new ApiError({ status, statusText: "", operation: "GET /x.json", safeDetail: "" });
      expect(e.hint, String(status)).toBeTruthy();
    }
  });
});

describe("teamwork api with a body", () => {
  it("asks for a write method instead of failing as a network error", async () => {
    process.env.TEAMWORK_SITE_NAME = "acmecorp";
    process.env.TEAMWORK_API_KEY = "test-key";
    const request = vi.spyOn(TeamworkClient.prototype, "request");
    try {
      const error = await apiCommand("/tasks/1/comments.json", { data: "{}" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).hint).toContain("--method POST");
      expect(request).not.toHaveBeenCalled();
    } finally {
      delete process.env.TEAMWORK_SITE_NAME;
      delete process.env.TEAMWORK_API_KEY;
      vi.restoreAllMocks();
    }
  });
});
