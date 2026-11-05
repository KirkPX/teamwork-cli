# Real Windows test

A person runs this test once before the first release, and again after a change to sign-in,
install or storage. It takes about 15 minutes. CI cannot show whether a browser opens, or
what a stranger sees.

Use a Windows 10 or 11 PC or virtual machine, in a normal (non-administrator) PowerShell
window. Follow only what the README says, as a stranger would. If a step needs knowledge the
README does not give, that is a failure.

1. **Install.** Follow the README's Windows section from the top, including installing Node
   if it says to.
2. **New terminal.** Open a new PowerShell window. Run `teamwork --version`. Note any
   script-block message, and check that the README's fix works.
3. **Doctor.** Run `teamwork doctor`. Every line reads correctly, and the settings path is
   under `%APPDATA%`.
4. **Sign in.** Run `teamwork login`. The browser opens, the page works, and the key is
   accepted. A wrong key can be corrected without restarting. Run
   `teamwork login --paste --force`: the key does not show as you type.
5. **Storage.** Open Credential Manager and find the entry. Confirm there is no
   `credentials.json` in `%APPDATA%\teamwork-cli`.
6. **Read.** Run `teamwork projects list` at the terminal, then pipe it:
   `teamwork projects list | Out-File out.json`. The file is valid JSON with no extra text,
   and non-English characters are intact.
7. **Paths.** Save `{}` as `body.json` in a folder with a space and a non-English character
   in its name, such as `C:\Temp\tw café`. Run
   `teamwork --read-only api /projects/api/v3/projects.json --method POST --data "@C:\Temp\tw café\body.json"`.
   It must refuse with a read-only message. A "file does not exist" message is a failure.
8. **Write safely.** Run `teamwork tasks bulk-update` with `--dry-run`: it lists what would
   change and changes nothing. Then run the same command with `--read-only`, which must refuse.
9. **Interrupt.** Press Ctrl-C at the `teamwork login --paste --force` prompt. The window
   stays usable, and typing shows normally.
10. **Remove.** Follow the README's uninstall section, including removing the saved key.
    Credential Manager and `%APPDATA%` no longer hold it.

## Results

Add one row per run. A failed run still gets a row, and a later passing row replaces it as
the current result.

| Date | Version | Windows | Node | Result | Problems |
|---|---|---|---|---|---|
