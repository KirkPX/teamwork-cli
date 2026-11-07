import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamworkClient } from "../src/client.js";
import { projectSetCategory, projectUpdate, projectUpdateFeatures } from "../src/cli/commands/project.js";
import { tasklistUpdate } from "../src/cli/commands/tasklist.js";

let printed = "";
let update: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.TEAMWORK_SITE_NAME = "test-site";
  process.env.TEAMWORK_API_KEY = "test-api-key";
  printed = "";
  vi.spyOn(console, "log").mockImplementation((text) => void (printed += text));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(TeamworkClient.prototype, "getProject").mockResolvedValue({ name: "Launch" } as never);
  update = vi.spyOn(TeamworkClient.prototype, "updateProject").mockResolvedValue(undefined);
  vi.spyOn(TeamworkClient.prototype, "updateTaskList").mockResolvedValue(undefined as never);
});

afterEach(() => {
  delete process.env.TEAMWORK_SITE_NAME;
  delete process.env.TEAMWORK_API_KEY;
  vi.restoreAllMocks();
});

const result = () => JSON.parse(printed);

describe("a dry run in JSON says what would change", () => {
  it("projects update-features", async () => {
    await projectUpdateFeatures({ project: "7", enable: ["time"], disable: ["billing"], dryRun: true, json: true });
    expect(result()).toMatchObject({
      dryRun: true,
      summary: "Would enable time and disable billing on project 7",
      features: { time: true, billing: false },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("projects set-category", async () => {
    await projectSetCategory({ project: "7", categoryId: 678, dryRun: true, json: true });
    expect(result()).toMatchObject({ summary: "Would move project 7 to category 678", categoryId: 678 });
  });

  it("projects update", async () => {
    await projectUpdate({ project: "7", name: "New", startDate: "2026-01-01", dryRun: true, json: true });
    expect(result()).toMatchObject({
      summary: "Would update project 7: name, startDate",
      updates: { name: "New", startDate: "2026-01-01" },
    });
  });

  it("tasklists update", async () => {
    await tasklistUpdate({ tasklistId: 5, name: "Phase 2", dryRun: true, json: true });
    expect(result()).toMatchObject({ summary: "Would update tasklist 5: name", updates: { name: "Phase 2" } });
  });
});

describe("the result after a change says what changed", () => {
  it("projects update-features", async () => {
    await projectUpdateFeatures({ project: "7", enable: ["time"], json: true });
    expect(result()).toMatchObject({ changed: true, summary: "Enabled time on project 7" });
  });
});
