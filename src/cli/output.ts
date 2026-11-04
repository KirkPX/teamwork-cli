// Output contract. JSON is the machine format; "pretty" is the human format.
// The DEFAULT is decided here, not hard-coded per command: interactive terminal
// -> pretty; piped or --json -> json. Scripts and agents get parseable output
// with no flag at all, because piped stdout is not a TTY.
export type OutputFormat = "json" | "pretty";

export function resolveFormat(opts: { json?: boolean } = {}): OutputFormat {
  if (opts.json) return "json";
  if (!process.stdout.isTTY) return "json";
  return "pretty";
}

export function output(data: unknown, format: OutputFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    prettyPrint(data);
  }
}

function prettyPrint(data: unknown): void {
  if (Array.isArray(data)) {
    // An empty result must still say something. Printing nothing is
    // indistinguishable from a silently broken command.
    if (data.length === 0) {
      console.log("No results.");
      return;
    }
    for (const item of data) {
      prettyPrintItem(item);
    }
  } else if (typeof data === "object" && data !== null) {
    prettyPrintItem(data as Record<string, unknown>);
  } else {
    console.log(String(data));
  }
}

function prettyPrintItem(item: Record<string, unknown>): void {
  if ("id" in item && "name" in item) {
    const fields: string[] = [];
    fields.push(`${item.name} (${item.id})`);
    for (const [key, val] of Object.entries(item)) {
      if (key === "name" || key === "id") continue;
      if (typeof val !== "object") {
        fields.push(`  ${key}: ${val}`);
      }
    }
    console.log(fields.join("\n"));
    console.log("");
    return;
  }

  for (const [key, value] of Object.entries(item)) {
    if (typeof value === "object" && value !== null) {
      console.log(`${key}: ${JSON.stringify(value)}`);
    } else {
      console.log(`${key}: ${value}`);
    }
  }
}

/**
 * The per-command writer. Every handler starts with `const r = reporter(opts)`.
 *
 * resolveFormat() returning a value is not enough on its own: a loose `format`
 * variable sitting next to a globally available console.log is how a CLI ends
 * up printing prose into a pipe. The Reporter makes the contract the path of
 * least resistance — there is a method for each kind of writing, and none of
 * them is console.log.
 *
 * Rules, enforced by tests/output-contract.test.ts:
 *   - exactly one r.result() on every return path — the ONE stdout write
 *   - console.log never appears in src/cli/commands/**
 */
export type Reporter = {
  readonly format: OutputFormat;
  /** The single stdout write. `pretty` is the human rendering of the same data. */
  result(data: unknown, pretty?: string): void;
  /** Extra lines of a multi-line pretty result. stdout, pretty only. */
  line(message: string): void;
  /** Progress and diagnostics. stderr, pretty only — never pollutes a pipe. */
  note(message: string): void;
  /** Problems worth seeing in both formats. Always stderr. */
  warn(message: string): void;
};

export function reporterFor(format: OutputFormat): Reporter {
  return {
    format,
    result(data, pretty) {
      if (format === "json") output(data, "json");
      else if (pretty !== undefined) console.log(pretty);
      else output(data, "pretty");
    },
    line(message) {
      if (format === "pretty") console.log(message);
    },
    note(message) {
      if (format === "pretty") console.error(message);
    },
    warn(message) {
      console.error(message);
    },
  };
}

export function reporter(opts: { json?: boolean } = {}): Reporter {
  return reporterFor(resolveFormat(opts));
}
