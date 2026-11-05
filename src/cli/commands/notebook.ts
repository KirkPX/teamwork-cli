import { readOptionFile } from "../read-file.js";
import { UsageError } from "../../errors.js";
import { createClient } from "../client-helpers.js";
import { reporter } from "../output.js";
import { abortOutcome, assertWritable, confirmDestructive } from "../guardrails.js";
import pc from "picocolors";

export async function notebookList(opts: {
  json?: boolean;
  projectId: number;
}): Promise<void> {
  const r = reporter(opts);
  const client = createClient();

  const notebooks = await client.getNotebooks(opts.projectId);
  r.result(
    notebooks,
    notebooks.length ? undefined : `No notebooks in project ${opts.projectId}`
  );
}

export async function notebookCreate(opts: {
  json?: boolean;
  projectId: number;
  name: string;
  content?: string;
  file?: string;
  description?: string;
}): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  let content = opts.content;
  if (opts.file) content = await readOptionFile("--file", opts.file);

  if (!content) {
    throw new UsageError("Either --content or --file is required.");
  }

  const result = await client.createNotebook(opts.projectId, {
    name: opts.name,
    content,
    description: opts.description,
  });

  r.result(result);
}

export async function notebookUpdate(opts: {
  json?: boolean;
  notebookId: number;
  name?: string;
  content?: string;
  file?: string;
  description?: string;
}): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  let content = opts.content;
  if (opts.file) content = await readOptionFile("--file", opts.file);

  if (!opts.name && !content && !opts.description) {
    throw new UsageError(
      "At least one of --name, --content, --file, or --description is required."
    );
  }

  await client.updateNotebook(opts.notebookId, {
    name: opts.name,
    content,
    description: opts.description,
  });

  r.result(
    {
      ok: true,
      dryRun: false,
      changed: true,
      notebookId: opts.notebookId,
      summary: `Updated notebook ${opts.notebookId}`,
    },
    pc.green(`Updated notebook ${opts.notebookId}`)
  );
}

export async function notebookDelete(opts: {
  json?: boolean;
  notebookId: number;
  yes?: boolean;
}): Promise<void> {
  assertWritable(opts);
  const r = reporter(opts);
  const client = createClient();

  const confirm = await confirmDestructive(
    `Delete notebook ${opts.notebookId}?`,
    { yes: opts.yes, json: opts.json }
  );
  if (!confirm.confirmed) {
    const outcome = abortOutcome(confirm.reason, "Aborted — nothing was deleted.");
    r.result(outcome, pc.dim(outcome.summary));
    if (confirm.reason === "needs-yes") process.exitCode = 1;
    return;
  }

  await client.deleteNotebook(opts.notebookId);
  r.result(
    {
      ok: true,
      dryRun: false,
      changed: true,
      notebookId: opts.notebookId,
      summary: `Deleted notebook ${opts.notebookId}`,
    },
    pc.green(`Deleted notebook ${opts.notebookId}`)
  );
}
