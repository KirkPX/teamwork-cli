import { getCredentialStore } from "./auth.js";
import { settingsFilePath } from "./paths.js";
import { loadSettings, updateSettings } from "./settings.js";

export type ResolveOptions = {
  siteName?: string;
  apiKey?: string;
};

export type ResolvedConfig = {
  siteName: string;
  apiKey: string | null;
  timeoutMs?: number;
};

/** The single precedence chain: flags > env > settings file / keychain > default. */
export function resolveConfig(opts: ResolveOptions = {}): ResolvedConfig {
  const settings = loadSettings();
  const siteName = opts.siteName || env("TEAMWORK_SITE_NAME") || settings.siteName;
  const apiKey =
    opts.apiKey ||
    env("TEAMWORK_API_KEY") ||
    (siteName ? getCredentialStore().getApiKey(siteName) : null) ||
    null;

  return { siteName: siteName ?? "", apiKey, timeoutMs: settings.timeoutMs };
}

export function getSiteName(): string | undefined {
  return env("TEAMWORK_SITE_NAME") || loadSettings().siteName;
}

export function setSiteName(siteName: string): void {
  updateSettings({ siteName });
}

export function clearSiteName(): void {
  updateSettings({ siteName: undefined });
}

/** Where the settings file lives. `doctor` and `config path` print it. */
export function getConfigPath(): string {
  return settingsFilePath();
}

function env(name: string): string | undefined {
  const val = process.env[name];
  return val && val.length > 0 ? val : undefined;
}
