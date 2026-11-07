import { UsageError } from "../../errors.js";
import { createClient } from "../client-helpers.js";
import { resolveIdList, resolveProjectInput } from "../resolve.js";
import { reporter } from "../output.js";
import {
  abortOutcome,
  assertWritable,
  confirmDestructive,
  dryRunSummary,
  printDryRun,
} from "../guardrails.js";
import pc from "picocolors";

type TaskResult = {
  id: number;
  status: "updated" | "deleted" | "would-update" | "would-delete" | "failed";
  error?: string;
};

type Opts = {
  json?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  taskIds?: string;
  tasklistId?: number;
  dueDate?: string;
  startDate?: string;
  estimateMinutes?: number;
  priority?: string;
  progress?: number;
  deleteList?: boolean;
};

export async function taskList(
  opts: Opts & { project: string; tasklistId?: number }
): Promise<void> {
  const r = reporter(opts);
  const client = createClient();

  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  let tasks = (await client.getProjectTasks(id)) as Record<string, unknown>[];

  if (opts.tasklistId) {
    tasks = tasks.filter(
      (t) =>
        ((t.tasklist as Record<string, unknown>)?.id ?? t.tasklistId) ===
        opts.tasklistId
    );
  }

  r.result(tasks);
}

export async function taskBulkUpdate(opts: Opts): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  if (!opts.taskIds && !opts.tasklistId) {
    throw new UsageError("Either --task-ids or --tasklist-id is required.");
  }

  const updates: Record<string, unknown> = {};
  if (opts.dueDate) updates.dueDate = opts.dueDate;
  if (opts.startDate) updates.startDate = opts.startDate;
  if (opts.estimateMinutes !== undefined)
    updates.estimateMinutes = opts.estimateMinutes;
  if (opts.priority) updates.priority = opts.priority;
  if (opts.progress !== undefined) {
    if (opts.progress < 0 || opts.progress > 100) {
      throw new UsageError("--progress must be between 0 and 100.");
    }
    updates.progress = opts.progress;
  }

  if (Object.keys(updates).length === 0) {
    throw new UsageError("No updates specified.");
  }

  let taskIds: number[];
  if (opts.taskIds) {
    taskIds = resolveIdList(opts.taskIds, "task ID");
  } else {
    const tasks = (await client.paginated(
      `/projects/api/v3/tasklists/${opts.tasklistId}/tasks.json`
    )) as Record<string, unknown>[];
    taskIds = tasks.map((t) => t.id as number);
  }

  if (opts.dryRun) {
    for (const id of taskIds) r.note(`  Task ${id}`);
    printDryRun(
      dryRunSummary(true, `Would update ${taskIds.length} tasks`),
      true,
      r,
      {
        counts: { total: taskIds.length, succeeded: 0, failed: 0 },
        results: taskIds.map((id) => ({ id, status: "would-update" as const })),
      }
    );
    return;
  }

  const confirm = await confirmDestructive(
    `Update ${taskIds.length} tasks (${Object.keys(updates).join(", ")})?`,
    { yes: opts.yes, json: opts.json }
  );
  if (!confirm.confirmed) {
    const outcome = abortOutcome(confirm.reason, "Aborted — nothing was updated.");
    r.result(outcome, pc.dim(outcome.summary));
    if (confirm.reason === "needs-yes") process.exitCode = 1;
    return;
  }

  const results: TaskResult[] = [];

  for (const taskId of taskIds) {
    try {
      await client.updateTask(taskId, updates);
      results.push({ id: taskId, status: "updated" });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ id: taskId, status: "failed", error });
      r.warn(pc.red(`  Failed to update task ${taskId}: ${error}`));
    }
  }

  const updated = results.filter((x) => x.status === "updated").length;
  const failed = results.filter((x) => x.status === "failed").length;
  const summary = `Complete: ${updated} updated, ${failed} failed`;
  r.result(
    { ok: failed === 0, dryRun: false, changed: updated > 0, summary,
      counts: { total: taskIds.length, succeeded: updated, failed }, results },
    summary
  );
  if (failed > 0) process.exitCode = 1;
}

