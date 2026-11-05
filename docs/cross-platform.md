# Cross-platform rules

`teamwork` works the same way on macOS, Windows and Linux. Each of the three counts
equally: a change that breaks one of them does not merge.

## The promise

| | Supported |
|---|---|
| Systems | macOS, Windows 10 and later, Linux |
| Processors | Intel/AMD and ARM. CI proves Intel/AMD and Apple ARM |
| Node | 20, 22, 24 |
| Windows shells | PowerShell and Windows Terminal. WSL, Git Bash and Homebrew are never required |

Commands, options and output are the same everywhere. Only file locations and sign-in
storage differ.

## Where things go

| | macOS | Windows | Linux |
|---|---|---|---|
| Settings | `$XDG_CONFIG_HOME/teamwork-cli/config.json`, or `~/.config/teamwork-cli/config.json` | `%APPDATA%\teamwork-cli\config.json` | Same as macOS |
| Key, normal | Keychain | Credential Manager | Secret Service, where one runs |
| Key, keychain closed | Private file, mode 600 (SSH sessions) | Private file. Modes do nothing on Windows, so it relies on the profile folder's permissions (rare) | Private file, mode 600 (servers with no Secret Service) |
| Key for automation | `TEAMWORK_API_KEY`, stores nothing | Same | Same |

`src/paths.ts` chooses the settings folder, and `src/auth.ts` chooses the key store.
`teamwork doctor` reports which store is in use, and a key save says where the key went.

## Rules

**No shell dependence.** Core behaviour does not use Bash, Zsh, PowerShell, `sed`, `awk`,
`grep`, `curl`, `open` or `osascript`. It uses Node's `fs`, `path`, `os`, `URL`, `fetch` and
`child_process`. Opening a browser calls a system tool (`src/login/browser.ts`). It checks
that the tool exists first, and prints the URL when it does not. On Windows, the title
argument to `start` is an empty argument, not the two characters `""`: a literal `""`
reaches `cmd` as a real title and swallows the URL.

**Paths.** Build every path with `path` APIs. Never assume `/` as the separator, or
that a home folder has a particular name or place: ask `os.homedir()`. File names are Unicode. Text is read and written as UTF-8. Do not assume a
file system is case-sensitive or case-insensitive, so never rely on two names that differ
only by case.

**Line endings.** `.gitattributes` holds `* text=auto eol=lf`, so a Windows checkout cannot
break the `#!/usr/bin/env node` line.

**Terminal.** Output reads well with no colour. Colour is decoration, never the only signal.
Output is UTF-8 and does not depend on a console's code page. Nothing animates when output is
not a terminal. Ctrl-C at a prompt exits with code 130 and takes the terminal out of raw
mode, so typing shows again (`src/cli/ask.ts`).

**Arguments.** PowerShell removes the double quotes inside an argument it passes to a
program, so JSON typed after an option can arrive broken. Every option that takes JSON also
accepts `@<path>` and `-` for standard input. Today that is `teamwork api --data`. The
README shows the PowerShell form.

**Install.** The README's Windows section covers three things: open a new terminal after
install, because the path changes; PowerShell's script block (`running scripts is disabled`),
with the `.cmd` form and the policy command; and `teamwork doctor`. `doctor` reports a
missing command and a shadowed command (another program answers to `teamwork`) separately,
and it understands npm's `.cmd` wrapper files.

**Native libraries.** `@napi-rs/keyring` is the only native library. It loads lazily, so a
platform with no build falls back to the private file instead of failing every command.

**Docs.** README examples work on all three systems, or are labelled by system. Windows
setup examples use PowerShell.

## Proof

| Level | What it proves | Where |
|---|---|---|
| Simulated | Logic for another system, such as the settings folder and the browser opener, run anywhere by passing the platform in | `tests/config.test.ts`, `tests/login.test.ts`, `tests/doctor.test.ts` |
| Real CI machine | Tests, the packaged install, `--version` and `doctor`, on all three systems | `.github/workflows/ci.yml` |
| Real Windows, by a person | The browser opens, Credential Manager saves the key, PowerShell behaves, and a stranger's steps work | [windows-test.md](windows-test.md) |

A simulated test is never proof for a real system. A release needs all three levels.

Every command that reads a file is tested with a path that holds spaces and non-English
characters (`tests/smoke.test.ts`, `tests/project-commands.test.ts`).
