#!/usr/bin/env node
import { Command } from "commander";
import { parseCount, parseDate, parseId, parsePercent } from "./cli/parse.js";

// Exit cleanly when the reader closes the pipe early (`teamwork tasks list | head`).
// Without this, the next write to that stream throws EPIPE, and the CLI dies with
// a stack trace and a non-zero exit. Other stream errors still propagate.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

const program = new Command();

// Commander's own errors (a missing option, an unknown command) follow the output
// contract too: one JSON object on stderr when the output is JSON. This is set
// before any subcommand is added, because each subcommand copies it when created.
program.configureOutput({
  outputError: (text, write) => {
    const json = process.argv.includes("--json") || !process.stdout.isTTY;
    if (!json) return write(text);
    const message = text.replace(/^error: /, "").trim();
    write(JSON.stringify({ error: true, message, hint: "Run the command with --help to see its options." }) + "\n");
  },
});

// --json is declared once, here on the root. Commander still accepts it after a
// subcommand (`teamwork tasks list --json`), and each action merges
// `program.opts()` so the value reaches the handler. Declaring it again on a
// subcommand would bind each copy to its own command, and the handler would read
// whichever object is empty.
program
  .name("teamwork")
  .description("Cross-platform Teamwork.com CLI")
  .version("0.3.0")
  .option("--json", "emit machine-readable JSON")
  .option("--read-only", "refuse any command that would change remote data")
  .option("--verbose", "emit diagnostic details");

// Running `teamwork` bare should do the obvious thing: sign you in if you
// never have, and otherwise show what you can do.
program.action(async () => {
  const { isConfigured, loginCommand } = await import("./cli/commands/login.js");
  if (isConfigured()) {
    program.help();
    return;
  }
  console.error("Welcome to the Teamwork CLI. Let's connect your account.");
  console.error("");
  await loginCommand();
});

program
  .command("login")
  .description("Sign in to Teamwork")
  .option("--paste", "Enter the token in the terminal instead of a browser")
  .option("--force", "Sign in again, even if already signed in")
  .action(async (opts) => {
    const { loginCommand } = await import("./cli/commands/login.js");
    await loginCommand({ ...program.opts(), ...opts });
  });

program
  .command("logout")
  .description("Sign out and clear the stored key")
  .action(async (opts) => {
    const { logoutCommand } = await import("./cli/commands/login.js");
    await logoutCommand({ ...program.opts(), ...opts });
  });

program
  .command("doctor")
  .description("Check local CLI configuration and runtime compatibility")
  .option("--install", "Close with an install verdict (used by `npm run setup`)")
  .action(async (opts) => {
    const { doctorCommand } = await import("./cli/commands/doctor.js");
    await doctorCommand({ ...program.opts(), ...opts });
  });

program
  .command("whoami")
  .description("Show who the stored key signs in as, checked with Teamwork")
  .action(async (opts) => {
    const { whoamiCommand } = await import("./cli/commands/whoami.js");
    await whoamiCommand({ ...program.opts(), ...opts });
  });

program
  .command("auth")
  .description("Manage Teamwork credentials")
  .option("--status", "Show current auth status")
  .option("--site <name>", "Teamwork site name")
  .option("--api-key <key>", "API key to store, or - to read it from standard input")
  .option("--login", "Store credentials")
  .option("--logout", "Clear credentials")
  .action(async (opts) => {
    const { authCommand } = await import("./cli/commands/auth.js");
    await authCommand({ ...program.opts(), ...opts });
  });

const configCmd = program
  .command("config")
  .description("Inspect and change the settings file");

configCmd
  .command("path")
  .description("Print where the settings file lives")
  .action(async (opts) => {
    const { configPath } = await import("./cli/commands/config.js");
    await configPath({ ...program.opts(), ...opts });
  });

configCmd
  .command("show")
  .description("Validate the settings file and print it")
  .action(async (opts) => {
    const { configShow } = await import("./cli/commands/config.js");
    await configShow({ ...program.opts(), ...opts });
  });

