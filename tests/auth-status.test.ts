import { afterEach, describe, expect, it, vi } from "vitest";
import { authStatusCommand } from "../src/cli/commands/auth.js";
import { getCredentialStore, resetCredentialStore } from "../src/auth.js";

function statusJson(): Promise<Record<string, unknown>> {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    out.push(String(line));
  });
  return authStatusCommand({ json: true }).then(() => JSON.parse(out.join("\n")));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetCredentialStore();
});

describe("teamwork auth --status", () => {
  it("sees a key set in the environment, as every command does", async () => {
    vi.stubEnv("TEAMWORK_SITE_NAME", "test-site");
    vi.stubEnv("TEAMWORK_API_KEY", "env-key-12345678");
    expect(await statusJson()).toMatchObject({
      configured: true,
      apiKeySet: true,
      apiKeyPreview: "env-****5678",
      apiKeySource: "environment",
    });
  });

  it("reports a saved key, and where saved keys go", async () => {
    vi.stubEnv("TEAMWORK_SITE_NAME", "test-site");
    getCredentialStore().setApiKey("test-site", "saved-key-1234");
    expect(await statusJson()).toMatchObject({
      apiKeySet: true,
      apiKeySource: "saved",
      credentialStore: "memory",
      persistent: false,
    });
  });

  it("never prints the whole key", async () => {
    vi.stubEnv("TEAMWORK_SITE_NAME", "test-site");
    vi.stubEnv("TEAMWORK_API_KEY", "env-key-12345678");
    expect(JSON.stringify(await statusJson())).not.toContain("env-key-12345678");
  });
});
