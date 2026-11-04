import { describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const exec = promisify(execFile);
const distIndex = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");

async function help(...args: string[]): Promise<string> {
  const { stdout, stderr } = await exec("node", [distIndex, ...args, "--help"]);
  return stdout + stderr;
}

/** Subcommand names listed under a group's "Commands:" section. */
function subcommandsOf(helpText: string): string[] {
  const section = helpText.split(/^Commands:$/m)[1];
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.match(/^\s{2}(\S+)/)?.[1])
    .filter((name): name is string => Boolean(name) && name !== "help");
}

// Two option-wiring mistakes are invisible to unit tests that call handlers with
// a literal opts object, so these tests drive the registered CLI:
//
//   1. Declaring --json on the root and on a subcommand. Each copy binds to its
//      own command, and the handler reads whichever object is empty.
//   2. Reading opts.yes without declaring --yes. The flag is rejected as unknown
//      and the command cannot run non-interactively.
describe("command wiring", () => {
  it("every destructive command declares --yes", async () => {
    const groups = subcommandsOf(await help());
    const missing: string[] = [];
    let checked = 0;

    for (const group of groups) {
      for (const sub of subcommandsOf(await help(group))) {
        const text = await help(group, sub);
        if (!text.includes("(destructive)")) continue;
        checked++;
        if (!/^\s+--yes\b/m.test(text)) missing.push(`${group} ${sub}`);
      }
    }

    // A command that prompts but cannot be bypassed is unusable in scripts and CI.
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(0); // the walk must actually find some
  });

  it("--json is a global root flag, so one declaration serves every command", async () => {
    expect(await help()).toContain("--json");
  });

  it("no subcommand re-declares --json", async () => {
    const shadowed: string[] = [];
    for (const group of subcommandsOf(await help())) {
      const groupHelp = await help(group);
      if (/^\s+--json\b/m.test(groupHelp)) shadowed.push(group);
      for (const sub of subcommandsOf(groupHelp)) {
        if (/^\s+--json\b/m.test(await help(group, sub))) shadowed.push(`${group} ${sub}`);
      }
    }
    // Two declarations is how a CLI ends up with divergent behavior between
    // `cli --json sub` and `cli sub --json`.
    expect(shadowed).toEqual([]);
  });
});
