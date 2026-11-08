import pc from "picocolors";
import { credentialsFilePath, getCredentialStore, storeLabel, type StoreKind } from "../../auth.js";
import { getSiteName, setSiteName, clearSiteName } from "../../config.js";
import { LoginError, SIGN_IN_NOTE, TOKEN_STEPS, verifyApiKey, type VerifiedAccount } from "../../login/discover.js";
import { runBrowserLogin } from "../../login/server.js";
import { promptSecret, promptLine } from "../../login/prompt.js";
import { reporter } from "../output.js";

export type LoginOptions = {
  paste?: boolean;
  force?: boolean;
  json?: boolean;
};

export async function loginCommand(opts: LoginOptions = {}): Promise<void> {
  const r = reporter(opts);

  const existing = currentAccount();
  if (existing && !opts.force) {
    r.result(
      { loggedIn: true, siteName: existing.siteName, changed: false },
      `Already signed in to ${pc.green(`${existing.siteName}.teamwork.com`)}.\n` +
        pc.dim("Run `teamwork login --force` to sign in to a different account.")
    );
    return;
  }

  const account = opts.paste || !canUseBrowser()
    ? await pasteLogin()
    : await browserLogin();

  const store = getCredentialStore();

  if (!store.persistent) {
    r.warn(
      pc.yellow(
        "Warning: no OS keychain is available here, so this key will not survive the process exiting. Set TEAMWORK_API_KEY for automation."
      )
    );
  }

  const who = account.userName ?? account.email ?? "your account";
  r.result(
    {
      loggedIn: true,
      siteName: account.siteName,
      userName: account.userName,
      email: account.email,
      credentialStore: savedTo ?? store.kind,
      persistent: store.persistent,
    },
    `${pc.green("Signed in")} as ${who} on ${account.siteName}.teamwork.com\n` +
      pc.dim(`Key saved to your ${storeLabel(savedTo ?? store.kind)}.`) +
      "\n\nTry it: " +
      pc.cyan("teamwork projects list")
  );
}

export async function logoutCommand(opts: { json?: boolean } = {}): Promise<void> {
  const r = reporter(opts);
  const siteName = getSiteName();

  if (!siteName) {
    r.result({ cleared: false }, pc.dim("Not signed in — nothing to clear."));
    return;
  }

  getCredentialStore().deleteApiKey(siteName);
  clearSiteName();

  r.result({ cleared: true, siteName }, pc.green(`Signed out of ${siteName}.teamwork.com`));
}

/** True when a site and a usable key are both already on hand. */
export function isConfigured(): boolean {
  return currentAccount() !== null;
}

function currentAccount(): { siteName: string } | null {
  const siteName = getSiteName();
  if (!siteName) return null;

  if (process.env.TEAMWORK_API_KEY) return { siteName };

  const stored = getCredentialStore().getApiKey(siteName);
  return stored ? { siteName } : null;
}

async function browserLogin(): Promise<VerifiedAccount> {
  console.error("Opening a page to collect your Teamwork API token...");
  return await runBrowserLogin({
    siteName: getSiteName(),
    accept: async (apiKey, siteHint) => {
      const account = await verifyApiKey(apiKey, siteHint);
      persist(account.siteName, apiKey);
      return account;
    },
  });
}

async function pasteLogin(): Promise<VerifiedAccount> {
  console.error(TOKEN_STEPS);
  console.error(SIGN_IN_NOTE);
  console.error("");

  const apiKey = await promptSecret("Paste your Teamwork API token: ");
  if (!apiKey) {
    throw new LoginError("No token entered.");
  }

  try {
    const account = await verifyApiKey(apiKey);
    persist(account.siteName, apiKey);
    return account;
  } catch (error) {
    // Only the site is missing, so ask for it rather than restarting.
    if (error instanceof LoginError && /site/i.test(error.message)) {
      const siteName = await promptLine("Site name (the part before .teamwork.com): ");
      const account = await verifyApiKey(apiKey, siteName);
      persist(account.siteName, apiKey);
      return account;
    }
    throw error;
  }
}

// Where the last key went. The chained store picks the keychain or the file
// at write time, so the store's own kind cannot answer this.
let savedTo: StoreKind | undefined;

function persist(siteName: string, apiKey: string): void {
  setSiteName(siteName);
  savedTo = getCredentialStore().setApiKey(siteName, apiKey) ?? undefined;
}

function canUseBrowser(): boolean {
  // No terminal to return to, or an explicitly headless environment: the
  // browser hand-off has nowhere to land.
  if (process.env.TEAMWORK_CLI_NO_BROWSER) return false;
  return process.stdout.isTTY === true;
}

