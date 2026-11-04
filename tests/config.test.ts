import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConfig, setSiteName, getSiteName, clearSiteName } from "../src/config.js";
import { getCredentialStore, resetCredentialStore } from "../src/auth.js";
import { ConfigError } from "../src/errors.js";
import { assertWritable } from "../src/cli/guardrails.js";
import { configDir } from "../src/paths.js";
import { loadSettings, updateSettings } from "../src/settings.js";

const origEnv = { ...process.env };
let dir: string;
let file: string;

function seed(value: unknown): void {
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tw settings "));
  file = join(dir, "config.json");
  process.env = { ...origEnv, TEAMWORK_CLI_CREDENTIAL_STORE: "memory", TEAMWORK_CLI_CONFIG_FILE: file };
  delete process.env.TEAMWORK_READ_ONLY;
  delete process.env.TEAMWORK_SITE_NAME;
  delete process.env.TEAMWORK_API_KEY;
  resetCredentialStore(); // getCredentialStore caches
});

afterEach(() => {
  process.env = origEnv;
  rmSync(dir, { recursive: true, force: true });
  resetCredentialStore();
});

describe("resolveConfig precedence: flags > env > settings file/keychain > default", () => {
  it("falls back to the default when nothing is set", () => {
    expect(resolveConfig()).toEqual({ siteName: "", apiKey: null });
  });

  it("reads siteName from the settings file when no env or flag is present", () => {
    seed({ siteName: "from-file" });
    expect(resolveConfig().siteName).toBe("from-file");
  });

  it("prefers env over the settings file", () => {
    seed({ siteName: "from-file" });
    process.env.TEAMWORK_SITE_NAME = "from-env";
    expect(resolveConfig().siteName).toBe("from-env");
  });

  it("prefers a flag over env and the settings file", () => {
    seed({ siteName: "from-file" });
    process.env.TEAMWORK_SITE_NAME = "from-env";
    expect(resolveConfig({ siteName: "from-flag" }).siteName).toBe("from-flag");
  });

  it("reads apiKey from the keychain when no env or flag is present", () => {
    seed({ siteName: "acme" });
    getCredentialStore().setApiKey("acme", "key-from-keychain");
    expect(resolveConfig().apiKey).toBe("key-from-keychain");
  });

  it("prefers env over the keychain", () => {
    seed({ siteName: "acme" });
    getCredentialStore().setApiKey("acme", "key-from-keychain");
    process.env.TEAMWORK_API_KEY = "key-from-env";
    expect(resolveConfig().apiKey).toBe("key-from-env");
  });

  it("ignores empty env vars", () => {
    process.env.TEAMWORK_SITE_NAME = "";
    process.env.TEAMWORK_API_KEY = "";
    expect(resolveConfig()).toEqual({ siteName: "", apiKey: null });
  });
});

describe("writes are validated", () => {
  it("stores a valid site name", () => {
    setSiteName("acme");
    expect(getSiteName()).toBe("acme");
  });

  it("trims surrounding whitespace", () => {
    setSiteName("  acme  ");
    expect(getSiteName()).toBe("acme");
  });

  it("refuses an empty site name instead of storing garbage", () => {
    expect(() => setSiteName("")).toThrow(ConfigError);
    expect(() => setSiteName("   ")).toThrow(ConfigError);
    expect(getSiteName()).toBeUndefined();
  });

  it("carries the config path as a hint", () => {
    try {
      setSiteName("");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ConfigError).hint).toContain("config.json");
    }
  });

  it("clears cleanly", () => {
    setSiteName("acme");
    clearSiteName();
    expect(getSiteName()).toBeUndefined();
  });
});

describe("settings file", () => {
  it("keeps other settings when the site name changes", () => {
    seed({ readOnly: true, projectPresets: { bot: { categoryId: 7 } } });
    setSiteName("acme");
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({
      readOnly: true,
      projectPresets: { bot: { categoryId: 7 } },
      siteName: "acme",
    });
  });

  it("treats a missing file as no settings", () => {
    expect(loadSettings()).toEqual({});
  });

  it("names the file when the JSON is broken, and leaves it alone", () => {
    seed("{not json");
    expect(() => loadSettings()).toThrow(/not valid JSON/);
    expect(() => updateSettings({ readOnly: true })).toThrow(ConfigError);
    expect(readFileSync(file, "utf-8")).toBe("{not json");
  });

  it("refuses a misspelt key, because ignoring readonly would allow writes", () => {
    seed({ readonly: true });
    expect(() => loadSettings()).toThrow(/Invalid settings/);
    expect(() => assertWritable({})).toThrow(ConfigError);
  });

  it("refuses a preset with an unknown feature or with nothing in it", () => {
    seed({ projectPresets: { bot: { features: { tsks: true } } } });
    expect(() => loadSettings()).toThrow(/tsks|must be one of/);
    seed({ projectPresets: { bot: {} } });
    expect(() => loadSettings()).toThrow(/at least one/);
    seed({ projectPresets: { bot: { features: { constructor: true } } } });
    expect(() => loadSettings()).toThrow(/Invalid settings/);
  });

  it("passes timeoutMs through to the client options", () => {
    seed({ timeoutMs: 5000 });
    expect(resolveConfig().timeoutMs).toBe(5000);
  });
});

describe("read-only precedence: flag > env > settings file", () => {
  it("is off by default", () => {
    expect(() => assertWritable({})).not.toThrow();
  });

  it("reads the settings file", () => {
    seed({ readOnly: true });
    expect(() => assertWritable({})).toThrow(/Read-only/);
  });

  it("lets the environment turn it off for one run", () => {
    seed({ readOnly: true });
    process.env.TEAMWORK_READ_ONLY = "0";
    expect(() => assertWritable({})).not.toThrow();
  });

  it("lets the flag win over an environment that turned it off", () => {
    process.env.TEAMWORK_READ_ONLY = "0";
    expect(() => assertWritable({ readOnly: true })).toThrow(/Read-only/);
  });
});

describe("configDir", () => {
  it("uses APPDATA on Windows", () => {
    expect(configDir({ APPDATA: "appdata" }, "win32", "home")).toBe(join("appdata", "teamwork-cli"));
  });

  it("uses XDG_CONFIG_HOME when set, and ~/.config otherwise", () => {
    expect(configDir({ XDG_CONFIG_HOME: "xdg" }, "darwin", "home")).toBe(join("xdg", "teamwork-cli"));
    expect(configDir({}, "linux", "home")).toBe(join("home", ".config", "teamwork-cli"));
  });
});
