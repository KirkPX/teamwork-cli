import { UsageError } from "../../errors.js";
import { createClient } from "../client-helpers.js";
import { resolveProjectInput } from "../resolve.js";
import { reporter } from "../output.js";

type Opts = { json?: boolean };

// Read-only lookups: people, companies, time entries and expenses.

export async function peopleList(opts: Opts & { search?: string }): Promise<void> {
  const r = reporter(opts);
  const client = createClient();
  let people = (await client.getPeople()) as Record<string, unknown>[];
  if (opts.search) {
    const q = opts.search.toLowerCase();
    people = people.filter((p) =>
      [p.firstName, p.lastName, p.email]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(q))
    );
  }
  r.result(people);
}

export async function companiesList(opts: Opts): Promise<void> {
  const r = reporter(opts);
  const client = createClient();
  r.result(await client.getCompanies());
}

export async function timeList(
  opts: Opts & { project?: string; from?: string; to?: string }
): Promise<void> {
  const r = reporter(opts);
  const client = createClient();
  let projectId: number | undefined;
  if (opts.project) {
    const id = resolveProjectInput(opts.project);
    if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);
    projectId = id;
  }
  r.result(await client.getTimeEntries(projectId, opts.from, opts.to));
}

export async function expensesList(opts: Opts & { project: string }): Promise<void> {
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);
  r.result(await client.getProjectExpenses(id));
}
