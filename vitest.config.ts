import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // No test may launch a real browser. Set here rather than per test, so it
      // cannot be forgotten.
      TEAMWORK_CLI_NO_BROWSER: "1",
      // Tests, and the child processes they spawn, must never read or write the
      // developer's real credentials or settings.
      TEAMWORK_CLI_CREDENTIAL_STORE: "memory",
      TEAMWORK_CLI_CONFIG_FILE: join(tmpdir(), `teamwork-cli-test-${process.pid}`, "config.json"),
    },
  },
});
