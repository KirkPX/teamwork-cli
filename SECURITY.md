# Security policy

Report a vulnerability privately through
[GitHub's security advisory form](https://github.com/KirkPX/teamwork-cli/security/advisories/new).
Do not open a public issue. Only the latest release is supported.

## How the CLI handles your API key

- `teamwork login` saves the key to the OS keychain.
- Where the keychain is closed, such as over SSH on macOS, the key goes to a
  credentials file in the settings folder. On macOS and Linux only you can read
  that file (mode 600). On Windows it relies on your profile folder's permissions.
- `TEAMWORK_API_KEY` takes the key from the environment and stores nothing.
- Error messages and logs redact the key.
- The sign-in page listens on `127.0.0.1` only, and accepts a token only with a
  one-time value that it issues itself.

The settings file never holds a key.
