# Changelog

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
