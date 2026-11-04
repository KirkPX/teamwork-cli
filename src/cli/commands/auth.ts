import { ConfigError } from "../../errors.js";
import pc from "picocolors";
import { getCredentialStore } from "../../auth.js";
import {
  getSiteName,
  setSiteName,
  clearSiteName,
} from "../../config.js";
import { reporter } from "../output.js";
import { storeLabel } from "./login.js";

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
  const siteName = getSiteName();
  const r = reporter(opts);

  if (!siteName) {
    r.result(
      { configured: false },
      pc.yellow("Not signed in.") + "\nRun `teamwork login`."
    );
    return;
  }

  const store = getCredentialStore();
  const apiKey = store.getApiKey(siteName);

  const preview = apiKey ? `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}` : null;

  r.result(
    {
      configured: true,
      siteName,
      apiKeySet: apiKey !== null,
      apiKeyPreview: preview,
    },
    [
      `${pc.green("OK")} Site: ${siteName}`,
      ...(preview
        ? [`${pc.green("OK")} API key: ${preview}`]
        : [
            pc.yellow("  API key: not stored in keyring"),
            "  Run `teamwork login`, or set TEAMWORK_API_KEY for automation.",
          ]),
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
    const store = getCredentialStore();
    const savedTo = store.setApiKey(siteName, opts.apiKey) ?? store.kind;

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
