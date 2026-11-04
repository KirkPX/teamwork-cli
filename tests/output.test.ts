import { afterEach, describe, expect, it } from "vitest";
import { output, resolveFormat } from "../src/cli/output.js";

// isTTY is a plain property, so save and restore it rather than spying.
const original = process.stdout.isTTY;

afterEach(() => {
  process.stdout.isTTY = original;
});

describe("resolveFormat", () => {
  it("gives an interactive terminal human output", () => {
    process.stdout.isTTY = true;
    expect(resolveFormat({})).toBe("pretty");
  });

  it("gives JSON when stdout is not a TTY, with no flag", () => {
    // This is the case that matters: piped, redirected, CI, or an agent. A
    // script gets parseable output without having to remember --json.
    process.stdout.isTTY = false;
    expect(resolveFormat({})).toBe("json");
  });

  it("honors --json even at an interactive terminal", () => {
    process.stdout.isTTY = true;
    expect(resolveFormat({ json: true })).toBe("json");
  });

  it("defaults to JSON when isTTY is undefined", () => {
    // Node leaves isTTY undefined rather than false in some contexts; the safe
    // reading is "not a terminal", so machine format.
    process.stdout.isTTY = undefined as unknown as boolean;
    expect(resolveFormat({})).toBe("json");
  });
});

describe("output", () => {
  it("emits an empty array as [] rather than silence", () => {
    // Printing nothing is indistinguishable from a broken command.
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      output([], "json");
    } finally {
      console.log = log;
    }
    expect(JSON.parse(lines.join("\n"))).toEqual([]);
  });
});
