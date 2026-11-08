// A script reads stderr as one JSON error report. Notes meant for a person, such
// as the welcome, the token steps and retry messages, show only at a terminal.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/cli/client-helpers.js";

const distIndex = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");
const scratch = mkdtempSync(path.join(tmpdir(), "tw quiet "));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Run = { code: number | null; stdout: string; stderr: string };

/** Run the built CLI with stdin closed, so nothing can wait on it. */
function run(args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distIndex, ...args], {
      env: {
        ...process.env,
        TEAMWORK_CLI_CONFIG_FILE: path.join(scratch, `${Math.random()}.json`),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("bare teamwork", () => {
  it("fails with only the JSON error report when piped and never signed in", async () => {
    const { code, stdout, stderr } = await run([]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toMatchObject({ error: true, message: "No token entered." });
  });

  it("shows help when the site and key come from the environment", async () => {
    const { code, stdout } = await run([], {
      TEAMWORK_SITE_NAME: "test-site",
      TEAMWORK_API_KEY: "env-key",
    });
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: teamwork");
  });
});

describe("retry messages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function retryOnce(isTTY: boolean, json?: boolean): Promise<string[]> {
    vi.stubEnv("TEAMWORK_SITE_NAME", "test-site");
    vi.stubEnv("TEAMWORK_API_KEY", "test-key-12345");
    vi.spyOn(process, "stdout", "get").mockReturnValue({ isTTY } as never);
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "retry-after": "0" } })
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
      );
    await createClient({ json }).request("/retry.json");
    return lines;
  }

  it("show at a terminal", async () => {
    expect((await retryOnce(true)).join("\n")).toContain("retrying");
  });

  it("stay out of a piped run and a --json run", async () => {
    expect(await retryOnce(false)).toEqual([]);
    expect(await retryOnce(true, true)).toEqual([]);
  });
});
