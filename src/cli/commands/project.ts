import { PROJECT_FEATURES } from "../../client.js";
import { UsageError } from "../../errors.js";
import { settingsFilePath } from "../../paths.js";
import { loadSettings } from "../../settings.js";
import { createClient } from "../client-helpers.js";
import { resolveIds, resolveProjectInput } from "../resolve.js";
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

export async function projectList(opts: Opts & { status?: string }): Promise<void> {
  const r = reporter(opts);
  const client = createClient();
  const projects = await client.getProjects(
    (opts.status as "active" | "archived" | "all") ?? undefined
  );
  r.result(projects);
}

export async function projectCreate(
  opts: Opts & {
    name: string;
    description?: string;
    companyId?: number;
    startDate?: string;
    endDate?: string;
    dryRun?: boolean;
  }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  if (opts.dryRun) {
    printDryRun(dryRunSummary(true, `Would create project "${opts.name}"`), true, r);
    return;
  }

  const result = await client.createProject({
    name: opts.name,
    description: opts.description,
    companyId: opts.companyId,
    startDate: opts.startDate,
    endDate: opts.endDate,
  });

  const id = (result as Record<string, unknown> | null)?.id;
  r.result(
    result,
    pc.green(`Created project "${opts.name}"${id ? ` (id ${id})` : ""}`)
  );
}

export async function projectGet(opts: Opts & { project: string }): Promise<void> {
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);
  const project = await client.getProject(id);
  r.result(project);
}

export async function projectUpdateFeatures(
  opts: Opts & { project: string; enable?: string[]; disable?: string[]; dryRun?: boolean }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  if (!opts.enable?.length && !opts.disable?.length) {
    throw new UsageError("Specify at least one --enable or --disable option.");
  }

  const features: Record<string, boolean> = {};
  for (const f of opts.enable ?? []) features[f.toLowerCase()] = true;
  for (const f of opts.disable ?? []) features[f.toLowerCase()] = false;
  const unknown = Object.keys(features).filter((f) => !Object.hasOwn(PROJECT_FEATURES, f));
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown project feature: ${unknown.join(", ")}`,
      `Available: ${Object.keys(PROJECT_FEATURES).join(", ")}`
    );
  }

  const proj = await client.getProject(id);
  r.note(`Project ${id}: ${proj.name ?? "(unknown)"}`);

  for (const [feat, enabled] of Object.entries(features)) {
    r.note(`  Will ${enabled ? "enable" : "disable"}: ${feat}`);
  }

  if (opts.dryRun) {
    printDryRun(dryRunSummary(true, "No changes made"), true, r);
    return;
  }

  await client.updateProject(id, { features });
  r.result(
    { ok: true, dryRun: false, changed: true, projectId: id, summary: "Done!" },
    pc.green("Done!")
  );
}

export async function projectSetCategory(
  opts: Opts & { project: string; categoryId: number; dryRun?: boolean }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  const proj = await client.getProject(id);
  r.note(`Project ${id}: ${proj.name ?? "(unknown)"}`);
  r.note(`  Will set category to: ${opts.categoryId}`);

  if (opts.dryRun) {
    printDryRun(dryRunSummary(true, "No changes made"), true, r);
    return;
  }

  await client.updateProject(id, { categoryId: opts.categoryId });
  r.result(
    { ok: true, dryRun: false, changed: true, projectId: id, summary: "Done!" },
    pc.green("Done!")
  );
}

export async function projectAddMember(
  opts: Opts & { project: string; userIds?: string[]; me?: boolean }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  if (!opts.userIds?.length && !opts.me) {
    throw new UsageError("Specify at least one --user-ids value, or --me.");
  }
  const ids = opts.userIds?.length ? resolveIds(opts.userIds, "user ID") : [];
  // --me is whoever the stored key belongs to, so the flag means the same
  // thing for every person who signs in, not one hard-coded user.
  if (opts.me) {
    const me = await client.me();
    const person = (me.person ?? me) as Record<string, unknown>;
    const meId = Number(person.id);
    if (!Number.isInteger(meId) || meId <= 0) {
      throw new UsageError("Could not work out your user ID from the signed-in key.");
    }
    if (!ids.includes(meId)) ids.push(meId);
  }

  r.note(`Adding users ${ids} to project ${id}...`);
  await client.addProjectMembers(id, ids);
  r.result(
    { ok: true, dryRun: false, changed: true, projectId: id, added: ids,
      summary: `Added ${ids.length} user(s) to project` },
    pc.green(`Added ${ids.length} user(s) to project`)
  );
}

export async function projectListArchived(
  opts: Opts & { category?: number; search?: string }
): Promise<void> {
  const r = reporter(opts);
  const client = createClient();

  let projects = (await client.getProjects("archived")) as Record<
    string,
    unknown
  >[];

  if (opts.category) {
    projects = projects.filter(
      (p) =>
        ((p.category as Record<string, unknown>)?.id as number) ===
        opts.category
    );
  }

  if (opts.search) {
    const q = opts.search.toLowerCase();
    projects = projects.filter((p) =>
      ((p.name as string) ?? "").toLowerCase().includes(q)
    );
  }

  r.result(projects);
}

export async function projectArchive(
  opts: Opts & { project: string; unarchive?: boolean }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  const status = opts.unarchive ? "active" : "archived";
  const action = opts.unarchive ? "Unarchiving" : "Archiving";

  r.note(`${action} project ${id}...`);
  await client.updateProject(id, { status });
  r.result(
    { ok: true, dryRun: false, changed: true, projectId: id, status,
      summary: `Project ${status}!` },
    pc.green(`Project ${status}!`)
  );
}

export async function projectDeleteIncompleteTasks(
  opts: Opts & { project: string; dryRun?: boolean; yes?: boolean }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  const allTasks = (await client.getProjectTasks(id)) as Record<
    string,
    unknown
  >[];
  const incomplete = allTasks.filter((t) => t.status !== "completed");

  r.note(`Found ${incomplete.length} incomplete tasks in project ${id}`);

  if (!incomplete.length) {
    r.result(
      { ok: true, dryRun: false, changed: false, projectId: id,
        summary: `No incomplete tasks in project ${id}`,
        counts: { total: 0, succeeded: 0, failed: 0 }, results: [] },
      pc.dim(`No incomplete tasks in project ${id}`)
    );
    return;
  }

  if (opts.dryRun) {
    for (const t of incomplete) {
      r.note(`  Would delete: ${t.id} - ${t.name}`);
    }
    printDryRun(dryRunSummary(true, `Would delete ${incomplete.length} tasks`), true, r, {
      counts: { total: incomplete.length, succeeded: 0, failed: 0 },
      results: incomplete.map((t) => ({ id: t.id, name: t.name, status: "would-delete" as const })),
    });
    return;
  }

  // This deletes every incomplete task in the project, so it always confirms
  // unless --yes is passed.
  const confirm = await confirmDestructive(
    `Delete ${incomplete.length} incomplete tasks from project ${id}?`,
    { yes: opts.yes, json: opts.json }
  );
  if (!confirm.confirmed) {
    const outcome = abortOutcome(confirm.reason, "Aborted — nothing was deleted.");
    r.result(outcome, pc.dim(outcome.summary));
    if (confirm.reason === "needs-yes") process.exitCode = 1;
    return;
  }

  const results: { id: number; name: unknown; status: "deleted" | "failed"; error?: string }[] = [];
  for (const t of incomplete) {
    try {
      await client.deleteTask(t.id as number);
      results.push({ id: t.id as number, name: t.name, status: "deleted" });
      r.note(`  Deleted: ${t.id} - ${t.name}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ id: t.id as number, name: t.name, status: "failed", error });
      r.warn(pc.red(`  Failed to delete ${t.id}: ${error}`));
    }
  }

  const deleted = results.filter((x) => x.status === "deleted").length;
  const failed = results.filter((x) => x.status === "failed").length;
  const summary = `Deleted ${deleted} tasks`;
  r.result(
    { ok: failed === 0, dryRun: false, changed: deleted > 0, projectId: id, summary,
      counts: { total: incomplete.length, succeeded: deleted, failed }, results },
    pc.green(summary)
  );
  if (failed > 0) process.exitCode = 1;
}

