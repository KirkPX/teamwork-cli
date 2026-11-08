import { ConfigError, UsageError } from "../../errors.js";
import pc from "picocolors";
import { getCredentialStore, getCredentialStoreInfo, storeLabel } from "../../auth.js";
import {
  getSiteName,
  resolveConfig,
  setSiteName,
  clearSiteName,
} from "../../config.js";
import { reporter } from "../output.js";

export type AuthOpts = {
  json?: boolean;
  status?: boolean;
  login?: boolean;
  logout?: boolean;
  site?: string;
  apiKey?: string;
};

/**
 * Dispatch `teamwork auth`.
 *
 * `--status` is checked first, so `teamwork auth --status --site foo` reports and
 * writes nothing. Explicit intent wins.
 *
 * Lives here rather than inline in index.ts so it can be tested without
 * spawning the binary and mutating a real config file.
 */
export async function authCommand(opts: AuthOpts): Promise<void> {
  if (opts.status) return await authStatusCommand(opts);
  if (opts.logout) return await authLogoutCommand(opts);
  if (opts.login || opts.site || opts.apiKey) return await authLoginCommand(opts);
  return await authStatusCommand(opts);
}

type AuthStatusOpts = {
  json?: boolean;
};

export async function authStatusCommand(
  opts: AuthStatusOpts
): Promise<void> {
  const r = reporter(opts);
  // The same order every command uses: environment first, then the saved key.
  const { siteName, apiKey } = resolveConfig();
  const fromEnv = Boolean(process.env.TEAMWORK_API_KEY);
  const store = getCredentialStoreInfo();

  if (!siteName) {
    r.result(
      { configured: false, credentialStore: store.kind, persistent: store.persistent },
      pc.yellow("Not signed in.") + "\nRun `teamwork login`."
    );
    return;
  }

  const preview = apiKey ? `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}` : null;
  const source = !apiKey ? null : fromEnv ? "environment" : "saved";

  r.result(
    {
      configured: true,
      siteName,
      apiKeySet: apiKey !== null,
      apiKeyPreview: preview,
      apiKeySource: source,
      credentialStore: store.kind,
      persistent: store.persistent,
    },
    [
      `${pc.green("OK")} Site: ${siteName}`,
      ...(preview
        ? [
            `${pc.green("OK")} API key: ${preview} (${
              source === "environment" ? "from TEAMWORK_API_KEY" : "saved"
            })`,
          ]
        : [
            pc.yellow("  API key: none saved for this site"),
            "  Run `teamwork login`, or set TEAMWORK_API_KEY for automation.",
          ]),
      `   Saved keys go to your ${storeLabel(store.kind)}${store.persistent ? "" : ", which is lost when the command ends"}.`,
    ].join("\n")
  );
}

type AuthLoginOpts = {
  site?: string;
  apiKey?: string;
  json?: boolean;
};

export async function authLoginCommand(opts: AuthLoginOpts): Promise<void> {
  const r = reporter(opts);

  if (opts.site) {
    setSiteName(opts.site);
  }

  const siteName = getSiteName();
  if (!siteName) {
    throw new ConfigError(
      "No site name.",
      "Run `teamwork login`, or pass --site for automation."
    );
  }

  if (opts.apiKey) {
    const apiKey = opts.apiKey === "-" ? await readKeyFromStdin() : opts.apiKey;
    const store = getCredentialStore();
    const savedTo = store.setApiKey(siteName, apiKey) ?? store.kind;

    if (!store.persistent) {
      r.warn(
        pc.yellow(
          "Warning: keyring storage is unavailable, so this API key will not persist after the process exits. Use TEAMWORK_API_KEY for automation."
        )
      );
    }
    r.result(
      {
        stored: true,
        siteName,
        credentialStore: savedTo,
        persistent: store.persistent,
      },
      pc.green(`Stored API key for ${siteName} in your ${storeLabel(savedTo)}`)
    );
  } else {
    r.result(
      { stored: false, siteName, hint: "set TEAMWORK_API_KEY or pass --api-key" },
      `Site set to ${pc.green(siteName)}\nNow provide an API key. Easiest: ` +
        pc.cyan("teamwork login")
    );
  }
}

type AuthLogoutOpts = {
  json?: boolean;
};

export async function authLogoutCommand(opts: AuthLogoutOpts): Promise<void> {
  const r = reporter(opts);
  const siteName = getSiteName();

  if (!siteName) {
    r.result({ cleared: false }, pc.dim("Nothing to clear."));
    return;
  }

  const store = getCredentialStore();
  store.deleteApiKey(siteName);
  clearSiteName();

  r.result({ cleared: true, siteName }, pc.green(`Cleared credentials for ${siteName}`));
}

/**
 * `--api-key -` reads the key from standard input, so it stays out of shell
 * history and the process list.
 */
async function readKeyFromStdin(stdin: NodeJS.ReadStream = process.stdin): Promise<string> {
  if (stdin.isTTY) {
    throw new UsageError(
      "--api-key - reads the key from standard input, but nothing is piped in.",
      "Pipe the key in, or run `teamwork login`, which asks for it without showing it."
    );
  }
  let text = "";
  stdin.setEncoding("utf-8");
  for await (const chunk of stdin) text += chunk;
  const key = text.trim();
  if (!key) throw new UsageError("--api-key - read nothing from standard input.");
  return key;
}
