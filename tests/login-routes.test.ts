import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/login/prompt.js", () => ({
  promptSecret: vi.fn(async () => "twp_new_key"),
  promptLine: vi.fn(async () => ""),
}));

import { getCredentialStore } from "../src/auth.js";
import { TeamworkClient } from "../src/client.js";
import { loginCommand } from "../src/cli/commands/login.js";
import { ApiError, LoginError } from "../src/errors.js";
import { promptSecret } from "../src/login/prompt.js";
import { verifyApiKey } from "../src/login/discover.js";

const realFetch = globalThis.fetch;
let settingsFile: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "tw login é "));
  settingsFile = join(dir, "config.json");
  process.env.TEAMWORK_CLI_CONFIG_FILE = settingsFile;
  delete process.env.TEAMWORK_SITE_NAME;
  delete process.env.TEAMWORK_API_KEY;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // Teamwork's discovery service names the site the key belongs to.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ account: { URL: "https://acmecorp.teamwork.com" } }),
  })) as unknown as typeof fetch;
  vi.spyOn(TeamworkClient.prototype, "me").mockResolvedValue({ person: { fullName: "Ada" } });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const site of ["acmecorp", "oldsite"]) getCredentialStore().deleteApiKey(site);
  delete process.env.TEAMWORK_SITE_NAME;
  vi.mocked(promptSecret).mockClear();
  vi.restoreAllMocks();
});

function saveSite(siteName: string) {
  writeFileSync(settingsFile, JSON.stringify({ siteName }));
}

describe("a half-finished sign-in never blocks plain login", () => {
  it("starts a new sign-in when a site is saved with no key", async () => {
    saveSite("acmecorp");
    await loginCommand({ paste: true, json: true });
    expect(promptSecret).toHaveBeenCalledOnce();
    expect(getCredentialStore().getApiKey("acmecorp")).toBe("twp_new_key");
  });

  it("starts a new sign-in when a key is saved with no site", async () => {
    getCredentialStore().setApiKey("oldsite", "twp_old_key");
    await loginCommand({ paste: true, json: true });
    expect(promptSecret).toHaveBeenCalledOnce();
    expect(getCredentialStore().getApiKey("acmecorp")).toBe("twp_new_key");
  });

  it("starts a new sign-in when only TEAMWORK_SITE_NAME is set", async () => {
    process.env.TEAMWORK_SITE_NAME = "acmecorp";
    await loginCommand({ paste: true, json: true });
    expect(promptSecret).toHaveBeenCalledOnce();
  });

  it("keeps a complete sign-in unless --force is given", async () => {
    saveSite("acmecorp");
    getCredentialStore().setApiKey("acmecorp", "twp_saved");
    await loginCommand({ paste: true, json: true });
    expect(promptSecret).not.toHaveBeenCalled();
    expect(getCredentialStore().getApiKey("acmecorp")).toBe("twp_saved");
  });
});

describe("a refused key gets a plain message", () => {
  it("names the next step instead of the status code", async () => {
    vi.mocked(TeamworkClient.prototype.me).mockRejectedValue(
      new ApiError({ status: 401, statusText: "Unauthorized", operation: "GET /me.json", safeDetail: "" })
    );
    const error = await verifyApiKey("twp_bad").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoginError);
    const { message, hint } = error as LoginError;
    expect(message).toBe("Teamwork refused that key for acmecorp.teamwork.com.");
    expect(hint).toContain("Edit My Details → API & Mobile");
    expect(`${message} ${hint}`).not.toMatch(/401|Unauthorized/);
  });

  it("tells a person whose saved key stopped working to sign in again", () => {
    const refused = new ApiError({ status: 401, statusText: "Unauthorized", operation: "GET /projects.json", safeDetail: "" });
    expect(refused.hint).toContain("teamwork login --force");
    const other = new ApiError({ status: 404, statusText: "Not Found", operation: "GET /x.json", safeDetail: "" });
    expect(other.hint).toBeUndefined();
  });
});
