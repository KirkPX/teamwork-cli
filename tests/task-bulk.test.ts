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

// A write to many tasks, or one that hides a project from the whole site, asks
// first. With no terminal to ask at and no --yes, it must stop before any
// network call and exit 1. The fake credentials would fail any real request.
describe("writes that ask first", () => {
  async function run(...args: string[]) {
    return exec("node", [distIndex, ...args], { env }).catch(
      (e: { code: number; stdout: string; stderr: string }) => e
    );
  }

  it.each([
    [["tasks", "bulk-update", "--task-ids", "1,2", "--priority", "high"], "nothing was updated"],
    [["projects", "archive", "--project", "123"], "nothing was archived"],
  ])("%j refuses without --yes", async (args, summary) => {
    const result = (await run(...args)) as { code: number; stdout: string };
    expect(result.code).toBe(1);
    const outcome = JSON.parse(result.stdout);
    expect(outcome).toMatchObject({ aborted: true, changed: false, summary: expect.stringContaining(summary) });
    expect(outcome.hint).toContain("--yes");
  });

  it("projects archive --dry-run says what would change", async () => {
    const { stdout } = await exec("node", [distIndex, "projects", "archive", "--project", "123", "--dry-run"], { env });
    expect(JSON.parse(stdout)).toMatchObject({ dryRun: true, projectId: 123, status: "archived" });
  });
});
