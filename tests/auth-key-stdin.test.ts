import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dist = resolve(import.meta.dirname ?? ".", "../dist/index.js");

function run(args: string[], input: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [dist, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

describe("auth --api-key -", () => {
  it("reads the key from standard input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tw clé "));
    const file = join(dir, "credentials.json");
    const env = {
      ...process.env,
      TEAMWORK_CLI_CREDENTIAL_STORE: "file",
      TEAMWORK_CLI_CREDENTIALS_FILE: file,
      TEAMWORK_CLI_CONFIG_FILE: join(dir, "config.json"),
    };
    const { code, stdout } = await run(["--json", "auth", "--site", "acmecorp", "--api-key", "-"], "twp_piped_key\r\n", env);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ stored: true, siteName: "acmecorp" });
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ "apiKey:acmecorp": "twp_piped_key" });
  });

  it("refuses an empty standard input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tw clé "));
    const env = { ...process.env, TEAMWORK_CLI_CONFIG_FILE: join(dir, "config.json") };
    const { code, stderr } = await run(["--json", "auth", "--site", "acmecorp", "--api-key", "-"], "", env);
    expect(code).toBe(1);
    expect(JSON.parse(stderr).message).toContain("read nothing");
  });
});
