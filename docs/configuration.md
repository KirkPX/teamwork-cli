# Configuration

Most people need no configuration: `teamwork login` finds your site and stores your
key. The settings file is for behavior you want every time.

## Where it lives

Run `teamwork config path` to see it.

| Platform | Location |
|---|---|
| macOS, Linux | `$XDG_CONFIG_HOME/teamwork-cli/config.json`, or `~/.config/teamwork-cli/config.json` |
| Windows | `%APPDATA%\teamwork-cli\config.json` |

`TEAMWORK_CLI_CONFIG_FILE` points the CLI at another file. Use it to keep one file
per Teamwork site, or to commit a shared file to a team's own repo.

## Precedence

Highest first: command flags, environment variables, the settings file (and the
keychain for the key), defaults.

## Settings

Change a setting with `teamwork config set`, so you never edit or copy the file by
hand. It checks the value before it writes, and makes the file if there is none:

```bash
teamwork config set readOnly true
teamwork config set timeoutMs 60000
teamwork config unset readOnly
```

See [examples/config.json](../examples/config.json) for a full file.

| Key | Type | Default | What it does |
|---|---|---|---|
| `siteName` | string | none | Your site, the part before `.teamwork.com`. `teamwork login` sets it. |
| `readOnly` | boolean | `false` | Refuse every command that changes data. |
| `timeoutMs` | integer, up to 600000 | `30000` | How long to wait for each request. |
| `projectPresets` | object | none | Named sets of project changes. See below. |

The file never holds your API key.

## Validation

`teamwork config show` checks the file and prints it. Every command that reads the
file checks it first, and stops with the reason if it is wrong. It stops on an
unknown key too: if `readonly` were ignored as a typo, commands would write when you
meant to block them. `teamwork doctor` reports a bad file without stopping.

## Read-only mode

The `--read-only` flag always turns it on. `TEAMWORK_READ_ONLY` beats the settings
file in both directions, so `TEAMWORK_READ_ONLY=0` lets one run write when the file
says `"readOnly": true`.

## Project presets

A preset applies a name prefix, a category and feature toggles in one step, so
projects of one kind stay consistent. The CLI ships none, because the values belong
to your site.

```bash
teamwork projects apply-preset --project 12345 --preset automation --dry-run
teamwork projects apply-preset --project 12345 --preset automation
```

| Field | What it does |
|---|---|
| `description` | A note for people reading the file. |
| `namePrefix` | Added to the project name, unless the name already starts with it or you pass `--skip-rename`. |
| `categoryId` | The category to move the project into. |
| `features` | Feature names set to `true` or `false`. Features you leave out stay as they are. |

Build a preset with one `config set` line per field. Remove a whole preset with
`teamwork config unset projectPresets.<preset>`:

```bash
teamwork config set projectPresets.automation.namePrefix "Automation - "
teamwork config set projectPresets.automation.categoryId 678
teamwork config set projectPresets.automation.features.time false
```

A preset must set at least one of `namePrefix`, `categoryId` or `features`. Preset
names are lowercase and hyphenated.

Feature names: `tasks`, `messages`, `time`, `billing`, `milestones`, `files`,
`notebook`, `links`, `riskregister`, `comments`, `board`, `table`, `gantt`, `finance`,
`forms`, `proofs`, `tickets`, `timeline`, `dashboard`, `calendar`, `overview`, `activity`.
