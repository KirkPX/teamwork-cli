# Cross-platform rules

This document defines how `teamwork-cli` must be authored so it stays usable on macOS and Windows.

## Product Standard

The CLI should feel like a small native tool, not a repo script. A Windows user should be able to install it, run `teamwork --help`, configure credentials, and use the same documented commands as a macOS user.

## Runtime

- Target Node.js 20 or newer.
- Use TypeScript compiled to ESM JavaScript.
- Do not rely on Bash, Zsh, PowerShell, `sed`, `awk`, `grep`, `curl`, `open`, `osascript`, or other shell-specific tools for core CLI behavior.
- If a helper must call an external executable, it must first check that the executable exists and return a clear error when it does not.
- Prefer Node APIs over shell commands for filesystem, path, HTTP, browser, and process work.

## Paths And Files

- Always use Node's `path`, `fs`, `os`, and URL APIs instead of string-concatenating paths.
- Never assume `/` as a path separator.
- Never assume home directories look like `/Users/name` or `C:\Users\name`.
- Store user settings in the location `src/paths.ts` defines: `%APPDATA%` on Windows, the XDG folder elsewhere.
- Keep project-local `.env` support only as a development convenience, not as the primary user config path.
- Treat filenames as Unicode strings and read/write text as UTF-8 unless a file format explicitly says otherwise.

## Secrets And Auth

- Do not write API keys or tokens into repo files.
- Support environment variables for CI and automation.
- For regular users, prefer OS keychain storage when practical. On Windows this means Credential Manager; on macOS this means Keychain.
- If a secret must be stored outside the OS keychain, the command must make that tradeoff visible to the user.
- Error messages must never print full API keys or tokens.

## Terminal UX

- Human output should be plain, readable, and useful without color.
- Color must be optional decoration, not the only signal.
- Do not use terminal control sequences that assume a Unix TTY.
- Detect non-interactive output and avoid spinners/progress animations there.
- Provide JSON output for commands likely to be scripted.
- Keep command names and options lowercase, hyphenated, and stable.

## Windows Requirements

- Commands must run in PowerShell and Windows Terminal.
- Do not require WSL, Git Bash, Homebrew, or Unix command-line tools.
- Avoid package choices that require native compilation unless the dependency is essential and tested on Windows CI.
- Avoid postinstall scripts.
- Document examples in PowerShell when showing Windows-specific setup.
- Test any command that reads files with paths containing spaces.

## macOS Requirements

- Commands must run in Terminal and iTerm without requiring Homebrew-only tools for core behavior.
- Do not depend on AppleScript, `open`, or Chrome automation for core CLI behavior.
- Browser-opening helpers may use platform-aware libraries, but core commands must remain usable without them.

## Network Behavior

- Every HTTP request must have an explicit timeout.
- API errors must show the operation, status code, and safe response detail when available.
- Rate-limit handling must be explicit and visible to the user.
- Retries should be limited, conservative, and never silently repeat unsafe mutations unless the API operation is known to be idempotent against Teamwork's behavior.

## Destructive Operations

- Delete, archive, bulk update, and migration commands must show a summary before changing remote data.
- Destructive commands must require confirmation unless `--yes` is passed.
- A destructive command must **declare** `--yes`, not merely read `opts.yes`. A command that prompts but cannot be bypassed is unusable in scripts and CI, which is a regression even though it looks safer.
- Bulk commands should support `--dry-run` before release.
- Commands must distinguish between "nothing changed" and "changed remote data" in their final output.

## Command Wiring

Commander binds options to the command they are declared on. Every option a handler reads must be declared on that exact subcommand — reading `opts.x` is not what creates the flag.

- **Declare every option the handler reads.** If a handler branches on `opts.yes`, the subcommand must have `.option("--yes", …)`. Otherwise the flag is rejected as an unknown option and the handler's branch is dead code.
- **Never declare the same option on both the root program and a subcommand.** Each declaration binds to its own command, and the handler reads whichever object is empty. `--json` is declared once, on the root, and reached through `{ ...program.opts(), ...opts }`.
- **Options are wiring, not documentation.** A handler's `Opts` type, a doc line, and a commit message all describe intent; only the `.option()` call registers the flag. Type-checking cannot catch the gap, because an undeclared option is a well-typed `undefined`.

Unit tests that call handlers with a literal opts object cannot see these mistakes. Verify option behavior by driving the registered CLI: `tests/command-wiring.test.ts` walks every command's `--help`, and fails when a destructive command omits `--yes` or when a subcommand declares `--json`.

## Packaging

- The package must expose `teamwork` as the primary binary.
- `tw` can be offered as an alias, but docs should prefer `teamwork` to avoid collisions.
- Release artifacts must be tested by installing the package the same way a user would.
- CI must run install, build, typecheck, tests, and CLI smoke tests on Windows, macOS, and Linux.

## Dependency Policy

- Prefer dependencies that are pure JavaScript, actively maintained, and widely used.
- Every new runtime dependency must buy a clear capability.
- Do not add UI frameworks, prompt frameworks, or native modules until a command needs them.
- Avoid dependencies that make install noisy or fragile on Windows.

## Documentation Standard

- README examples must work on macOS and Windows unless explicitly labeled.
- Provide PowerShell examples for Windows setup.
- Clearly mark commands that mutate Teamwork data.
- Document config precedence in this order: command flags, environment variables, user config, defaults.
- Document how to uninstall and how to remove saved credentials.

## Test Standard

- Unit tests must cover config resolution, path handling, command parsing, payload construction, and error formatting.
- CLI smoke tests must run through the built binary, not only TypeScript source.
- Windows CI must test paths with spaces.
- Network tests should mock Teamwork responses by default. Live API tests must be opt-in.

## Definition Of Release-Ready

Before a release, the project must have:

- A clean install path for macOS and Windows.
- Passing CI on macOS, Windows, and Linux.
- No site-specific IDs, names or prefixes in the code. They belong in the settings file.
- Explicit timeout and safe error handling for every API request.
- Clear docs for install, configure, first command, troubleshooting, and uninstall.
- Tests for every command that mutates Teamwork data.
