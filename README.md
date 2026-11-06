# Teamwork CLI

[![CI](https://github.com/KirkPX/teamwork-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/KirkPX/teamwork-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A command line for [Teamwork.com](https://www.teamwork.com) on macOS, Windows and
Linux. Output is readable at a terminal and JSON in a pipe. Read-only mode blocks every
write, bulk and destructive writes can be previewed first, and your key stays in the
OS keychain.

```bash
teamwork projects list
teamwork tasks bulk-update --tasklist-id 67890 --priority high --dry-run
teamwork projects list | jq '.[0].name'
```

This is an independent project. It is not affiliated with or endorsed by Teamwork.

## Install

You need **Node.js 20 or newer** and Git.

```bash
cd ~
git clone https://github.com/KirkPX/teamwork-cli.git
cd teamwork-cli
npm run setup
teamwork login
```

`cd ~` puts the tool in your home folder. A PowerShell window can open in a system folder, where
the clone would fail or be hard to find. To update later:

```bash
cd ~/teamwork-cli
git pull
npm run setup
```

`npm run setup` installs, builds, links, and then tells you where you stand:

```
Installed. Next: teamwork login
```

If the `teamwork` command is not reachable yet, it says so and prints the fix.

### Windows

Install Node and Git first if you do not have them:

```powershell
winget install OpenJS.NodeJS.LTS Git.Git
```

Then use the commands above in a **new** PowerShell window, because the installers
change PATH and an open window keeps the old one. You need no compiler or build
tools: the keychain dependency ships prebuilt binaries.

`setup` ends by checking that the `teamwork` command actually resolves, and
tells you in the terminal either way. It runs through Node directly rather than
through the installed command, so it still reports when the command itself is
not reachable yet:

```
OK   Node.js: v20.11.0
OK   Platform: win32/x64
WARN teamwork on PATH: not found — the `teamwork` command will not be recognised yet

Almost there — the `teamwork` command is not reachable yet.
Do this, then run teamwork login:
  `npm link` writes its shims to %APPDATA%\npm.
  Open a NEW terminal — an existing one keeps the old PATH.
```

When it is reachable, the last line reads `Installed. Next: teamwork login`.

**If PowerShell refuses to run it** with "running scripts is disabled on this
system", that is the execution policy blocking npm's `.ps1` shim, not this CLI.
Either allow local scripts for your own user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

or call the `.cmd` shim, which the policy does not apply to:

```powershell
teamwork.cmd login
```

Your API key is stored in **Windows Credential Manager**. `teamwork login` opens
your default browser the same way it does elsewhere.

## Sign in

One command, no arguments. Identical on macOS, Windows, and Linux:

```bash
teamwork login
```

It opens a page in your browser, walks you to your Teamwork token, and waits for you
to paste it. The CLI then checks the token with Teamwork, works out which site it
belongs to, and saves it to your OS keychain. You never type a site name, and the
token never lands in your shell history.

Running `teamwork` with no arguments does the same thing when you have not signed in
yet, so first launch is a single word.

To find the token, the page walks you through this: sign in, then click your profile
picture (bottom left, or top right on older layouts) → **Edit My Details** →
**API & Mobile** → **Show your Token**.

The token is part of your Teamwork profile, so these steps are the same whether you
sign in to Teamwork with a password, Google or single sign-on. If you cannot see
**API & Mobile**, ask your site administrator.

Teamwork has no direct link to that tab. It is a dialog rendered on top of
whatever page you are on, not a route — the URL never changes when you open it —
so no deep link is possible and the steps above are the only way in.

### No browser (SSH, headless, restricted desktop)

```bash
teamwork login --paste
```

Prompts for the token in the terminal, without echoing it. The CLI falls back to this
automatically when there is no browser to hand off to.

### Signing out, or switching accounts

```bash
teamwork logout
teamwork login --force
```

### CI and automation

Environment variables skip login entirely:

bash (macOS, Linux, and Git Bash on Windows):

```bash
export TEAMWORK_SITE_NAME=yoursite
export TEAMWORK_API_KEY=your-api-key
```

PowerShell:

```powershell
$env:TEAMWORK_SITE_NAME = "yoursite"
$env:TEAMWORK_API_KEY = "your-api-key"
```

`TEAMWORK_SITE_NAME` takes the subdomain only. `yoursite` and `yoursite.teamwork.com`
both work; do not include `https://` or a trailing slash.

Where the site and key come from, first match wins:
1. Environment variables (`TEAMWORK_SITE_NAME`, `TEAMWORK_API_KEY`)
2. The settings file (site name), and the OS keychain or private credentials file (key)

No command takes the site or key as a flag, and there is no default: both are required.

## Configure

`teamwork login` covers the normal case. A settings file holds anything you want every
time: your site, read-only mode, the request timeout and named project presets.

```bash
teamwork config path                  # where the file lives
teamwork config show                  # check it and print it
teamwork config set readOnly true     # change one setting
teamwork config unset readOnly        # remove it again
```

`config set` checks the value before it writes, so you never edit or copy the file
by hand.

[docs/configuration.md](docs/configuration.md) describes every setting.
For CI and agents, environment variables skip login entirely. `.env.example` lists
every variable the CLI reads.

| Variable | Purpose |
|---|---|
| `TEAMWORK_API_KEY` | Your API key. Use this where a keychain is unavailable. |
| `TEAMWORK_SITE_NAME` | Your site, the part before `.teamwork.com`. Usually discovered for you. |
| `TEAMWORK_READ_ONLY` | Refuse every command that would change remote data. `0` turns off a read-only setting for one run. |
| `TEAMWORK_CLI_CONFIG_FILE` | Use this settings file instead of the default one. |
| `TEAMWORK_CLI_CREDENTIAL_STORE` | Set to `memory` to keep the key for this process only, or `file` to use only the credentials file. |
| `TEAMWORK_CLI_CREDENTIALS_FILE` | Where the credentials file lives. Default: `credentials.json` in the settings folder. |
| `TEAMWORK_CLI_NO_BROWSER` | Stop `login` opening a browser. |

Precedence, highest first: **command flags → environment variables → settings file
and keychain → defaults.** `teamwork doctor` prints the settings file path and what
it resolved.

## Output

Two formats, and you rarely have to choose. An interactive terminal gets human
output; anything else — a pipe, a redirect, CI, an agent — gets JSON, with no
flag needed. `--json` forces it.

```bash
teamwork projects list                 # human-readable at a terminal
teamwork projects list | jq '.[0]'     # JSON, because a pipe is not a terminal
```

That means redirecting a command to a file gets you JSON, not the green sentence
you see on screen. Errors go to stderr as `{"error": true, "message": …}` while
stdout stays empty, so a failed command never puts prose into your pipeline.

## First Command

```bash
teamwork login
teamwork projects list
```

`teamwork doctor` checks your local setup — Node version, platform, and whether a
keychain is available. It makes no network call, so it cannot tell you whether your
credentials work. `teamwork projects list` can.

## Projects

```bash
teamwork projects list --status active
teamwork projects get --project 12345
```

Create a project (**mutates Teamwork data**):

```bash
teamwork projects create --name "My Project" --dry-run
teamwork projects create --name "My Project" --description "What it's for"
```

Change an existing project (**all mutate Teamwork data**). Each one takes `--project`
as a numeric ID or any Teamwork project URL:

```bash
teamwork projects update --project 12345 --name "New name" --category-id 678
teamwork projects update-features --project 12345 --enable notebook comments --disable time
teamwork projects set-category --project 12345 --category-id 678
teamwork projects add-member --project 12345 --user-ids 111 222
teamwork projects add-member --project 12345 --me
teamwork projects archive --project 12345 --dry-run  # asks first; --yes skips; --unarchive reverses
teamwork projects delete-incomplete-tasks --project 12345 --dry-run
```

A preset from your settings file applies a name prefix, a category and feature toggles
in one step. See [docs/configuration.md](docs/configuration.md#project-presets):

```bash
teamwork projects apply-preset --project 12345 --preset automation --dry-run
teamwork projects apply-preset --project 12345 --preset automation
```

Read-only project lookups:

```bash
teamwork projects list-archived --category 678 --search "Finance"
teamwork projects expenses --project 12345
```

## People, companies and time

```bash
teamwork people list --search ada
teamwork companies list
teamwork time list --project 12345 --from 20260101 --to 20260131
```

## Any other endpoint

`teamwork api` calls any Teamwork endpoint with your stored sign-in. Use it for what
the named commands do not cover: task comments, milestones, timers, single time logs
and tags. The path is the part after your site's address.

```bash
teamwork api /projects/api/v3/tasks/123/comments.json
teamwork api /projects/api/v3/tags.json --all
teamwork api /tasks/123/comments.json --method POST \
  --data '{"comment":{"body":"Done","notify":""}}'
teamwork api /tasks/123/complete.json --method PUT
teamwork api /comments/456.json --method DELETE --yes
```

- `--param key=value` adds query parameters. Repeat it, or list several after one flag.
- `--data @<path>` reads the JSON body from a file, and `--data -` reads it from
  standard input. `--data-file <path>` does the same as `--data @<path>`.
- In PowerShell, pass the body from a file or standard input. PowerShell removes the
  double quotes inside a typed JSON argument, so `--data '{...}'` arrives broken:

  ```powershell
  '{"comment":{"body":"Done","notify":""}}' | teamwork api /tasks/123/comments.json --method POST --data -
  teamwork api /tasks/123/comments.json --method POST --data "@comment.json"
  ```

- `--all` follows page numbers and returns every item. It works with GET only.
- Every method except GET obeys `--read-only`. DELETE asks first, unless you pass `--yes`.

## Tasklists

Teamwork nests tasks under tasklists, so a task cannot exist without one. Create the
tasklist first, then create tasks against its id.

```bash
teamwork tasklists list --project-id 12345
```

Create, update, and delete (**all mutate Teamwork data**):

```bash
teamwork tasklists create --project-id 12345 --name "Phase 1" --dry-run
teamwork tasklists create --project-id 12345 --name "Phase 1"
teamwork tasklists update --tasklist-id 67890 --name "Phase 1 - Alpha"
teamwork tasklists delete --tasklist-id 67890 --yes
```

## Tasks

```bash
teamwork tasks list --project 12345
teamwork tasks list --project 12345 --tasklist-id 67890
```

Create a task (**mutates Teamwork data**). `--tasklist-id` is required:

```bash
teamwork tasks create --tasklist-id 67890 --name "Do the thing" \
  --description "Details" --due-date 2026-08-01 --priority high
```

Update, delete and bulk-change tasks (**all mutate Teamwork data**):

```bash
teamwork tasks update --task-id 123 --due-date 2026-08-15 --estimate-minutes 60
teamwork tasks delete --task-id 123 --yes
teamwork tasks bulk-update --tasklist-id 67890 --priority high --dry-run   # asks first; --yes skips
teamwork tasks bulk-delete --task-ids 123,456 --dry-run
```

## Notebooks

```bash
teamwork notebooks list --project-id 12345
```

Create a notebook (**mutates Teamwork data**):

```bash
teamwork notebooks create --project-id 12345 --name "Planning Doc" \
  --file ./planning-doc.html
```

`--content` and `--file` both expect **HTML**. There is no Markdown conversion — a
`.md` file is stored verbatim and renders with literal `#` and `*` characters.
Convert to HTML first.

## Files

List files attached to a task:

```bash
teamwork files list --task-id 12345
```

Copy files from one task to another. This copies files only; it does not remove files from the source task.

```bash
# Preview first
teamwork files migrate --source 12345 --target 67890 --dry-run

# Copy after reviewing the dry run
teamwork files migrate --source 12345 --target 67890 --yes

# Copy multiple task pairs
teamwork files migrate --mappings "12345:67890,22222:33333" --dry-run
```

Use `--json` for scriptable output. A command that asks first does not ask when input
is not a terminal or `--json` is set. It stops with exit code 1 instead, so scripts pass
`--yes`. The question itself goes to stderr.

## Auth

```bash
# Sign in
teamwork login

# Check status
teamwork auth

# Sign out
teamwork logout
```

`teamwork auth --site <name> --api-key <key>` still works for scripted setup, but it
stores the key without contacting Teamwork, so a bad key is reported as stored.
`teamwork login` verifies before saving. Prefer it.

Windows PowerShell uses the same commands — they are ordinary flags, not shell syntax.

API keys are stored in your OS keychain (macOS Keychain / Windows Credential Manager) when it can be used. macOS closes the keychain to SSH sessions, so a sign-in over SSH saves the key to a private file in the settings folder instead (`credentials.json`, readable only by you). The CLI reads the keychain first, then that file. Once the file exists, a new key saved from the desktop updates it too.

## Network Behavior

The CLI rate-limits requests to roughly two per second. Each request, including reading
the reply, must finish within 30 seconds, or `timeoutMs` from the settings file. A request
that cannot reach the site says which host failed and why.

Retries are bounded and visible. A `429` is always retried — the request was
rejected, so nothing was applied. A `5xx` is retried **only on reads**: a `500`
from a `POST` may have applied the change before failing to answer, so replaying
it could duplicate work. Up to three attempts in total.

`Retry-After` is honored exactly when Teamwork sends it. Otherwise the delay
backs off exponentially from 1 second, with jitter, capped at 30 seconds. Retry
notices go to stderr so JSON on stdout stays parseable.

## Troubleshooting

**`teamwork: command not found`** — `npm link` writes its shims to npm's bin
directory. Open a new terminal, then run `npm run doctor`; it tells you whether
the command resolves and how to fix it if not.

**`teamwork` runs something else** — `doctor` reports `shadowed` when another
program of the same name comes first on your `PATH`. It names the offender. Put
npm's bin directory ahead of it, or rename the other program.

**"running scripts is disabled on this system" (PowerShell)** — the execution
policy is blocking npm's `.ps1` shim, not this CLI. Either
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or call `teamwork.cmd`.

**"Not signed in."** — run `teamwork login`. For automation set
`TEAMWORK_API_KEY` instead.

**"Teamwork refused the key"** — the saved key no longer works, for example because
it was reset in Teamwork. Run `teamwork login --force` and paste the current token.

**The key is in a file, not the keychain** — no OS keychain could be used (an SSH
session on macOS, or Linux with no Secret Service), so the key went to the private
`credentials.json` in the settings folder, readable only by you. `teamwork doctor` shows
which store is in use. For automation, set `TEAMWORK_API_KEY` and nothing is stored.

**A destructive command exits without doing anything** — it refused because it
could not ask. Confirmation is never prompted to a machine: pass `--yes`
explicitly in scripts and CI.

**"Read-only mode is on"** — `--read-only`, `TEAMWORK_READ_ONLY` or `readOnly` in the
settings file is set.

**"Invalid settings"** — the settings file has a wrong value or an unknown key. The
message names it. `teamwork config show` checks the file again after you fix it.

**A command is slow under load** — Teamwork is rate-limiting. The CLI honors
`Retry-After` and otherwise backs off from 1 second. Retry notices go to stderr.

## Uninstall

```bash
teamwork logout                 # remove saved credentials; run this first
npm uninstall -g teamwork-cli   # remove the command
```

Then delete the `teamwork-cli` folder you cloned. The settings file stays until you
delete it. `teamwork config path` shows where it is, before you uninstall.

## Documentation

- [Configuration](docs/configuration.md)
- [Sign-in design](docs/sign-in.md)
- [Cross-platform rules](docs/cross-platform.md)
- [Real Windows test](docs/windows-test.md)
- [Task notifications](docs/task-notifications.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
