import { describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { parseCount, parseId, parsePercent } from "../src/cli/parse.js";

const exec = promisify(execFile);
const distIndex = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");

describe("number option parsers", () => {
  it("accept whole numbers", () => {
    expect(parseId("42")).toBe(42);
    expect(parseId(" 7 ")).toBe(7);
    expect(parseCount("0")).toBe(0);
    expect(parsePercent("100")).toBe(100);
  });

  it.each(["abc", "", "1.5", "-3", "1e3", "0x10", "9007199254740993"])("refuse %j", (value) => {
    expect(() => parseId(value)).toThrow("Expected a whole number");
    expect(() => parseCount(value)).toThrow("Expected a whole number");
  });

  it("refuse an ID of 0 and a percentage over 100", () => {
    expect(() => parseId("0")).toThrow("greater than 0");
    expect(() => parsePercent("101")).toThrow("0 to 100");
  });

  // Before, `--progress x` passed the range check as NaN and sent null to
  // every task in the list.
  it("the built CLI stops before running the command", async () => {
    const failed = await exec("node", [
      distIndex, "tasks", "bulk-update", "--tasklist-id", "1", "--progress", "x", "--dry-run",
    ]).catch((e: { code: number; stderr: string }) => e);
    expect((failed as { code: number }).code).toBe(1);
    expect((failed as { stderr: string }).stderr).toContain("--progress");
    expect((failed as { stderr: string }).stderr).toContain('not "x"');
  });
});

describe("files migrate --mappings", () => {
  it.each(["1:", ":2", "1:0", "1:2:3", "a:b", "1.5:2"])("refuses %j before signing in", async (pair) => {
    const { fileMigrate } = await import("../src/cli/commands/file.js");
    await expect(fileMigrate({ mappings: pair, json: true })).rejects.toThrow("Invalid mapping");
  });
});
