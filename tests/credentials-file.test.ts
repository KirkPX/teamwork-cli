import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getCredentialStore, resetCredentialStore } from "../src/auth.js";

// The file store lets SSH sessions sign in, because macOS closes the keychain to
// them. The keychain itself is not exercised here.
describe("file credential store", () => {
  let file: string;

  beforeEach(() => {
    file = join(mkdtempSync(join(tmpdir(), "tw-cred-")), "sub", "credentials.json");
    process.env.TEAMWORK_CLI_CREDENTIAL_STORE = "file";
    process.env.TEAMWORK_CLI_CREDENTIALS_FILE = file;
    resetCredentialStore();
  });

  afterEach(() => {
    delete process.env.TEAMWORK_CLI_CREDENTIAL_STORE;
    delete process.env.TEAMWORK_CLI_CREDENTIALS_FILE;
    resetCredentialStore();
  });

  it("saves, reads back and keeps the file private", () => {
    const store = getCredentialStore();
    expect(store.kind).toBe("file");
    expect(store.getApiKey("site")).toBeNull();
    expect(store.setApiKey("site", "k1")).toBe("file");
    expect(store.getApiKey("site")).toBe("k1");
    // Windows has no POSIX mode bits. There the profile folder's permissions apply.
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("keeps other sites when one changes, and removes the file when empty", () => {
    const store = getCredentialStore();
    store.setApiKey("a", "ka");
    store.setApiKey("b", "kb");
    store.setApiKey("a", "ka2");
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ "apiKey:a": "ka2", "apiKey:b": "kb" });
    store.deleteApiKey("a");
    store.deleteApiKey("b");
    expect(existsSync(file)).toBe(false);
  });

  it("treats an unreadable file as no key, not a crash", async () => {
    const { writeFileSync, mkdirSync } = await import("fs");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "{not json");
    expect(getCredentialStore().getApiKey("site")).toBeNull();
  });
});
