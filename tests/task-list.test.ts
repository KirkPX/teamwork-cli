import { describe, expect, it, vi } from "vitest";
import { taskList } from "../src/cli/commands/task.js";
import { TeamworkClient } from "../src/client.js";

function withCredentials<T>(fn: () => Promise<T>): Promise<T> {
  process.env.TEAMWORK_SITE_NAME = "test-site";
  process.env.TEAMWORK_API_KEY = "test-api-key";
  return fn().finally(() => {
    delete process.env.TEAMWORK_SITE_NAME;
    delete process.env.TEAMWORK_API_KEY;
    vi.restoreAllMocks();
  });
}

describe("taskList", () => {
  it("resolves a numeric project id and prints JSON output", async () => {
    const getProjectTasks = vi
      .spyOn(TeamworkClient.prototype, "getProjectTasks")
      .mockResolvedValue([{ id: 1, name: "Review / Update / Approve Email 1" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await withCredentials(async () => {
      await taskList({ project: "12345", json: true });

      expect(getProjectTasks).toHaveBeenCalledWith(12345);
      expect(logSpy).toHaveBeenCalledWith(
        JSON.stringify([{ id: 1, name: "Review / Update / Approve Email 1" }], null, 2)
      );
    });
  });

  it("resolves a project URL", async () => {
    const getProjectTasks = vi
      .spyOn(TeamworkClient.prototype, "getProjectTasks")
      .mockResolvedValue([]);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await withCredentials(async () => {
      await taskList({
        project: "https://acmecorp.teamwork.com/app/projects/12345/overview/summary",
        json: true,
      });

      expect(getProjectTasks).toHaveBeenCalledWith(12345);
    });
  });

  it("throws on an unrecognized project identifier", async () => {
    await withCredentials(async () => {
      await expect(
        taskList({ project: "not-a-project", json: true })
      ).rejects.toThrow("Invalid project identifier");
    });
  });

  it("filters by --tasklist-id using either tasklist.id or tasklistId", async () => {
    vi.spyOn(TeamworkClient.prototype, "getProjectTasks").mockResolvedValue([
      { id: 1, name: "nested shape", tasklist: { id: 900 } },
      { id: 2, name: "flat shape", tasklistId: 900 },
      { id: 3, name: "other list", tasklist: { id: 901 } },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await withCredentials(async () => {
      await taskList({ project: "12345", tasklistId: 900, json: true });

      const printed = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(printed.map((t: { id: number }) => t.id)).toEqual([1, 2]);
    });
  });

  it("emits [] as valid JSON when a project has no tasks", async () => {
    vi.spyOn(TeamworkClient.prototype, "getProjectTasks").mockResolvedValue([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await withCredentials(async () => {
      await taskList({ project: "12345", json: true });

      expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual([]);
    });
  });
});
