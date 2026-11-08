# Changelog

## Unreleased

- **`teamwork whoami` asks Teamwork who the saved key belongs to.** `teamwork auth` only
  shows what is saved on this machine, so it cannot tell when Teamwork has stopped
  accepting the key.

## 0.3.0

- **`time list --from/--to` filters again.** It sent filter names Teamwork ignores, so it
  returned every time entry. Every date option now takes YYYY-MM-DD or YYYYMMDD and
  refuses an impossible date.
- **`tasks bulk-delete --delete-list` names the tasklist** in its question and dry run. It
  needs `--tasklist-id`, and keeps the tasklist when any task could not be deleted.
- **Teamwork's reason shows when it refuses a request**, as Teamwork wrote it, with a next
  step for the common refusals. `teamwork api` with a body and no method asks for one.
- **Dry runs say what would change**, in JSON too, and a real run says what it changed.
- **Plain errors for local files.** A settings or credentials file that cannot be read or
  written says why. A damaged credentials file is not written over. A mistyped command
  prints the JSON error object when the output is JSON.
- **`teamwork auth --api-key -`** reads the key from standard input, so it stays out of
  shell history.
- **Windows.** A JSON body file saved with a byte-order mark is accepted. Ctrl-D at a prompt
  answers with nothing, instead of ending the CLI as if answered.

## 0.2.0

- **Install by clone.** `npm install -g github:KirkPX/teamwork-cli` fails on npm 11, so
  the README now installs from the home folder with `git clone` and `npm run setup`, and
  updates with `git pull` and `npm run setup`. Git is now a requirement.
- **`teamwork config set` and `config unset`** change one setting, presets included, so
  nobody edits or copies the settings file.
- **Sign-in.** A refused key gets a plain message with the steps to copy it again, at login
  and on every other command. The steps say they work for password, Google and single
  sign-on accounts. A saved site with no key, or a key with no site, no longer blocks
  `teamwork login`.
- **Task estimates are saved.** `tasks create` and `tasks update --estimate-minutes` used a
  field name Teamwork ignored. The CLI now checks that the estimate was saved, and says so
  when it was not.
- **Safer writes.** `projects archive` and `tasks bulk-update` ask first (`--yes` skips),
  and `projects archive` takes `--dry-run`. Number options refuse text that is not a whole
  number.
- **PowerShell.** `teamwork api --data` takes `@<path>` or `-` for standard input, because
  PowerShell breaks JSON typed on the command line.
- **Plain errors.** A request that cannot reach Teamwork, or a file that cannot be read,
  says what failed and why. Ctrl-C at a prompt stops with exit code 130 and leaves the
  terminal usable. A closed pipe (`teamwork projects list | head`) ends quietly.
- Requests go only to the signed-in Teamwork site.

## 0.1.0

First public release.

- Commands for projects, tasks, tasklists, notebooks, files, people, companies and
  time, plus `teamwork api` for any other endpoint.
- `teamwork login` signs in through the browser and stores the key in the OS keychain.
- A settings file sets the site, read-only mode, the request timeout and named
  project presets. `teamwork projects apply-preset` applies a preset.
