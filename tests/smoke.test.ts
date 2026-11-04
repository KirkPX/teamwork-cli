import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { notebookCreate } from "../src/cli/commands/notebook.js";
import { TeamworkClient } from "../src/client.js";

describe("smoke", () => {
  it("runs tests", () => {
    expect(true).toBe(true);
  });

  it("reads notebook content from a file path with spaces", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "teamwork cli test "));
    const filePath = path.join(dir, "notebook content with spaces.html");

    try {
      await writeFile(filePath, "<p>hello from a spaced path</p>", "utf-8");
      const createNotebook = vi
        .spyOn(TeamworkClient.prototype, "createNotebook")
        .mockResolvedValue({ id: 1, name: "Spaced Path" });
      vi.spyOn(console, "log").mockImplementation(() => undefined);

      process.env.TEAMWORK_SITE_NAME = "test-site";
      process.env.TEAMWORK_API_KEY = "test-api-key";

      await notebookCreate({
        projectId: 123,
        name: "Spaced Path",
        file: filePath,
        json: true,
      });

      expect(createNotebook).toHaveBeenCalledWith(123, {
        name: "Spaced Path",
        content: "<p>hello from a spaced path</p>",
        description: undefined,
      });
    } finally {
      delete process.env.TEAMWORK_SITE_NAME;
      delete process.env.TEAMWORK_API_KEY;
      vi.restoreAllMocks();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
