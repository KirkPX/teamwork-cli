# Contributing

```bash
npm ci            # installs and builds
npm test          # builds, then runs all tests
npm run typecheck
npm run dev -- --help
```

CI runs these on macOS, Windows and Linux. A change merges only when all of them pass.

## Rules for commands

Read [docs/cross-platform.md](docs/cross-platform.md) first. The short version:

- **Writes:** every command that changes data calls `assertWritable(opts)` first,
  and supports `--dry-run` or asks for confirmation.
- **Output:** `resolveFormat()` decides the format. Never hard-code it.
- **Options:** declare every option the handler reads on that subcommand. `--json`
  is declared once, on the root.
- **Testing options:** drive the built CLI, as `tests/command-wiring.test.ts` does.
  A unit test with a literal options object cannot see a missing declaration.
- **Site-specific values:** IDs, names and prefixes belong in the settings file,
  never in the code. See [docs/configuration.md](docs/configuration.md).
- **Network:** every request has an explicit timeout.
- **Secrets:** never in repo files or in the settings file.