/**
 * Apply a named preset from the settings file. A preset can set a name prefix,
 * a category and a set of feature toggles in one step, so projects of one kind
 * stay consistent. The CLI ships none, because these values belong to each site.
 */
export async function projectApplyPreset(
  opts: Opts & { project: string; preset: string; dryRun?: boolean; skipRename?: boolean }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const presets = loadSettings().projectPresets ?? {};
  const preset = presets[opts.preset];
  if (!preset) {
    const known = Object.keys(presets).sort().join(", ") || "none";
    throw new UsageError(
      `Unknown project preset: ${opts.preset} (available: ${known})`,
      `Presets are defined in ${settingsFilePath()}. See docs/configuration.md.`
    );
  }

  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  const proj = await client.getProject(id);
  const currentName = String(proj.name ?? "");
  r.note(`Project ${id}: ${currentName}`);

  const { namePrefix, categoryId, features } = preset;
  const newName =
    namePrefix && !opts.skipRename && !currentName.startsWith(namePrefix)
      ? `${namePrefix}${currentName}`
      : undefined;
  if (newName) r.note(`  Will rename to: ${newName}`);
  if (categoryId) r.note(`  Will set category to: ${categoryId}`);
  for (const [feature, enabled] of Object.entries(features ?? {})) {
    r.note(`  Will ${enabled ? "enable" : "disable"}: ${feature}`);
  }

  const detail = {
    projectId: id,
    preset: opts.preset,
    name: newName ?? currentName,
    renamed: Boolean(newName),
    categoryId,
    features,
  };

  if (opts.dryRun) {
    printDryRun(dryRunSummary(true, "No changes made"), true, r, detail);
    return;
  }

  await client.updateProject(id, { name: newName, categoryId, features });
  r.result(
    { ok: true, dryRun: false, changed: true, summary: "Done!", ...detail },
    pc.green("Done!")
  );
}

export async function projectUpdate(
  opts: Opts & {
    project: string;
    name?: string;
    description?: string;
    categoryId?: number;
    startDate?: string;
    endDate?: string;
    dryRun?: boolean;
  }
): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();
  const id = resolveProjectInput(opts.project);
  if (!id) throw new UsageError(`Invalid project identifier: ${opts.project}`);

  const updates = {
    name: opts.name,
    description: opts.description,
    categoryId: opts.categoryId,
    startDate: opts.startDate,
    endDate: opts.endDate,
  };
  const fields = Object.entries(updates).filter(([, v]) => v !== undefined);
  if (!fields.length) {
    throw new UsageError(
      "Specify at least one of --name, --description, --category-id, --start-date, --end-date."
    );
  }

  const proj = await client.getProject(id);
  r.note(`Project ${id}: ${proj.name ?? "(unknown)"}`);
  for (const [key, val] of fields) r.note(`  Will set ${key}: ${val}`);

  if (opts.dryRun) {
    printDryRun(dryRunSummary(true, "No changes made"), true, r, { projectId: id });
    return;
  }

  await client.updateProject(id, updates);
  r.result(
    { ok: true, dryRun: false, changed: true, projectId: id, summary: "Done!" },
    pc.green("Done!")
  );
}
