// Tests from the CLI template for how the process behaves: closed pipes, Ctrl-C
// and doctor --install. They run the built CLI.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const distIndex = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");

const dirs: string[] = [];
function tempDir(prefix = "teamwork cfg "): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

type Run = { code: number | null; stdout: string; stderr: string };

/** Run the built CLI. stdin is closed unless `input` is given, so nothing can hang on it. */
function run(
  args: string[],
  opts: { env?: Record<string, string>; input?: string; nodeArgs?: string[] } = {}
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...(opts.nodeArgs ?? []), distIndex, ...args], {
      env: { ...process.env, ...opts.env },
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk) => (stdout += chunk));
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (opts.input !== undefined) child.stdin!.end(opts.input);
  });
}

describe("doctor --install", () => {
  it("doctor --install keeps its verdict out of stdout", async () => {
    const { stdout, stderr } = await run(["doctor", "--install"]);
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).toMatch(/Installed\.|Almost there/);
  });
});

describe("closed pipes", () => {
  // console.log swallows a write error by itself, so an ordinary command proves
  // nothing about the listener in src/index.ts. This file loads before the CLI and
  // acts once the command is done, so it reaches the listener the way a direct
  // stream write would (commander, a large result, a progress line).
  function preload(body: string): string {
    const file = path.join(tempDir(), "after-command.mjs");
    writeFileSync(file, `let done = false;
process.on("beforeExit", () => {
  if (done) return;
  done = true;
  ${body}
});
`);
    return pathToFileURL(file).href;
  }

  /** Start the CLI with a reader that closes stdout before the CLI writes anything. */
  function runWithClosedStdout(args: string[], nodeArgs: string[] = []): Promise<Run> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...nodeArgs, distIndex, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.destroy();
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout: "", stderr }));
    });
  }

  it.each([[["doctor"]], [["--help"]], [["config", "path"]]])(
    "%j exits 0 with no stack trace when the reader closes early",
    async (args) => {
      const { code, stderr } = await runWithClosedStdout(args);
      expect(stderr).toBe("");
      expect(code).toBe(0);
    }
  );

  it("exits 0 when a direct stream write hits the closed pipe", async () => {
    const hook = preload(`process.stdout.write("more output\\n");`);
    const { code, stderr } = await runWithClosedStdout(["doctor"], ["--import", hook]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it.each(["stdout", "stderr"])("exits 0 on an EPIPE from %s", async (stream) => {
    const hook = preload(
      `process.${stream}.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));`
    );
    const { code } = await run(["config", "path"], { nodeArgs: ["--import", hook] });
    expect(code).toBe(0);
  });

  it("does not hide any other stream error", async () => {
    const hook = preload(
      `process.stdout.emit("error", Object.assign(new Error("disk trouble"), { code: "EIO" }));`
    );
    const { code, stderr } = await run(["config", "path"], { nodeArgs: ["--import", hook] });
    expect(code).not.toBe(0);
    expect(stderr).toContain("disk trouble");
  });
});

describe("Ctrl-C at a prompt", () => {
  // Standard input is a pipe here, so this file makes it act as a terminal. The CLI
  // then reads the Ctrl-C byte the way it reads a real key press.
  function fakeTerminal(): string {
    const file = path.join(tempDir(), "fake-terminal.mjs");
    writeFileSync(file, `process.stdin.isTTY = true;
process.stdin.setRawMode = (mode) => {
  process.stderr.write("raw mode: " + mode + "\\n");
  return process.stdin;
};
`);
    return pathToFileURL(file).href;
  }

  it("exits 130 and restores typing", async () => {
    const { code, stdout, stderr } = await run(["login", "--paste"], {
      input: "\x03",
      nodeArgs: ["--import", fakeTerminal()],
    });
    expect(code).toBe(130);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cancelled.");
    expect(stderr).not.toContain("Error:");
    expect(stderr).toContain("raw mode: true");
    expect(stderr.lastIndexOf("raw mode: false")).toBeGreaterThan(stderr.lastIndexOf("raw mode: true"));
  });
});
