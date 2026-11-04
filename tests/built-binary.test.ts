import { describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const exec = promisify(execFile);
const distIndex = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");

describe("built binary smoke test", () => {
  it("teamwork --help exits 0 and prints usage", async () => {
    const { stdout, stderr } = await exec("node", [distIndex, "--help"]);
    const output = stdout + stderr;
    expect(output).toContain("teamwork");
    expect(output).toContain("--help");
    expect(output).toContain("--version");
  });

  it("teamwork --version matches package.json", async () => {
    const { stdout } = await exec("node", [distIndex, "--version"]);
    const pkg = JSON.parse(readFileSync(path.resolve(path.dirname(distIndex), "../package.json"), "utf-8"));
    expect(stdout.trim()).toBe(pkg.version);
  });

  it("config show reports a broken settings file and doctor survives it", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tw cfg ")), "config.json");
    writeFileSync(file, JSON.stringify({ readonly: true }));
    const env = { ...process.env, TEAMWORK_CLI_CONFIG_FILE: file };
    const failed = await exec("node", [distIndex, "config", "show"], { env }).catch(
      (e: { code: number; stderr: string }) => e
    );
    expect((failed as { code: number }).code).toBeGreaterThan(0);
    expect((failed as { stderr: string }).stderr).toContain("Invalid settings");
    const { stdout } = await exec("node", [distIndex, "doctor"], { env });
    expect(JSON.parse(stdout).checks.find((c: { name: string }) => c.name === "Config file").ok).toBe(false);
  });

  it("settings file read-only blocks a write through the built CLI", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tw cfg ")), "config.json");
    writeFileSync(file, JSON.stringify({ readOnly: true }));
    const failed = await exec("node", [distIndex, "tasks", "delete", "--task-id", "1", "--yes"], {
      env: { ...process.env, TEAMWORK_CLI_CONFIG_FILE: file },
    }).catch((e: { stderr: string }) => e);
    expect((failed as { stderr: string }).stderr).toContain("Read-only");
  });

  // execFile gives a non-TTY stdout, so resolveFormat picks json: a piped run is
  // machine-readable whether or not --json was passed.
  it("teamwork doctor exits 0 and emits parseable checks when piped", async () => {
    const { stdout } = await exec("node", [distIndex, "doctor"]);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("ok");
    const names = parsed.checks.map((c: { name: string }) => c.name);
    expect(names).toContain("Node.js");
    expect(names).toContain("Platform");
  });

  it("teamwork auth shows status when not configured", async () => {
    const { stdout } = await exec("node", [distIndex, "auth"]);
    // should not crash
    expect(typeof stdout).toBe("string");
  });

  // Commander binds each declaration to its own command, so --json lives on the
  // root, once, and is read through resolveFormat.
  it("--json is a global root flag, declared exactly once", async () => {
    const { stdout: rootHelp, stderr: rootErr } = await exec("node", [
      distIndex,
      "--help",
    ]);
    expect(rootHelp + rootErr).toContain("--json");

    const { stdout: subHelp, stderr: subErr } = await exec("node", [
      distIndex,
      "tasks",
      "list",
      "--help",
    ]);
    const subOutput = subHelp + subErr;
    // The subcommand must NOT re-declare it; it reads the root's value.
    expect(subOutput).not.toContain("--json");
    expect(subOutput).toContain("--project");
  });

  it("teamwork login is the advertised way in", async () => {
    const { stdout, stderr } = await exec("node", [distIndex, "--help"]);
    const output = stdout + stderr;
    expect(output).toContain("login");
    expect(output).toContain("logout");
  });

  it("teamwork login takes no site or key argument", async () => {
    const { stdout, stderr } = await exec("node", [distIndex, "login", "--help"]);
    const output = stdout + stderr;
    expect(output).toContain("--paste");
    expect(output).toContain("--force");
    // The whole point of the rework: nothing to look up before running it.
    expect(output).not.toContain("--site");
    expect(output).not.toContain("--api-key");
  });

  it("teamwork files migrate help is available", async () => {
    const { stdout, stderr } = await exec("node", [
      distIndex,
      "files",
      "migrate",
      "--help",
    ]);
    const output = stdout + stderr;
    expect(output).toContain("migrate");
    expect(output).toContain("--source");
    expect(output).toContain("--mappings");
  });
});
