import { UsageError } from "../../errors.js";
import { createClient } from "../client-helpers.js";
import {
  abortOutcome,
  assertWritable,
  confirmDestructive,
  dryRunSummary,
  printDryRun,
} from "../guardrails.js";
import { reporter } from "../output.js";
import pc from "picocolors";

export async function fileList(opts: {
  json?: boolean;
  taskId: number;
}): Promise<void> {
  const r = reporter(opts);
  const client = createClient(opts);

  const files = await client.getTaskFiles(opts.taskId);
  r.result(files, files.length ? undefined : `No files attached to task ${opts.taskId}`);
}

type TaskMapping = {
  sourceTaskId: number;
  targetTaskId: number;
};

type PlannedFile = TaskMapping & {
  sourceFileId: number;
  filename: string;
  description?: string;
};

type MigrationResult = PlannedFile & {
  status: "migrated" | "failed" | "would-migrate";
  error?: string;
};

export async function fileMigrate(opts: {
  json?: boolean;
  source?: number;
  target?: number;
  mappings?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const mappings = parseMappings(opts);
  const client = createClient(opts);
  const planned: PlannedFile[] = [];

  for (const mapping of mappings) {
    const files = await client.getTaskFiles(mapping.sourceTaskId);
    for (const file of files) {
      const sourceFileId = Number(file.id);
      if (!Number.isFinite(sourceFileId)) continue;
      planned.push({
        ...mapping,
        sourceFileId,
        filename:
          typeof file.name === "string" ? file.name : `file_${sourceFileId}`,
        description:
          typeof file.description === "string" ? file.description : undefined,
      });
    }
  }

  if (opts.dryRun) {
    const results = planned.map((file) => ({
      ...file,
      status: "would-migrate" as const,
    }));
    for (const line of plannedLines(planned)) r.note(line);
    printDryRun(
      dryRunSummary(planned.length > 0, `Would migrate ${planned.length} files`),
      true,
      r,
      { counts: countsOf(results), results }
    );
    return;
  }

  const confirm = await confirmDestructive(
    `Copy ${planned.length} files between Teamwork tasks? Source files will remain in place.`,
    { yes: opts.yes, json: opts.json }
  );
  if (!confirm.confirmed) {
    const outcome = abortOutcome(confirm.reason, "Aborted — no files were copied.");
    r.result(outcome, pc.dim(outcome.summary));
    if (confirm.reason === "needs-yes") process.exitCode = 1;
    return;
  }

  const results: MigrationResult[] = [];

  for (const file of planned) {
    try {
      r.note(`Migrating ${file.filename}...`);
      const downloaded = await client.downloadFile(file.sourceFileId);
      const pendingRef = await client.uploadPendingFile(
        downloaded.filename,
        downloaded.bytes,
        downloaded.contentType
      );
      await client.attachFileToTask(
        file.targetTaskId,
        pendingRef,
        file.description
      );
      const result = {
        ...file,
        filename: downloaded.filename,
        status: "migrated" as const,
      };
      results.push(result);
      r.note(pc.green(`  Migrated ${result.filename}`));
    } catch (error) {
      const result = {
        ...file,
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      r.warn(pc.red(`  Failed ${file.filename}: ${result.error}`));
    }
  }

  const summary = summarize(results);
  const done = `Complete: ${summary.migrated} migrated, ${summary.failed} failed, ${summary.found} found`;
  r.result(
    {
      ok: summary.failed === 0,
      dryRun: false,
      changed: summary.migrated > 0,
      summary: done,
      counts: countsOf(results),
      results,
    },
    done
  );
  if (summary.failed > 0) process.exitCode = 1;
}

function parseMappings(opts: {
  source?: number;
  target?: number;
  mappings?: string;
}): TaskMapping[] {
  if (opts.mappings) {
    return opts.mappings.split(",").map((pair) => {
      const parts = pair.split(":").map((part) => part.trim());
      const [source, target] = parts.map(Number);
      if (parts.length !== 2 || !parts.every((part) => /^[1-9]\d*$/.test(part))) {
        throw new UsageError(`Invalid mapping '${pair}'. Expected source:target.`);
      }
      return { sourceTaskId: source, targetTaskId: target };
    });
  }

  if (opts.source && opts.target) {
    return [{ sourceTaskId: opts.source, targetTaskId: opts.target }];
  }

  throw new UsageError("Either --source and --target, or --mappings is required.");
}

function summarize(results: MigrationResult[]) {
  return {
    found: results.length,
    migrated: results.filter((result) => result.status === "migrated").length,
    failed: results.filter((result) => result.status === "failed").length,
    wouldMigrate: results.filter((result) => result.status === "would-migrate").length,
  };
}

function plannedLines(planned: PlannedFile[]): string[] {
  if (!planned.length) return ["No files found to migrate."];
  return planned.map(
    (file) =>
      `  ${file.filename} (${file.sourceFileId}): task ${file.sourceTaskId} -> ${file.targetTaskId}`
  );
}

function countsOf(results: MigrationResult[]) {
  return {
    total: results.length,
    succeeded: results.filter((r) => r.status !== "failed").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
}