configCmd
  .command("set <name> <value>")
  .description("Set one setting, for example `config set readOnly true` or `config set projectPresets.automation.categoryId 678`")
  .action(async (name: string, value: string, opts) => {
    const { configSet } = await import("./cli/commands/config.js");
    await configSet(name, value, { ...program.opts(), ...opts });
  });

configCmd
  .command("unset <name>")
  .description("Remove one setting, or a whole preset with `projectPresets.<preset>`")
  .action(async (name: string, opts) => {
    const { configUnset } = await import("./cli/commands/config.js");
    await configUnset(name, { ...program.opts(), ...opts });
  });

const taskCmd = program
  .command("tasks")
  .description("Task operations");

taskCmd
  .command("list")
  .description("List tasks in a project")
  .requiredOption("--project <input>", "Project ID or URL")
  .option("--tasklist-id <id>", "Only tasks in this tasklist", parseId)
  .action(async (opts) => {
    const { taskList } = await import("./cli/commands/task.js");
    await taskList({ ...program.opts(), ...opts });
  });

taskCmd
  .command("create")
  .description("Create a task")
  .requiredOption("--tasklist-id <id>", "Tasklist ID", parseId)
  .requiredOption("--name <name>", "Task name")
  .option("--description <desc>", "Task description")
  .option("--assignees <ids>", "Comma-separated user IDs")
  .option("--start-date <date>", "Start date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--due-date <date>", "Due date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--priority <level>", "Priority: low, medium, high")
  .option("--estimate-minutes <n>", "Time estimate in minutes", parseCount)
  .option("--no-notify", "Suppress assignee notifications")
  .action(async (opts) => {
    const { taskCreate } = await import("./cli/commands/task.js");
    await taskCreate({ ...program.opts(), ...opts });
  });

taskCmd
  .command("update")
  .description("Update a task")
  .requiredOption("--task-id <id>", "Task ID", parseId)
  .option("--name <name>", "New task name")
  .option("--description <desc>", "New description")
  .option("--assignees <ids>", "Comma-separated user IDs")
  .option("--start-date <date>", "Start date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--due-date <date>", "Due date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--priority <level>", "Priority: low, medium, high")
  .option("--estimate-minutes <n>", "Time estimate in minutes", parseCount)
  .action(async (opts) => {
    const { taskUpdate } = await import("./cli/commands/task.js");
    await taskUpdate({ ...program.opts(), ...opts });
  });

taskCmd
  .command("delete")
  .description("Delete a task (destructive)")
  .requiredOption("--task-id <id>", "Task ID", parseId)
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    const { taskDelete } = await import("./cli/commands/task.js");
    await taskDelete({ ...program.opts(), ...opts });
  });

taskCmd
  .command("bulk-update")
  .description("Bulk update tasks (destructive)")
  .option("--task-ids <ids>", "Comma-separated task IDs")
  .option("--tasklist-id <id>", "Update all tasks in this tasklist", parseId)
  .option("--due-date <date>", "Due date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--start-date <date>", "Start date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--estimate-minutes <n>", "Time estimate in minutes", parseCount)
  .option("--priority <level>", "Priority: low, medium, high")
  .option("--progress <n>", "Progress percentage (0-100)", parsePercent)
  .option("--dry-run", "Show what would be updated")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    const { taskBulkUpdate } = await import("./cli/commands/task.js");
    await taskBulkUpdate({ ...program.opts(), ...opts });
  });

taskCmd
  .command("bulk-delete")
  .description("Bulk delete tasks (destructive)")
  .option("--task-ids <ids>", "Comma-separated task IDs")
  .option("--tasklist-id <id>", "Delete all tasks in this tasklist", parseId)
  .option("--delete-list", "Also delete the tasklist given by --tasklist-id")
  .option("--dry-run", "Show what would be deleted")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    const { taskBulkDelete } = await import("./cli/commands/task.js");
    await taskBulkDelete({ ...program.opts(), ...opts });
  });

const nbCmd = program
  .command("notebooks")
  .description("Notebook operations");

nbCmd
  .command("list")
  .description("List notebooks in a project")
  .requiredOption("--project-id <id>", "Project ID", parseId)
  .action(async (opts) => {
    const { notebookList } = await import("./cli/commands/notebook.js");
    await notebookList({ ...program.opts(), ...opts });
  });

