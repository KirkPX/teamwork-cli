# Sign In

How a user gets credentials into the CLI.

## The shape of it

`teamwork login` takes no arguments. It starts a small web server on loopback,
opens the page in the default browser, and waits for the user to paste their
Teamwork API token. The CLI verifies the token, works out which Teamwork site it
belongs to, and saves it to the OS keychain.

Bare `teamwork` runs the same flow when no credentials are stored, so a first
launch is a single word.

## Why a paste and not OAuth

Teamwork does not expose an API key programmatically. The key lives behind a
dialog that re-prompts for a password, so no automated grab is possible.

Teamwork does support OAuth2, and it works, but it gives no narrower access. It has
no scopes, so a token reaches what the signing-in user can reach, the same as that
user's API key. OAuth would add one shared app registration, which may need admin
approval and which an admin could revoke for every user at once. A personal key keeps
each user's access their own.

The costs are one copy-and-paste step, and no way in for a user whose admin has
disabled API access.

## Site discovery

The user never types a site name. `https://authenticate.teamwork.com/authenticate.json`
validates a bare API key and answers with the account it belongs to. The CLI
reads the site out of that answer.

The response shape is undocumented, so discovery scans the payload for the first
Teamwork URL rather than trusting a field name. When discovery cannot name a
site — an unreachable endpoint, or an on-premise host — the login page reveals a
site field and the flow continues.

Discovery proves the key is real. A second call to `/projects/api/v3/me.json`
proves it reaches that site's API, which is what every other command needs.

## No deep link to the token

Teamwork's API token sits in a dialog, not a page. The tab is
`<a href="javascript:void(0)">` bound to a Knockout click handler, the URL does
not change when the dialog opens, and the app router has no route for it (478
routes inspected; `/people/:userId/edit` and the legacy `/people/{id}/edit` both
redirect to the people list).

So the login page cannot link straight to the token, and says so rather than
letting the user hunt. Sign-in plus a security code would defeat such a link
anyway — it would only work for someone already authenticated, who does not need
it.

The steps the page gives: sign in → profile picture (bottom left, or top right on
older layouts) → Edit My Details → API & Mobile → Show your Token. The token is part
of the profile, so the steps are the same for a password, Google or single sign-on
account. A refused token gets a plain message with these steps again, never a bare
status code.

A half-finished sign-in never blocks `teamwork login`. A saved site with no key, or
a key with no site, starts a new sign-in. `--force` is needed only to replace a
sign-in that is complete.

## Fallbacks

- `teamwork login --paste` reads the token from the terminal without echoing it.
  Chosen automatically when there is no browser to hand off to.
- `TEAMWORK_SITE_NAME` and `TEAMWORK_API_KEY` skip login entirely, for CI.
- `teamwork logout`, and `teamwork login --force` to switch accounts.

## Security properties

- The server binds to `127.0.0.1` on an ephemeral port.
- The served page carries a one-time nonce, and `/callback` rejects any post
  without it, so another local process cannot inject a token.
- The page loads no external scripts.
- Request bodies are capped, and the whole flow times out.
- A rejected token leaves the server listening, so a bad paste can be corrected
  without restarting the CLI.
- The key reaches the keychain without passing through shell history.

## Install feedback

A missing shim is the one failure the CLI cannot report, because typing
`teamwork` never reaches our code. So `npm run setup` ends by running the check
through Node directly, and closes with a verdict:

```
Installed. Next: teamwork login
```

or the fix, printed in place. `doctor` distinguishes three states: reachable,
absent, and **shadowed** — another program of the same name earlier on PATH.
Shadowing is verified by resolving the shim back to this build (realpath on
Unix; reading the wrapper's contents on Windows, where npm writes `.cmd` files
rather than symlinks).
