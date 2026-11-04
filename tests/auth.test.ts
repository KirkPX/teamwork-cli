import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getCredentialStore, resetCredentialStore } from "../src/auth.js";

describe("CredentialStore", () => {
  beforeEach(() => {
    process.env.TEAMWORK_CLI_CREDENTIAL_STORE = "memory";
    resetCredentialStore();
  });

  afterEach(() => {
    delete process.env.TEAMWORK_CLI_CREDENTIAL_STORE;
    resetCredentialStore();
  });

  it("returns a store instance", () => {
    const store = getCredentialStore();
    expect(store).toBeDefined();
    expect(["keyring", "file", "memory"]).toContain(store.kind);
    expect(typeof store.persistent).toBe("boolean");
    expect(typeof store.getApiKey).toBe("function");
    expect(typeof store.setApiKey).toBe("function");
    expect(typeof store.deleteApiKey).toBe("function");
  });

  it("returns null for unset key", () => {
    const store = getCredentialStore();
    const key = store.getApiKey("nonexistent-test-site");
    expect(key).toBeNull();
  });

  it("stores and retrieves an API key", () => {
    const store = getCredentialStore();
    const testSite = "test-cli-auth-smoke";
    store.setApiKey(testSite, "test-api-key-12345");
    expect(store.getApiKey(testSite)).toBe("test-api-key-12345");
    store.deleteApiKey(testSite);
  });

  it("deletes an API key", () => {
    const store = getCredentialStore();
    const testSite = "test-cli-delete-smoke";
    store.setApiKey(testSite, "to-delete");
    store.deleteApiKey(testSite);
    expect(store.getApiKey(testSite)).toBeNull();
  });
});

describe("auth dispatch", () => {
  // Explicit intent must win over the fall-through.
  it("--status reports without writing, even alongside --site", async () => {
    const { authCommand } = await import("../src/cli/commands/auth.js");
    const config = await import("../src/config.js");

    const setSiteName = vi.spyOn(config, "setSiteName");
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await authCommand({ status: true, site: "should-not-be-saved", json: true });
      expect(setSiteName).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
