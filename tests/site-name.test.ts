import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUrl } from "../src/client.js";
import { ConfigError, UsageError, safeErrorMessage } from "../src/errors.js";
import { setSetting } from "../src/settings.js";
import { setSiteName } from "../src/config.js";

describe("a site name with a typo", () => {
  let file: string;
  beforeEach(() => {
    file = join(mkdtempSync(join(tmpdir(), "tw site ")), "config.json");
    process.env.TEAMWORK_CLI_CONFIG_FILE = file;
  });
  afterEach(() => {
    delete process.env.TEAMWORK_CLI_CONFIG_FILE;
  });

  it("is refused before it reaches the settings file", () => {
    expect(() => setSiteName("acme corp")).toThrow(ConfigError);
    expect(() => setSetting("siteName", "acme/corp")).toThrow(/part before \.teamwork\.com/);
    expect(existsSync(file)).toBe(false);
    setSiteName("acme");
    setSiteName("acme.teamwork.com");
  });

  it("gives a plain message, not a bare Invalid URL, when it comes from the environment", () => {
    const error = (() => {
      try {
        buildUrl("https://acme corp.teamwork.com", "/projects.json");
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain("Cannot build a request address");
    expect((error as UsageError).hint).toContain("teamwork auth");
  });
});

describe("hiding a password in an address", () => {
  it("hides only the user and password of that address", () => {
    expect(safeErrorMessage("GET https://user:pw@acme.teamwork.com/x failed")).toBe(
      "GET https://****@acme.teamwork.com/x failed"
    );
  });

  it("leaves the rest of the message when an @ comes later", () => {
    const text = "GET https://acme.teamwork.com/projects.json failed: contact support@teamwork.com";
    expect(safeErrorMessage(text)).toBe(text);
    const trace = "at file:///app/node_modules/@napi-rs/keyring/index.js:1:1";
    expect(safeErrorMessage(trace)).toBe(trace);
  });
});