export async function taskBulkDelete(opts: Opts): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  if (!opts.taskIds && !opts.tasklistId) {
    throw new UsageError("Either --task-ids or --tasklist-id is required.");
  }
  if (opts.taskIds && opts.tasklistId) {
    throw new UsageError("Pass --task-ids or --tasklist-id, not both.");
  }
  if (opts.deleteList && !opts.tasklistId) {
    throw new UsageError(
      "--delete-list deletes a whole tasklist, so it needs --tasklist-id.",
      "Pass --tasklist-id <id> --delete-list to delete the tasklist and every task in it."
    );
  }

  let taskIds: number[];
  if (opts.taskIds) {
    taskIds = resolveIdList(opts.taskIds, "task ID");
  } else {
    const tasks = (await client.paginated(
      `/projects/api/v3/tasklists/${opts.tasklistId}/tasks.json`
    )) as Record<string, unknown>[];
    taskIds = tasks.map((t) => t.id as number);
  }

  const alsoDeletesTasklist = Boolean(opts.deleteList && opts.tasklistId);
  const what = alsoDeletesTasklist
    ? `tasklist ${opts.tasklistId} and all ${taskIds.length} tasks in it`
    : opts.tasklistId
      ? `all ${taskIds.length} tasks in tasklist ${opts.tasklistId}`
      : `${taskIds.length} tasks`;

  if (opts.dryRun) {
    for (const id of taskIds) r.note(`  Task ${id}`);
    if (alsoDeletesTasklist) r.note(`  Would also delete tasklist ${opts.tasklistId}`);
    printDryRun(
      dryRunSummary(true, `Would delete ${what}`),
      true,
      r,
      {
        counts: { total: taskIds.length, succeeded: 0, failed: 0 },
        results: taskIds.map((id) => ({ id, status: "would-delete" as const })),
        ...(alsoDeletesTasklist ? { alsoDeletesTasklist: opts.tasklistId } : {}),
      }
    );
    return;
  }

  const confirm = await confirmDestructive(
    `Delete ${what}?`,
    { yes: opts.yes, json: opts.json }
  );
  if (!confirm.confirmed) {
    const outcome = abortOutcome(confirm.reason, "Aborted — nothing was deleted.");
    r.result(outcome, pc.dim(outcome.summary));
    if (confirm.reason === "needs-yes") process.exitCode = 1;
    return;
  }

  const results: TaskResult[] = [];

  for (const taskId of taskIds) {
    try {
      await client.deleteTask(taskId);
      results.push({ id: taskId, status: "deleted" });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ id: taskId, status: "failed", error });
      r.warn(pc.red(`  Failed to delete task ${taskId}: ${error}`));
    }
  }

  let tasklistDeleted: boolean | undefined;
  const anyFailed = results.some((x) => x.status === "failed");
  if (alsoDeletesTasklist && anyFailed) {
    // Keep the tasklist, so the tasks that could not be deleted are not lost with it.
    tasklistDeleted = false;
    r.warn(pc.yellow(`Kept tasklist ${opts.tasklistId}, because some tasks could not be deleted.`));
  } else if (alsoDeletesTasklist) {
    try {
      await client.deleteTaskList(opts.tasklistId!);
      tasklistDeleted = true;
      r.note(`Deleted tasklist ${opts.tasklistId}`);
    } catch (e) {
      tasklistDeleted = false;
      r.warn(pc.red(`Failed to delete tasklist: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  const deleted = results.filter((x) => x.status === "deleted").length;
  const failed = results.filter((x) => x.status === "failed").length;
  const summary = `Complete: ${deleted} deleted, ${failed} failed`;
  r.result(
    { ok: failed === 0, dryRun: false, changed: deleted > 0, summary,
      counts: { total: taskIds.length, succeeded: deleted, failed }, results,
      ...(tasklistDeleted !== undefined ? { tasklistDeleted } : {}) },
    summary
  );
  if (failed > 0) process.exitCode = 1;
}

export async function taskCreate(opts: {
  json?: boolean;
  tasklistId: number;
  name: string;
  description?: string;
  assignees?: string;
  startDate?: string;
  dueDate?: string;
  priority?: string;
  estimateMinutes?: number;
  notify?: boolean;
}): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  const assigneeUserIds = opts.assignees
    ? resolveIdList(opts.assignees, "assignee ID")
    : undefined;

  const result = await client.createTask(opts.tasklistId, {
    name: opts.name,
    description: opts.description,
    assigneeUserIds,
    startDate: opts.startDate,
    dueDate: opts.dueDate,
    priority: opts.priority,
    estimateMinutes: opts.estimateMinutes,
    notify: opts.notify,
  });

  // The v3 response nests the record under `task`, so prettyPrint's id+name
  // formatting never matches and it dumps the raw payload instead. Report the
  // outcome directly, matching `projects create` and `tasklists create`.
  const created = (result as Record<string, unknown> | null)?.task as
    | Record<string, unknown>
    | undefined;
  const id = created?.id;
  r.result(
    result,
    pc.green(
      `Created task "${opts.name}"${id ? ` (id ${id})` : ""} in tasklist ${opts.tasklistId}`
    )
  );
}

export async function taskUpdate(opts: {
  json?: boolean;
  taskId: number;
  name?: string;
  description?: string;
  assignees?: string;
  startDate?: string;
  dueDate?: string;
  priority?: string;
  estimateMinutes?: number;
}): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  const assigneeUserIds = opts.assignees
    ? resolveIdList(opts.assignees, "assignee ID")
    : undefined;

  const result = await client.updateTask(opts.taskId, {
    name: opts.name,
    description: opts.description,
    assigneeUserIds,
    startDate: opts.startDate,
    dueDate: opts.dueDate,
    priority: opts.priority,
    estimateMinutes: opts.estimateMinutes,
  });

  r.result(result, pc.green(`Updated task ${opts.taskId}`));
}

export async function taskDelete(opts: {
  json?: boolean;
  taskId: number;
  yes?: boolean;
}): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  const confirm = await confirmDestructive(
    `Delete task ${opts.taskId}?`,
    { yes: opts.yes, json: opts.json }
  );
  if (!confirm.confirmed) {
    const outcome = abortOutcome(confirm.reason, "Aborted — nothing was deleted.");
    r.result(outcome, pc.dim(outcome.summary));
    if (confirm.reason === "needs-yes") process.exitCode = 1;
    return;
  }

  await client.deleteTask(opts.taskId);
  r.result(
    { ok: true, dryRun: false, changed: true, taskId: opts.taskId,
      summary: `Deleted task ${opts.taskId}` },
    pc.green(`Deleted task ${opts.taskId}`)
  );
}
