# Agent instructions

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/cross-platform.md](docs/cross-platform.md).

Project shape:

- `src/index.ts`: CLI entry point, with lazy command imports.
- `src/client.ts`: Teamwork API transport.
- `src/settings.ts`: the settings file. `src/config.ts`: the precedence chain.
- `src/auth.ts`: credential stores.
- `src/errors.ts`: typed errors, with secret redaction.
- `src/cli/output.ts`, `src/cli/guardrails.ts`: output format, dry runs, confirmation, read-only.
- `src/cli/commands/`: one file per command group.
