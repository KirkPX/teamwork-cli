import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setSetting, unsetSetting } from "../src/settings.js";
import { UsageError } from "../src/errors.js";

let file: string;

beforeEach(() => {
  // A folder with a space and non-English characters, as on many Windows desktops.
  file = join(mkdtempSync(join(tmpdir(), "tw réglages 設定 ")), "config.json");
  process.env.TEAMWORK_CLI_CONFIG_FILE = file;
});

const saved = () => JSON.parse(readFileSync(file, "utf-8"));

describe("config set", () => {
  it("makes the file when there is none, with typed values", () => {
    expect(existsSync(file)).toBe(false);
    setSetting("readOnly", "true");
    setSetting("timeoutMs", "60000");
    setSetting("siteName", "acmecorp");
    expect(saved()).toEqual({ readOnly: true, timeoutMs: 60000, siteName: "acmecorp" });
  });

  it("builds a preset one field at a time", () => {
    setSetting("projectPresets.automation.namePrefix", "Automation - ");
    setSetting("projectPresets.automation.categoryId", "678");
    setSetting("projectPresets.automation.features.time", "false");
    expect(saved().projectPresets.automation).toEqual({
      namePrefix: "Automation - ",
      categoryId: 678,
      features: { time: false },
    });
  });

  it("refuses an unknown name, a wrong value and an unknown feature without writing", () => {
    expect(() => setSetting("readonly", "true")).toThrow(UsageError);
    expect(() => setSetting("readOnly", "yes")).toThrow(/true or false/);
    expect(() => setSetting("timeoutMs", "1.5")).toThrow(/whole number/);
    expect(() => setSetting("projectPresets.a.features.nope", "true")).toThrow(/must be one of/);
    expect(existsSync(file)).toBe(false);
  });
});

describe("config unset", () => {
  it("removes a value, and the objects the removal leaves empty", () => {
    setSetting("readOnly", "true");
    setSetting("projectPresets.automation.features.time", "false");
    expect(unsetSetting("projectPresets.automation.features.time")).toBe(true);
    expect(unsetSetting("readOnly")).toBe(true);
    expect(saved()).toEqual({});
  });

  it("removes a whole preset, and reports a value that was not set", () => {
    setSetting("projectPresets.automation.categoryId", "678");
    expect(unsetSetting("projectPresets.automation")).toBe(true);
    expect(unsetSetting("timeoutMs")).toBe(false);
    expect(saved()).toEqual({});
  });
});

describe("config set through the built CLI", () => {
  it("writes the file and prints JSON in a pipe", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const dist = join(import.meta.dirname ?? ".", "../dist/index.js");
    const env = { ...process.env, TEAMWORK_CLI_CONFIG_FILE: file };
    const { stdout } = await promisify(execFile)("node", [dist, "config", "set", "readOnly", "true"], { env });
    expect(JSON.parse(stdout)).toMatchObject({ name: "readOnly", settings: { readOnly: true } });
    expect(saved()).toEqual({ readOnly: true });
  });
});
