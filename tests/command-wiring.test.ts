import { beforeAll, describe, expect, it } from "vitest";
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
type HelpPage = { group: string; sub?: string; text: string };

/**
 * The help text of the root, every group and every subcommand, fetched once.
 * Each page is a new Node process, so the pages for one group load in
 * parallel. Fetched one at a time, the walk took over 5 seconds on a Windows
 * CI machine.
 */
async function walkHelp(): Promise<{ root: string; pages: HelpPage[] }> {
  const root = await help();
  const groups = await Promise.all(
    subcommandsOf(root).map(async (group) => ({ group, text: await help(group) }))
  );
  const subs = await Promise.all(
    groups.flatMap(({ group, text }) =>
      subcommandsOf(text).map(async (sub) => ({ group, sub, text: await help(group, sub) }))
    )
  );
  return { root, pages: [...groups, ...subs] };
}

describe("command wiring", () => {
  let root = "";
  let pages: HelpPage[] = [];
  beforeAll(async () => {
    ({ root, pages } = await walkHelp());
  }, 60_000);

  it("every destructive command declares --yes", () => {
    const destructive = pages.filter((p) => p.sub && p.text.includes("(destructive)"));
    const missing = destructive
      .filter((p) => !/^\s+--yes\b/m.test(p.text))
      .map((p) => `${p.group} ${p.sub}`);

    // A command that prompts but cannot be bypassed is unusable in scripts and CI.
    expect(missing).toEqual([]);
    expect(destructive.length).toBeGreaterThan(0); // the walk must actually find some
  });

  it("--json is a global root flag, so one declaration serves every command", () => {
    expect(root).toContain("--json");
  });

  it("no subcommand re-declares --json", () => {
    const shadowed = pages
      .filter((p) => /^\s+--json\b/m.test(p.text))
      .map((p) => (p.sub ? `${p.group} ${p.sub}` : p.group));
    // Two declarations is how a CLI ends up with divergent behavior between
    // `cli --json sub` and `cli sub --json`.
    expect(shadowed).toEqual([]);
  });
});
