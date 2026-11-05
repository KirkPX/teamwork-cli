# Contributing

```bash
npm ci            # installs and builds
npm test          # builds, then runs all tests
npm run typecheck
npm run dev -- --help
```

CI runs these on macOS, Windows and Linux. A change merges only when all of them pass.

## Rules for commands

[docs/cross-platform.md](docs/cross-platform.md) holds the rules for macOS, Windows and
Linux. These rules hold for every command on every system.

### Commands that change data

- Every command that changes data calls `assertWritable(opts)` first, so `--read-only`,
  `TEAMWORK_READ_ONLY` and the settings file's `readOnly` can stop it.
- Delete, archive, bulk and migration commands show a summary first. They ask for
  confirmation unless `--yes` is passed, and bulk commands support `--dry-run`.
- A command that asks must **declare** `--yes`. A prompt that cannot be skipped makes the
  command unusable in scripts and CI.
- The final output says whether remote data changed or nothing changed.

### Options

Commander binds an option to the command it is declared on. Reading `opts.x` does not
create the flag.

- Declare every option a handler reads on that exact subcommand.
- Never declare an option on both the root and a subcommand. Each copy binds to its own
  command, and the handler reads whichever is empty. `--json` is declared once, on the
  root, and reaches handlers through `{ ...program.opts(), ...opts }`.
- Test options by driving the built CLI, as `tests/command-wiring.test.ts` does. A unit test
  with a literal options object cannot see a missing declaration.

### Output and errors

- `resolveFormat()` decides the format: readable at a terminal, JSON in a pipe or with
  `--json`. Never hard-code it.
- Errors are typed (`src/errors.ts`) and say what to do next. They never print a full key.

### Network

- Every request has an explicit timeout.
- An API error names the operation, the status code and any safe detail from the response.
- Retries are few, and never repeat a write unless Teamwork treats it as safe to repeat.

### Settings and secrets

- IDs, names and prefixes for one site belong in the settings file, never in the code. See
  [docs/configuration.md](docs/configuration.md).
- Precedence is: command flags, then environment variables, then the settings file, then
  defaults.
- Secrets never go in repo files or in the settings file.

### Dependencies

- Each runtime dependency must give a clear capability, be maintained and be widely used.
- No native modules other than `@napi-rs/keyring`, and no postinstall scripts.
- Major version updates are made for every CLI in the fleet together, so Dependabot
  proposes only minor and patch updates.

### Tests

- Tests mock Teamwork. They never call the real service.
- The built binary is tested, not only the TypeScript source.
- Every command that changes data has a test.

## Before a release

- CI passes on macOS, Windows and Linux.
- A person has run the [real Windows test](docs/windows-test.md) and added a row.
- The README covers install, sign-in, the first command, troubleshooting and uninstall.
