import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectAddMember,
  projectApplyPreset,
  projectUpdateFeatures,
  projectUpdate,
} from "../src/cli/commands/project.js";
import { peopleList, timeList } from "../src/cli/commands/directory.js";
import { apiCommand } from "../src/cli/commands/api.js";
import { TeamworkClient } from "../src/client.js";

const originalConfigFile = process.env.TEAMWORK_CLI_CONFIG_FILE;

function withCredentials<T>(fn: () => Promise<T>): Promise<T> {
  process.env.TEAMWORK_SITE_NAME = "test-site";
  process.env.TEAMWORK_API_KEY = "test-api-key";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return fn().finally(() => {
    delete process.env.TEAMWORK_SITE_NAME;
    delete process.env.TEAMWORK_API_KEY;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });
}

describe("projects apply-preset", () => {
  const features = { tasks: true, time: false };
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tw preset "));
    process.env.TEAMWORK_CLI_CONFIG_FILE = join(dir, "config.json");
    writeFileSync(
      process.env.TEAMWORK_CLI_CONFIG_FILE,
      JSON.stringify({
        projectPresets: { bot: { namePrefix: "Bot - ", categoryId: 7, features } },
      })
    );
  });

  afterEach(() => {
    process.env.TEAMWORK_CLI_CONFIG_FILE = originalConfigFile;
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies the prefix, category and features from the settings file", async () => {
    vi.spyOn(TeamworkClient.prototype, "getProject").mockResolvedValue({ name: "Invoices" });
    const update = vi.spyOn(TeamworkClient.prototype, "updateProject").mockResolvedValue();
    await withCredentials(async () => {
      await projectApplyPreset({ project: "42", preset: "bot", json: true });
      expect(update).toHaveBeenCalledWith(42, { name: "Bot - Invoices", categoryId: 7, features });
    });
  });

  it("does not add the prefix twice, and honours --skip-rename", async () => {
    await withCredentials(async () => {
      const get = vi.spyOn(TeamworkClient.prototype, "getProject");
      const update = vi.spyOn(TeamworkClient.prototype, "updateProject").mockResolvedValue();
      get.mockResolvedValue({ name: "Bot - Invoices" });
      await projectApplyPreset({ project: "42", preset: "bot", json: true });
      expect(update.mock.calls[0]![1].name).toBeUndefined();
      get.mockResolvedValue({ name: "Invoices" });
      await projectApplyPreset({ project: "42", preset: "bot", json: true, skipRename: true });
      expect(update.mock.calls[1]![1].name).toBeUndefined();
    });
  });

  it("changes nothing on a dry run", async () => {
    await withCredentials(async () => {
      vi.spyOn(TeamworkClient.prototype, "getProject").mockResolvedValue({ name: "Invoices" });
      const update = vi.spyOn(TeamworkClient.prototype, "updateProject").mockResolvedValue();
      await projectApplyPreset({ project: "42", preset: "bot", json: true, dryRun: true });
      expect(update).not.toHaveBeenCalled();
    });
  });

  it("names the available presets when asked for an unknown one", async () => {
    await withCredentials(async () => {
      await expect(projectApplyPreset({ project: "42", preset: "nope", json: true })).rejects.toThrow(
        /Unknown project preset: nope \(available: bot\)/
      );
    });
  });

  it("obeys read-only mode", async () => {
    await withCredentials(async () => {
      await expect(
        projectApplyPreset({ project: "42", preset: "bot", json: true, readOnly: true } as never)
      ).rejects.toThrow(/Read-only/);
    });
  });
});

describe("projects update-features", () => {
  it("refuses a feature name it would otherwise drop", async () => {
    await withCredentials(async () => {
      const update = vi.spyOn(TeamworkClient.prototype, "updateProject").mockResolvedValue();
      await expect(
        projectUpdateFeatures({ project: "42", enable: ["tsks"], json: true })
      ).rejects.toThrow(/Unknown project feature: tsks/);
      expect(update).not.toHaveBeenCalled();
    });
  });
});

