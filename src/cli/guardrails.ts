import pc from "picocolors";
import { createInterface } from "readline";
import type { Reporter } from "./output.js";
import { ConfigError } from "../errors.js";
import { loadSettings } from "../settings.js";

export type DryRunResult =
  | { changed: true; summary: string }
  | { changed: false; summary: string };

export function dryRunSummary(
  wouldChange: boolean,
  summary: string
): DryRunResult {
  return { changed: wouldChange, summary };
}

/**
 * The one shape every mutating command emits, in either format.
 *
 * A consumer reads the three required outcomes as:
 *   dryRun               -> would change
 *   !dryRun && changed   -> changed
 *   !dryRun && !changed  -> nothing changed (including aborts)
 */
export type MutationOutcome<T = unknown> = {
  ok: boolean;
  dryRun: boolean;
  changed: boolean;
  aborted?: boolean;
  summary: string;
  hint?: string;
  counts?: { total: number; succeeded: number; failed: number };
  results?: T[];
};

/**
 * Emit the dry-run / changed / nothing-changed outcome.
 *
 * The Reporter is required. With an optional one, a caller that forgot it would
 * print prose into a pipe, and the typecheck would not notice.
 */
export function printDryRun(
  result: DryRunResult,
  isDryRun: boolean,
  r: Reporter,
  extra: Partial<MutationOutcome> & Record<string, unknown> = {}
): void {
  const outcome: MutationOutcome = {
    ok: true,
    dryRun: isDryRun,
    changed: isDryRun ? false : result.changed,
    summary: result.summary,
    ...extra,
  };

  if (isDryRun) {
    r.result(outcome, `${pc.yellow("[DRY RUN]")} ${result.summary}`);
  } else if (result.changed) {
    r.result(outcome, pc.green(result.summary));
  } else {
    r.result(outcome, pc.dim(result.summary));
  }
}

export type AbortReason = "declined" | "needs-yes";

export type ConfirmResult =
  | { confirmed: true }
  | { confirmed: false; reason: AbortReason };

/** The outcome for a refused or declined confirmation. */
export function abortOutcome(reason: AbortReason, summary: string): MutationOutcome {
  return {
    ok: reason === "declined",
    dryRun: false,
    changed: false,
    aborted: true,
    summary,
    ...(reason === "needs-yes"
      ? { hint: "Pass --yes to confirm non-interactively." }
      : {}),
  };
}

/**
 * Confirm a destructive action.
 *
 * The reason is returned rather than collapsed into a bare false: a human
 * typing `n` and a machine refused for not passing `--yes` are different
 * events, and only the second should exit non-zero.
 *
 * Refuses when stdin is not a TTY, not only under --json. Otherwise a CI run
 * waits on a prompt nothing can answer, the event loop drains, and the process
 * exits 0 having done nothing.
 *
 * Keyed on stdin, not stdout: whether a human can answer is about the input
 * side, so `teamwork tasks bulk-delete … | jq` from a terminal still prompts.
 */
export async function confirmDestructive(
  message: string,
  opts: { yes?: boolean; json?: boolean } = {}
): Promise<ConfirmResult> {
  if (opts.yes) return { confirmed: true };
  if (opts.json || !process.stdin.isTTY) {
    return { confirmed: false, reason: "needs-yes" };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${message} (y/N) `, resolve);
    });
    return answer.trim().toLowerCase() === "y"
      ? { confirmed: true }
      : { confirmed: false, reason: "declined" };
  } finally {
    rl.close();
  }
}

/**
 * Refuse anything that would change remote data when read-only is in force.
 *
 * Read-only is the safe posture for agents and automation: it lets someone run
 * a CLI they do not fully trust without risking a write. Every mutating command
 * must call this before doing anything.
 */
// Takes `unknown` deliberately. These opts objects are built by commander at
// runtime and merged from the root program; each command's hand-written type is
// an approximation that does not list the global flags. Demanding `readOnly` in
// all 18 of them would be typing the map, not the territory.
export function assertWritable(opts: unknown = {}): void {
  const readOnly =
    typeof opts === "object" && opts !== null
      ? (opts as { readOnly?: boolean }).readOnly
      : undefined;

  // An explicit environment value beats the settings file, in either direction,
  // so one run can opt out of a read-only default with TEAMWORK_READ_ONLY=0.
  const fromEnv = process.env.TEAMWORK_READ_ONLY;
  const inForce = fromEnv ? isTruthy(fromEnv) : loadSettings().readOnly === true;

  if (readOnly || inForce) {
    throw new ConfigError(
      "Read-only mode is on, so this command refused to change anything.",
      "Check --read-only, TEAMWORK_READ_ONLY, and readOnly in the settings file (`teamwork config show`)."
    );
  }
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return !["0", "false", "no", ""].includes(value.toLowerCase());
}

export function requireSiteName(
  siteName: string | undefined
): asserts siteName is string {
  if (!siteName || siteName.length === 0) {
    throw new ConfigError("Not signed in.", "Run `teamwork login`.");
  }
}

export function requireApiKey(
  apiKey: string | null | undefined
): asserts apiKey is string {
  if (!apiKey || apiKey.length === 0) {
    throw new ConfigError("Not signed in.", "Run `teamwork login`.");
  }
}
