import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirm = vi.hoisted(() => vi.fn(async (_message: string, _opts?: unknown) => ({ confirmed: true as const })));
vi.mock("../src/cli/guardrails.js", async (load) => ({
  ...(await load<typeof import("../src/cli/guardrails.js")>()),
  confirmDestructive: confirm,
}));

import { TeamworkClient } from "../src/client.js";
import { taskBulkDelete } from "../src/cli/commands/task.js";

let deleteTask: ReturnType<typeof vi.spyOn>;
let deleteTaskList: ReturnType<typeof vi.spyOn>;
let output = "";

beforeEach(() => {
  process.env.TEAMWORK_SITE_NAME = "acmecorp";
  process.env.TEAMWORK_API_KEY = "test-key";
  output = "";
  vi.spyOn(console, "log").mockImplementation((...a) => void (output += a.join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(TeamworkClient.prototype, "paginated").mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
  deleteTask = vi.spyOn(TeamworkClient.prototype, "deleteTask").mockResolvedValue(undefined as never);
  deleteTaskList = vi.spyOn(TeamworkClient.prototype, "deleteTaskList").mockResolvedValue(undefined as never);
});

afterEach(() => {
  delete process.env.TEAMWORK_SITE_NAME;
  delete process.env.TEAMWORK_API_KEY;
  confirm.mockClear();
  vi.restoreAllMocks();
});

describe("tasks bulk-delete --delete-list", () => {
  it("names the tasklist in the question", async () => {
    await taskBulkDelete({ tasklistId: 5, deleteList: true, json: true });
    expect(confirm.mock.calls[0]![0]).toBe("Delete tasklist 5 and all 3 tasks in it?");
    expect(deleteTaskList).toHaveBeenCalledWith(5);
  });

  it("names the tasklist in the dry run", async () => {
    await taskBulkDelete({ tasklistId: 5, deleteList: true, dryRun: true, json: true });
    expect(JSON.parse(output).summary).toContain("tasklist 5 and all 3 tasks in it");
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("refuses --task-ids with --tasklist-id, and --delete-list without a tasklist", async () => {
    await expect(taskBulkDelete({ taskIds: "1,2", tasklistId: 5, deleteList: true })).rejects.toThrow("not both");
    await expect(taskBulkDelete({ taskIds: "1,2", deleteList: true })).rejects.toThrow("needs --tasklist-id");
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("keeps the tasklist when a task could not be deleted", async () => {
    deleteTask.mockRejectedValueOnce(new Error("refused"));
    await taskBulkDelete({ tasklistId: 5, deleteList: true, json: true });
    expect(deleteTaskList).not.toHaveBeenCalled();
    expect(JSON.parse(output).tasklistDeleted).toBe(false);
    process.exitCode = 0;
  });
});
