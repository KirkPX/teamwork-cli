import pc from "picocolors";
import { UsageError } from "../../errors.js";
import type { RequestMethod } from "../../client.js";
import { createClient } from "../client-helpers.js";
import { reporter } from "../output.js";
import { readJsonBody } from "../read-file.js";
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

  const body = await readJsonBody(opts);
  // Node refuses to send a GET with a body, which would read as a network failure.
  if (body !== undefined && method === "GET") {
    throw new UsageError(
      "A request body needs a write method.",
      "Add --method POST, PUT or PATCH."
    );
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
  // The last page is the first short one. A size of 0, or one that is not a
  // number, never gives a short page, so the loop would not end.
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new UsageError(`Invalid pageSize "${params.pageSize}". Use a whole number greater than 0.`);
  }
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