nbCmd
  .command("create")
  .description("Create a notebook")
  .requiredOption("--project-id <id>", "Project ID", parseId)
  .requiredOption("--name <name>", "Notebook name")
  .option("--content <html>", "HTML content")
  .option("--file <path>", "Read content from file")
  .option("--description <desc>", "Notebook description")
  .action(async (opts) => {
    const { notebookCreate } = await import("./cli/commands/notebook.js");
    await notebookCreate({ ...program.opts(), ...opts });
  });

nbCmd
  .command("update")
  .description("Update a notebook")
  .requiredOption("--notebook-id <id>", "Notebook ID", parseId)
  .option("--name <name>", "New name")
  .option("--content <html>", "New content")
  .option("--file <path>", "Read content from file")
  .option("--description <desc>", "New description")
  .action(async (opts) => {
    const { notebookUpdate } = await import("./cli/commands/notebook.js");
    await notebookUpdate({ ...program.opts(), ...opts });
  });

nbCmd
  .command("delete")
  .description("Delete a notebook (destructive)")
  .requiredOption("--notebook-id <id>", "Notebook ID", parseId)
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    const { notebookDelete } = await import("./cli/commands/notebook.js");
    await notebookDelete({ ...program.opts(), ...opts });
  });

const projCmd = program
  .command("projects")
  .description("Project operations");

projCmd
  .command("list")
  .description("List projects")
  .option("--status <status>", "Filter: active, archived, all")
  .action(async (opts) => {
    const { projectList } = await import("./cli/commands/project.js");
    await projectList({ ...program.opts(), ...opts });
  });

projCmd
  .command("create")
  .description("Create a project")
  .requiredOption("--name <name>", "Project name")
  .option("--description <desc>", "Project description")
  .option("--company-id <id>", "Company ID", parseId)
  .option("--start-date <date>", "Start date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--end-date <date>", "End date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--dry-run", "Show what would be created")
  .action(async (opts) => {
    const { projectCreate } = await import("./cli/commands/project.js");
    await projectCreate({ ...program.opts(), ...opts });
  });

projCmd
  .command("get")
  .description("Get a project by ID or URL")
  .requiredOption("--project <input>", "Project ID or URL")
  .action(async (opts) => {
    const { projectGet } = await import("./cli/commands/project.js");
    await projectGet({ ...program.opts(), ...opts });
  });

projCmd
  .command("update-features")
  .description("Update project feature toggles")
  .requiredOption("--project <input>", "Project ID or URL")
  .option("--enable <features...>", "Features to enable")
  .option("--disable <features...>", "Features to disable")
  .option("--dry-run", "Show what would be done")
  .action(async (opts) => {
    const { projectUpdateFeatures } = await import("./cli/commands/project.js");
    await projectUpdateFeatures({ ...program.opts(), ...opts });
  });

projCmd
  .command("set-category")
  .description("Set project category")
  .requiredOption("--project <input>", "Project ID or URL")
  .requiredOption("--category-id <id>", "Category ID", parseId)
  .option("--dry-run", "Show what would be done")
  .action(async (opts) => {
    const { projectSetCategory } = await import("./cli/commands/project.js");
    await projectSetCategory({ ...program.opts(), ...opts });
  });

projCmd
  .command("add-member")
  .description("Add user(s) to a project")
  .requiredOption("--project <input>", "Project ID or URL")
  .option("--user-ids <ids...>", "User IDs to add")
  .option("--me", "Add yourself (the signed-in user)")
  .action(async (opts) => {
    const { projectAddMember } = await import("./cli/commands/project.js");
    await projectAddMember({ ...program.opts(), ...opts });
  });

projCmd
  .command("list-archived")
  .description("List archived projects")
  .option("--category <id>", "Filter by category ID", parseId)
  .option("--search <text>", "Filter by name substring")
  .action(async (opts) => {
    const { projectListArchived } = await import("./cli/commands/project.js");
    await projectListArchived({ ...program.opts(), ...opts });
  });

