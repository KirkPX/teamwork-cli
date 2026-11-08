import { afterEach, describe, expect, it, vi } from "vitest";
import { whoamiCommand } from "../src/cli/commands/whoami.js";
import { TeamworkClient } from "../src/client.js";
import { ApiError, ConfigError } from "../src/errors.js";

function capture() {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    out.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return out;
}

afterEach(() => {
  delete process.env.TEAMWORK_SITE_NAME;
  delete process.env.TEAMWORK_API_KEY;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("teamwork whoami", () => {
  it("asks Teamwork who the key belongs to and reports it", async () => {
    process.env.TEAMWORK_SITE_NAME = "test-site";
    process.env.TEAMWORK_API_KEY = "test-api-key";
    vi.spyOn(TeamworkClient.prototype, "me").mockResolvedValue({
      person: { id: 7, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });
    const out = capture();

    await whoamiCommand({ json: true });

    expect(JSON.parse(out.join("\n"))).toMatchObject({
      siteName: "test-site",
      id: 7,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("passes on Teamwork's refusal with the next step", async () => {
    process.env.TEAMWORK_SITE_NAME = "test-site";
    process.env.TEAMWORK_API_KEY = "revoked-key";
    vi.spyOn(TeamworkClient.prototype, "me").mockRejectedValue(
      new ApiError({ status: 401, statusText: "Unauthorized", operation: "GET me", safeDetail: "" })
    );
    capture();

    const error = await whoamiCommand({ json: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).hint).toMatch(/login --force/);
  });

  it("says to sign in when nothing is stored", async () => {
    const me = vi.spyOn(TeamworkClient.prototype, "me");
    capture();

    await expect(whoamiCommand({ json: true })).rejects.toBeInstanceOf(ConfigError);
    expect(me).not.toHaveBeenCalled();
  });
});