describe("projects add-member --me", () => {
  it("adds the signed-in user alongside any listed IDs, once", async () => {
    vi.spyOn(TeamworkClient.prototype, "me").mockResolvedValue({ person: { id: 222 } });
    const add = vi.spyOn(TeamworkClient.prototype, "addProjectMembers").mockResolvedValue();
    await withCredentials(async () => {
      await projectAddMember({ project: "42", userIds: ["111", "222"], me: true, json: true });
      expect(add).toHaveBeenCalledWith(42, [111, 222]);
    });
  });

  it("needs --user-ids or --me", async () => {
    await withCredentials(async () => {
      await expect(projectAddMember({ project: "42", json: true })).rejects.toThrow("--me");
    });
  });
});

describe("projects update", () => {
  it("sends only the fields given", async () => {
    vi.spyOn(TeamworkClient.prototype, "getProject").mockResolvedValue({ name: "X" });
    const update = vi.spyOn(TeamworkClient.prototype, "updateProject").mockResolvedValue();
    await withCredentials(async () => {
      await projectUpdate({ project: "42", name: "Y", json: true });
      expect(update).toHaveBeenCalledWith(42, expect.objectContaining({ name: "Y", categoryId: undefined }));
      await expect(projectUpdate({ project: "42", json: true })).rejects.toThrow("at least one");
    });
  });
});

describe("read-only lookups", () => {
  it("people list filters by name or email", async () => {
    vi.spyOn(TeamworkClient.prototype, "getPeople").mockResolvedValue([
      { id: 1, firstName: "Ada", lastName: "A", email: "k@x" },
      { id: 2, firstName: "Grace", lastName: "B", email: "grace@x" },
    ]);
    await withCredentials(async () => {
      await peopleList({ search: "GRACE", json: true });
      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify([{ id: 2, firstName: "Grace", lastName: "B", email: "grace@x" }], null, 2)
      );
    });
  });

  it("time list passes the project and dates through", async () => {
    const get = vi.spyOn(TeamworkClient.prototype, "getTimeEntries").mockResolvedValue([]);
    await withCredentials(async () => {
      await timeList({ project: "https://x.teamwork.com/app/projects/7/tasks", from: "20260101", json: true });
      expect(get).toHaveBeenCalledWith(7, "20260101", undefined);
    });
  });
});

describe("api", () => {
  it("sends the method, body and query parameters", async () => {
    const req = vi.spyOn(TeamworkClient.prototype, "request").mockResolvedValue({ status: 201, data: { id: 9 } });
    await withCredentials(async () => {
      await apiCommand("tasks/5/comments.json", {
        method: "post", data: '{"comment":{"body":"hi"}}', param: ["notify=false"], json: true,
      });
      expect(req).toHaveBeenCalledWith("/tasks/5/comments.json", {
        method: "POST", body: { comment: { body: "hi" } }, params: { notify: "false" },
      });
    });
  });

  it("refuses writes under --read-only and DELETE without --yes", async () => {
    const req = vi.spyOn(TeamworkClient.prototype, "request");
    await withCredentials(async () => {
      await expect(
        apiCommand("/x.json", { method: "PUT", data: "{}", json: true, readOnly: true } as never)
      ).rejects.toThrow("Read-only");
      await apiCommand("/x.json", { method: "DELETE", json: true });
      expect(process.exitCode).toBe(1);
      expect(req).not.toHaveBeenCalled();
    });
  });

  it("--all follows pages until a short page", async () => {
    const req = vi.spyOn(TeamworkClient.prototype, "request")
      .mockResolvedValueOnce({ status: 200, data: { comments: [1, 2] } })
      .mockResolvedValueOnce({ status: 200, data: { comments: [3] } });
    await withCredentials(async () => {
      await apiCommand("/c.json", { all: true, param: ["pageSize=2"], json: true });
      expect(req).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(JSON.stringify([1, 2, 3], null, 2));
    });
  });

  it("rejects bad JSON and bad --param", async () => {
    await withCredentials(async () => {
      await expect(apiCommand("/x", { data: "{", json: true })).rejects.toThrow("valid JSON");
      await expect(apiCommand("/x", { param: ["novalue"], json: true })).rejects.toThrow("key=value");
    });
  });
});