projCmd
  .command("archive")
  .description("Archive or unarchive a project (destructive)")
  .requiredOption("--project <input>", "Project ID or URL")
  .option("--unarchive", "Unarchive instead")
  .option("--dry-run", "Show what would be done")
  .option("--yes", "Skip the archive confirmation")
  .action(async (opts) => {
    const { projectArchive } = await import("./cli/commands/project.js");
    await projectArchive({ ...program.opts(), ...opts });
  });

projCmd
  .command("delete-incomplete-tasks")
  .description("Delete all incomplete tasks from a project (destructive)")
  .requiredOption("--project <input>", "Project ID or URL")
  .option("--dry-run", "Show what would be deleted")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    const { projectDeleteIncompleteTasks } = await import("./cli/commands/project.js");
    await projectDeleteIncompleteTasks({ ...program.opts(), ...opts });
  });

projCmd
  .command("apply-preset")
  .description("Apply a named preset from the settings file to a project")
  .requiredOption("--project <input>", "Project ID or URL")
  .requiredOption("--preset <name>", "Preset name, from projectPresets in the settings file")
  .option("--skip-rename", "Do not add the preset's name prefix")
  .option("--dry-run", "Show what would be done")
  .action(async (opts) => {
    const { projectApplyPreset } = await import("./cli/commands/project.js");
    await projectApplyPreset({ ...program.opts(), ...opts });
  });

projCmd
  .command("update")
  .description("Update a project's name, description, category or dates")
  .requiredOption("--project <input>", "Project ID or URL")
  .option("--name <name>", "New project name")
  .option("--description <desc>", "New description")
  .option("--category-id <id>", "Category ID", parseId)
  .option("--start-date <date>", "Start date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--end-date <date>", "End date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--dry-run", "Show what would be done")
  .action(async (opts) => {
    const { projectUpdate } = await import("./cli/commands/project.js");
    await projectUpdate({ ...program.opts(), ...opts });
  });

projCmd
  .command("expenses")
  .description("List a project's expenses")
  .requiredOption("--project <input>", "Project ID or URL")
  .action(async (opts) => {
    const { expensesList } = await import("./cli/commands/directory.js");
    await expensesList({ ...program.opts(), ...opts });
  });

program
  .command("people")
  .description("People operations")
  .command("list")
  .description("List people in the account")
  .option("--search <text>", "Filter by name or email substring")
  .action(async (opts) => {
    const { peopleList } = await import("./cli/commands/directory.js");
    await peopleList({ ...program.opts(), ...opts });
  });

program
  .command("companies")
  .description("Company operations")
  .command("list")
  .description("List companies in the account")
  .action(async (opts) => {
    const { companiesList } = await import("./cli/commands/directory.js");
    await companiesList({ ...program.opts(), ...opts });
  });

