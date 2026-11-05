import { describe, expect, it } from "vitest";
import { spawn } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

const root = path.resolve(import.meta.dirname ?? ".", "..");
const distIndex = path.join(root, "dist/index.js");
const preload = pathToFileURL(path.join(root, "tests/fixtures/slow-api.mjs")).href;

describe("closed pipe", () => {
  // `teamwork … | head -1`: the reader takes its first chunk and closes. The
  // CLI's next write must end the run quietly, not with an EPIPE stack trace.
  it("exits 0 with no stack trace when the reader closes early", async () => {
    const child = spawn(
      process.execPath,
      ["--import", preload, distIndex, "api", "/projects/api/v3/tasks.json"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          TEAMWORK_API_KEY: "test-key",
          TEAMWORK_SITE_NAME: "acmecorp",
          TEAMWORK_CLI_CREDENTIAL_STORE: "memory",
        },
      }
    );
    child.stdout.once("data", () => child.stdout.destroy());
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

    expect(stderr).not.toContain("EPIPE");
    expect(code).toBe(0);
  });
});
