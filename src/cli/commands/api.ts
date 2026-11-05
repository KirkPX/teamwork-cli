import { readFileSync } from "fs";
import type { Readable } from "stream";
import pc from "picocolors";
import { UsageError } from "../../errors.js";
import type { RequestMethod } from "../../client.js";
import { createClient } from "../client-helpers.js";
import { reporter } from "../output.js";
import { abortOutcome, assertWritable, confirmDestructive } from "../guardrails.js";

type ApiOpts = {
  json?: boolean;
  method?: string;
  data?: string;
  dataFile?: string;
  param?: string[];
  all?: boolean;
  yes?: boolean;
};

const METHODS: RequestMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Call any Teamwork endpoint with the stored sign-in. This covers what the
 * named commands do not: Teamwork Desk, task comments, milestones, timers and
 * single time logs. Writes obey --read-only, and DELETE asks first.
 */
export async function apiCommand(path: string, opts: ApiOpts): Promise<void> {
  const r = reporter(opts);
  const method = (opts.method ?? "GET").toUpperCase() as RequestMethod;
  if (!METHODS.includes(method)) {
    throw new UsageError(`Unknown method "${opts.method}". Use one of ${METHODS.join(", ")}.`);
  }
  if (!path.startsWith("/")) path = `/${path}`;

  const raw = await readRequestBody(opts);
  let body: unknown;
  if (raw !== undefined) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new UsageError("The request body is not valid JSON.");
    }
  }

  const params: Record<string, string> = {};
  for (const pair of opts.param ?? []) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new UsageError(`Invalid --param "${pair}". Expected key=value.`);
    params[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  if (method !== "GET") {
    assertWritable(opts);
    if (opts.all) throw new UsageError("--all only works with GET.");
  }
  if (method === "DELETE") {
    const confirm = await confirmDestructive(`DELETE ${path}?`, { yes: opts.yes, json: opts.json });
    if (!confirm.confirmed) {
      const outcome = abortOutcome(confirm.reason, "Aborted — nothing was deleted.");
      r.result(outcome, pc.dim(outcome.summary));
      if (confirm.reason === "needs-yes") process.exitCode = 1;
      return;
    }
  }

  const client = createClient();

  if (opts.all) {
    r.result(await fetchAllPages(client, path, params));
    return;
  }

  const { status, data } = await client.request(path, { method, body, params });
  r.result(data ?? { ok: true, status });
}

/**
 * Follow page numbers until a short page. The array is whichever top-level key
 * holds one, so this works for V1, V3 and Desk responses alike.
 */
async function fetchAllPages(
  client: ReturnType<typeof createClient>,
  path: string,
  params: Record<string, string>
): Promise<unknown[]> {
  const pageSize = Number(params.pageSize ?? 250);
  const all: unknown[] = [];
  for (let page = 1; ; page++) {
    const { data } = await client.request(path, {
      params: { ...params, page, pageSize },
    });
    const items = firstArray(data);
    if (!items) {
      if (page === 1) {
        throw new UsageError("--all needs an endpoint that returns a list.");
      }
      break;
    }
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}

function firstArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  for (const val of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(val)) return val;
  }
  return null;
}

/**
 * The request body as text, from `--data <json>`, `--data @<path>`,
 * `--data -` (standard input) or `--data-file <path>`.
 *
 * PowerShell strips double quotes inside arguments it passes to a program, so
 * JSON typed on the command line can arrive broken there. A file or standard
 * input reaches the CLI unchanged on every system.
 */
export async function readRequestBody(
  opts: Pick<ApiOpts, "data" | "dataFile">,
  stdin: Readable & { isTTY?: boolean } = process.stdin
): Promise<string | undefined> {
  if (opts.data !== undefined && opts.dataFile !== undefined) {
    throw new UsageError("Pass --data or --data-file, not both.");
  }
  if (opts.dataFile !== undefined) return readBodyFile(opts.dataFile);
  if (opts.data === "-") {
    if (stdin.isTTY) {
      throw new UsageError(
        "--data - reads the body from standard input, but nothing is piped in.",
        "Pipe the JSON in, or pass --data @<path> to read it from a file."
      );
    }
    let text = "";
    stdin.setEncoding("utf-8");
    for await (const chunk of stdin) text += chunk;
    return text;
  }
  if (opts.data?.startsWith("@")) return readBodyFile(opts.data.slice(1));
  return opts.data;
}

function readBodyFile(file: string): string {
  try {
    return readFileSync(file, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason = code === "ENOENT" ? "the file does not exist" : (code ?? "unknown error");
    throw new UsageError(`Cannot read the request body from "${file}": ${reason}.`);
  }
}