program
  .command("time")
  .description("Time entry operations")
  .command("list")
  .description("List time entries")
  .option("--project <input>", "Only this project (ID or URL)")
  .option("--from <date>", "From date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .option("--to <date>", "To date (YYYY-MM-DD or YYYYMMDD)", parseDate)
  .action(async (opts) => {
    const { timeList } = await import("./cli/commands/directory.js");
    await timeList({ ...program.opts(), ...opts });
  });

program
  .command("api")
  .description("Call any Teamwork endpoint with your sign-in (Desk, comments, milestones, timers, time logs)")
  .argument("<path>", "API path, e.g. /projects/api/v3/tasks/123/comments.json")
  .option("--method <method>", "GET, POST, PUT, PATCH or DELETE", "GET")
  .option("--data <json>", "JSON request body; @<path> reads it from a file, - from standard input")
  .option("--data-file <path>", "Read the JSON request body from a file (same as --data @<path>)")
  .option("--param <key=value...>", "Query parameters")
  .option("--all", "Follow pages and return every item (GET only)")
  .option("--yes", "Skip the DELETE confirmation")
  .action(async (path, opts) => {
    const { apiCommand } = await import("./cli/commands/api.js");
    await apiCommand(path, { ...program.opts(), ...opts });
  });

const tasklistCmd = program
  .command("tasklists")
  .description("Tasklist operations");

tasklistCmd
  .command("list")
  .description("List tasklists in a project")
  .requiredOption("--project-id <id>", "Project ID", parseId)
  .action(async (opts) => {
    const { tasklistList } = await import("./cli/commands/tasklist.js");
    await tasklistList({ ...program.opts(), ...opts });
  });

tasklistCmd
  .command("create")
  .description("Create a tasklist")
  .requiredOption("--project-id <id>", "Project ID", parseId)
  .requiredOption("--name <name>", "Tasklist name")
  .option("--description <desc>", "Tasklist description")
  .option("--add-to-top", "Add to the top of the project's tasklists")
  .option("--dry-run", "Show what would be created")
  .action(async (opts) => {
    const { tasklistCreate } = await import("./cli/commands/tasklist.js");
    await tasklistCreate({ ...program.opts(), ...opts });
  });

tasklistCmd
  .command("update")
  .description("Update a tasklist")
  .requiredOption("--tasklist-id <id>", "Tasklist ID", parseId)
  .option("--name <name>", "New name")
  .option("--description <desc>", "New description")
  .option("--dry-run", "Show what would be updated")
  .action(async (opts) => {
    const { tasklistUpdate } = await import("./cli/commands/tasklist.js");
    await tasklistUpdate({ ...program.opts(), ...opts });
  });

tasklistCmd
  .command("delete")
  .description("Delete a tasklist (destructive)")
  .requiredOption("--tasklist-id <id>", "Tasklist ID", parseId)
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    const { tasklistDelete } = await import("./cli/commands/tasklist.js");
    await tasklistDelete({ ...program.opts(), ...opts });
  });

const fileCmd = program
  .command("files")
  .description("File operations");

fileCmd
  .command("list")
  .description("List files attached to a task")
  .requiredOption("--task-id <id>", "Task ID", parseId)
  .action(async (opts) => {
    const { fileList } = await import("./cli/commands/file.js");
    await fileList({ ...program.opts(), ...opts });
  });

fileCmd
  .command("migrate")
  .description("Copy files from source task(s) to target task(s)")
  .option("--source <id>", "Source task ID", parseId)
  .option("--target <id>", "Target task ID", parseId)
  .option("--mappings <pairs>", "Comma-separated source:target task pairs")
  .option("--dry-run", "Show what would be migrated")
  .option("--yes", "Skip confirmation")
  .action(async (opts) => {
    const { fileMigrate } = await import("./cli/commands/file.js");
    await fileMigrate({ ...program.opts(), ...opts });
  });

program.parseAsync(process.argv).catch(async (error: unknown) => {
  const { resolveFormat } = await import("./cli/output.js");
  const { InterruptedError, safeErrorMessage } = await import("./errors.js");

  // Ctrl-C at a prompt: a person is at the terminal and knows why it stopped.
  if (error instanceof InterruptedError) {
    console.error(error.message);
    process.exitCode = 130;
    return;
  }

  const raw = error instanceof Error ? error.message : String(error);
  const message = safeErrorMessage(raw);
  // Login and config failures carry a next step; printing the cause without it
  // leaves the user guessing.
  const rawHint = (error as { hint?: unknown })?.hint;
  const hint = typeof rawHint === "string" && rawHint ? rawHint : undefined;

  // --verbose adds the stack. In json it goes INSIDE the envelope, not as a
  // second stderr write, so stderr stays parseable as one object.
  const verbose = Boolean(program.opts().verbose);
  const stack = verbose && error instanceof Error ? error.stack : undefined;

  if (resolveFormat(program.opts()) === "json") {
    // A machine reading stderr gets the same envelope shape every time.
    console.error(
      JSON.stringify({
        error: true,
        message,
        ...(hint ? { hint } : {}),
        ...(stack ? { stack: safeErrorMessage(stack) } : {}),
      })
    );
  } else {
    console.error(`Error: ${message}`);
    if (hint) console.error(hint);
    if (stack) console.error(safeErrorMessage(stack));
  }

  process.exitCode = 1;
});
