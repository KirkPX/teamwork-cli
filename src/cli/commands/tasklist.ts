import { UsageError } from "../../errors.js";
import { createClient } from "../client-helpers.js";
import { reporter } from "../output.js";
import {
  abortOutcome,
  assertWritable,
  confirmDestructive,
  dryRunSummary,
  printDryRun,
} from "../guardrails.js";
import pc from "picocolors";

type Opts = { json?: boolean };

export async function tasklistList(
  opts: Opts & { projectId: number }
): Promise<void> {
  const r = reporter(opts);
  const client = createClient();

  const tasklists = await client.getTaskLists(opts.projectId);
  r.result(tasklists);
}

export async function tasklistCreate(
  opts: Opts & {
    projectId: number;
    name: string;
    description?: string;
    addToTop?: boolean;
    dryRun?: boolean;
  }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  if (opts.dryRun) {
    printDryRun(
      dryRunSummary(
        true,
        `Would create tasklist "${opts.name}" in project ${opts.projectId}`
      ),
      true,
      r
    );
    return;
  }

  const result = await client.createTaskList(opts.projectId, {
    name: opts.name,
    description: opts.description,
    addToTop: opts.addToTop,
  });

  // Teamwork's v1 API is inconsistent about the new-record id key: POST
  // /projects.json returns `id`, but POST /projects/:id/tasklists.json returns
  // `TASKLISTID`. Check both rather than silently printing no id.
  const created = result as Record<string, unknown> | null;
  const id = created?.TASKLISTID ?? created?.id;
  r.result(
    result,
    pc.green(
      `Created tasklist "${opts.name}"${id ? ` (id ${id})` : ""} in project ${opts.projectId}`
    )
  );
}

export async function tasklistUpdate(
  opts: Opts & {
    tasklistId: number;
    name?: string;
    description?: string;
    dryRun?: boolean;
  }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  if (!opts.name && !opts.description) {
    throw new UsageError("At least one of --name or --description is required.");
  }

  if (opts.dryRun) {
    printDryRun(
      dryRunSummary(true, `Would update tasklist ${opts.tasklistId}`),
      true,
      r
    );
    return;
  }

  await client.updateTaskList(opts.tasklistId, {
    name: opts.name,
    description: opts.description,
  });

  r.result(
    { ok: true, dryRun: false, changed: true, tasklistId: opts.tasklistId,
      summary: `Updated tasklist ${opts.tasklistId}` },
    pc.green(`Updated tasklist ${opts.tasklistId}`)
  );
}

export async function tasklistDelete(
  opts: Opts & { tasklistId: number; yes?: boolean }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  const confirm = await confirmDestructive(
    `Delete tasklist ${opts.tasklistId} and all tasks in it?`,
    { yes: opts.yes, json: opts.json }
  );
  if (!confirm.confirmed) {
    const outcome = abortOutcome(confirm.reason, "Aborted — nothing was deleted.");
    r.result(outcome, pc.dim(outcome.summary));
    if (confirm.reason === "needs-yes") process.exitCode = 1;
    return;
  }

  await client.deleteTaskList(opts.tasklistId);
  r.result(
    { ok: true, dryRun: false, changed: true, tasklistId: opts.tasklistId,
      summary: `Deleted tasklist ${opts.tasklistId}` },
    pc.green(`Deleted tasklist ${opts.tasklistId}`)
  );
}
