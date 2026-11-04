import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveIdList } from "../src/cli/resolve.js";

const exec = promisify(execFile);
const distIndex = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");

// Fake credentials satisfy createClient(); --dry-run returns before any network
// call, so these never reach Teamwork.
const env = {
  ...process.env,
  TEAMWORK_SITE_NAME: "test-site",
  TEAMWORK_API_KEY: "test-key",
  TEAMWORK_CLI_CREDENTIAL_STORE: "memory",
};

async function bulkUpdate(...args: string[]) {
  return await exec("node", [distIndex, "tasks", "bulk-update", ...args], { env });
}

describe("tasks bulk-update flag wiring", () => {
  // A handler that reads a differently spelt option drops the value silently. A
  // unit test with a literal opts object cannot see that, so every value flag
  // gets a row here and drives the registered CLI.
  const flags = [
    "--due-date=2026-01-01",
    "--start-date=2026-01-01",
    "--estimate-minutes=90",
    "--priority=high",
    "--progress=50",
  ];

  for (const flag of flags) {
    it(`${flag} reaches the handler`, async () => {
      const { stdout, stderr } = await bulkUpdate("--task-ids", "1", flag, "--dry-run");
      expect(stdout + stderr).toContain("Would update");
    });
  }
});

describe("ID list validation", () => {
  it("rejects an empty segment rather than sending NaN", async () => {
    await expect(
      bulkUpdate("--task-ids", "1,,3", "--priority=high", "--dry-run")
    ).rejects.toThrow(/Invalid task ID/);
  });

  it("rejects a non-numeric id", async () => {
    await expect(
      bulkUpdate("--task-ids", "12abc", "--priority=high", "--dry-run")
    ).rejects.toThrow(/Invalid task ID/);
  });
});

describe("resolveIdList", () => {
  it("parses a clean list", () => {
    expect(resolveIdList("1, 2,3", "task ID")).toEqual([1, 2, 3]);
  });

  it("rejects what parseInt would have silently accepted", () => {
    for (const bad of ["1,,3", "3.9", "12abc", "-1", "1e3", ""]) {
      expect(() => resolveIdList(bad, "task ID")).toThrow(/Invalid task ID/);
    }
  });
});
