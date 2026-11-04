import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { reporterFor } from "../src/cli/output.js";

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const SRC = path.join(ROOT, "src");
const distIndex = path.join(ROOT, "dist", "index.js");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

// resolveFormat() returns "json" for ANY non-TTY stdout, not just for --json.
// So a console.log inside a command corrupts every piped run, with or without
// the flag. Before this guard there were ~40 such sites, and seven handlers
// that computed the format and then never read it.
//
// A source guard rather than a behavioural test on purpose: it fails on a NEW
// command written the old way, which is how the violation spread.
describe("output contract", () => {
  it("no command writes to stdout directly", () => {
    const offenders = filesUnder(path.join(SRC, "cli", "commands"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /(^|[^.\w])console\.log\s*\(/.test(readFileSync(f, "utf-8")))
      .map((f) => path.relative(SRC, f));

    expect(offenders).toEqual([]);
  });

  it("guardrails never writes to stdout directly either", () => {
    const source = readFileSync(path.join(SRC, "cli", "guardrails.ts"), "utf-8");
    expect(/(^|[^.\w])console\.log\s*\(/.test(source)).toBe(false);
  });
});

describe("piped output is machine-readable", () => {
  // execFile gives a non-TTY stdout. No --json flag anywhere in here on purpose.
  const env = { ...process.env, TEAMWORK_CLI_CREDENTIAL_STORE: "memory" };

  it("doctor emits parseable JSON when piped", async () => {
    const { stdout } = await exec("node", [distIndex, "doctor"], { env });
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(JSON.parse(stdout)).toHaveProperty("checks");
  });

  it("auth status emits parseable JSON when piped", async () => {
    const { stdout } = await exec("node", [distIndex, "auth"], { env });
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("leaves stdout empty when the command fails", async () => {
    const failed = await exec("node", [distIndex, "projects", "list"], {
      env: { ...env, TEAMWORK_SITE_NAME: "", TEAMWORK_API_KEY: "" },
    }).catch((e: { stdout: string; stderr: string }) => e);

    expect((failed as { stdout: string }).stdout).toBe("");
    expect(JSON.parse((failed as { stderr: string }).stderr)).toMatchObject({ error: true });
  });
});

describe("Reporter", () => {
  function capture(run: (r: ReturnType<typeof reporterFor>) => void, format: "json" | "pretty") {
    const out: string[] = [];
    const err: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (...a: unknown[]) => out.push(a.join(" "));
    console.error = (...a: unknown[]) => err.push(a.join(" "));
    try {
      run(reporterFor(format));
    } finally {
      console.log = log;
      console.error = error;
    }
    return { out, err };
  }

  it("writes exactly once to stdout in json mode, and nothing else", () => {
    const { out, err } = capture((r) => {
      r.note("working...");
      r.result({ ok: true, id: 7 }, "Done!");
    }, "json");

    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({ ok: true, id: 7 });
    expect(err).toEqual([]);
  });

  it("prefers the human rendering in pretty mode and keeps progress on stderr", () => {
    const { out, err } = capture((r) => {
      r.note("working...");
      r.result({ ok: true }, "Done!");
    }, "pretty");

    expect(out).toEqual(["Done!"]);
    expect(err).toEqual(["working..."]);
  });

  it("warns on stderr in both formats", () => {
    expect(capture((r) => r.warn("careful"), "json").err).toEqual(["careful"]);
    expect(capture((r) => r.warn("careful"), "pretty").err).toEqual(["careful"]);
  });
});
