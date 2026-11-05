import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// A throwaway home folder for this run. Removed when the run ends.
const scratch = join(tmpdir(), `teamwork-cli-test-${process.pid}`);
mkdirSync(scratch, { recursive: true });
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

export default defineConfig({
  test: {
    // Checks the settings below before each test file, and refuses real network calls.
    setupFiles: ["./tests/setup.ts"],
    // os.homedir() reads the process's real environment. A worker thread has only a
    // copy, so the throwaway home folder needs one process per worker.
    pool: "forks",
    // Tests that drive the built CLI start a Node process each, which is slow on
    // a loaded Windows runner.
    testTimeout: 30_000,
    env: {
      // No test may launch a real browser. Set here rather than per test, so it
      // cannot be forgotten.
      TEAMWORK_CLI_NO_BROWSER: "1",
      // Tests, and the child processes they start, must never read or write the
      // developer's real home folder, credentials or settings.
      HOME: scratch,
      USERPROFILE: scratch,
      APPDATA: join(scratch, "AppData", "Roaming"),
      XDG_CONFIG_HOME: join(scratch, ".config"),
      TEAMWORK_CLI_CREDENTIAL_STORE: "memory",
      TEAMWORK_CLI_CONFIG_FILE: join(scratch, "config.json"),
      TEAMWORK_CLI_CREDENTIALS_FILE: join(scratch, "credentials.json"),
      // A closed local port, so a built CLI that makes a request fails at once and
      // never reaches the real service.
      TEAMWORK_BASE_URL: "http://127.0.0.1:9",
      // A value exported in the developer's shell must not change test results.
      TEAMWORK_API_KEY: "",
      TEAMWORK_SITE_NAME: "",
      TEAMWORK_READ_ONLY: "",
    },
  },
});
