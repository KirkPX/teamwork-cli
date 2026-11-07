import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { setSetting } from "../src/settings.js";

const exec = promisify(execFile);
const dist = resolve(import.meta.dirname ?? ".", "../dist/index.js");
const scratch = () => mkdtempSync(join(tmpdir(), "tw erreurs é "));
const savedConfig = process.env.TEAMWORK_CLI_CONFIG_FILE;

afterEach(() => {
  process.env.TEAMWORK_CLI_CONFIG_FILE = savedConfig;
});

describe("settings file errors read in plain words", () => {
  it("names the reason when the settings path is a folder", () => {
    const folder = join(scratch(), "config.json");
    mkdirSync(folder);
    process.env.TEAMWORK_CLI_CONFIG_FILE = folder;
    expect(() => setSetting("readOnly", "true")).toThrow("Cannot read the settings file: it is a folder, not a file.");
  });

  it("names the reason when part of the settings path is a file", () => {
    const blocker = join(scratch(), "not a folder");
    writeFileSync(blocker, "");
    process.env.TEAMWORK_CLI_CONFIG_FILE = join(blocker, "config.json");
    expect(() => setSetting("readOnly", "true")).toThrow("settings file: part of the path is a file, not a folder.");
  });
});

describe("the credentials file", () => {
  it("refuses to write over a damaged file, so other sites' keys are kept", async () => {
    const file = join(scratch(), "credentials.json");
    writeFileSync(file, "{ not json");
    const env = {
      ...process.env,
      TEAMWORK_CLI_CREDENTIAL_STORE: "file",
      TEAMWORK_CLI_CREDENTIALS_FILE: file,
      TEAMWORK_CLI_CONFIG_FILE: join(scratch(), "config.json"),
    };
    const failed = await exec(process.execPath, [dist, "--json", "auth", "--site", "acmecorp", "--api-key", "k"], { env }).catch(
      (e: { stderr: string }) => e
    );
    expect(JSON.parse((failed as { stderr: string }).stderr).message).toContain("credentials file is damaged");
    expect(readFileSync(file, "utf-8")).toBe("{ not json");
  });
});

describe("commander errors follow --json", () => {
  it("prints one JSON object for a missing option", async () => {
    const failed = await exec(process.execPath, [dist, "tasks", "list", "--json"]).catch((e: { stderr: string; code: number }) => e);
    const { stderr, code } = failed as { stderr: string; code: number };
    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toMatchObject({ error: true, message: expect.stringContaining("--project") });
  });
});
