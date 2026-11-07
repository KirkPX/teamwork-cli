import { configDir } from "./paths.js";
import { ConfigError, fileErrorReason } from "./errors.js";
import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const SERVICE = "teamwork-cli";
const require = createRequire(import.meta.url);

export interface CredentialStore {
  readonly kind: "keyring" | "file" | "memory";
  readonly persistent: boolean;
  getApiKey(siteName: string): string | null;
  /** Returns where the key went, which can differ from `kind` for the chained store. */
  setApiKey(siteName: string, apiKey: string): CredentialStore["kind"] | void;
  deleteApiKey(siteName: string): void;
}

function accountKey(siteName: string): string {
  return `apiKey:${siteName}`;
}

class KeyringCredentialStore implements CredentialStore {
  readonly kind = "keyring" as const;
  readonly persistent = true;
  private Entry: typeof import("@napi-rs/keyring").Entry;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.Entry = require("@napi-rs/keyring").Entry;
  }

  private entry(siteName: string) {
    return new this.Entry(SERVICE, accountKey(siteName));
  }

  getApiKey(siteName: string): string | null {
    return this.entry(siteName).getPassword();
  }

  setApiKey(siteName: string, apiKey: string): void {
    this.entry(siteName).setPassword(apiKey);
  }

  deleteApiKey(siteName: string): boolean {
    return this.entry(siteName).deletePassword();
  }
}

/**
 * A private file for the key, readable only by its owner.
 *
 * The keychain is closed to SSH sessions on macOS: reads come back empty and
 * writes fail with "User interaction is not allowed". Without this file, a
 * session on a headless Mac could never sign in.
 *
 * On Windows the mode bits below have no effect. There the file relies on the
 * permissions of the user's profile folder, and Credential Manager is normally
 * available, so the file is rarely used.
 */
export function credentialsFilePath(): string {
  return (
    process.env.TEAMWORK_CLI_CREDENTIALS_FILE ||
    join(configDir(), "credentials.json")
  );
}

class FileCredentialStore implements CredentialStore {
  readonly kind = "file" as const;
  readonly persistent = true;

  get path(): string {
    return credentialsFilePath();
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  /**
   * A read for a lookup treats a damaged file as empty. A read before a write
   * is strict: writing over a damaged file would drop the keys for other sites.
   */
  private read(strict = false): Record<string, string> {
    if (!this.exists()) return {};
    try {
      const data = JSON.parse(readFileSync(this.path, "utf-8"));
      if (data && typeof data === "object" && !Array.isArray(data)) return data;
    } catch (error) {
      if (strict && !(error instanceof SyntaxError)) {
        throw new ConfigError(`Cannot read the credentials file: ${fileErrorReason(error)}.`, `Credentials file: ${this.path}`);
      }
    }
    if (!strict) return {};
    throw new ConfigError(
      "The credentials file is damaged, so the CLI will not write over the keys in it.",
      `Move or delete ${this.path}, then run \`teamwork login\`.`
    );
  }

  private write(data: Record<string, string>): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.path);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw new ConfigError(
        `Cannot save the credentials file: ${fileErrorReason(error)}.`,
        `Credentials file: ${this.path}. Check you can write to that folder, or set TEAMWORK_API_KEY instead.`
      );
    }
  }

  getApiKey(siteName: string): string | null {
    const val = this.read()[accountKey(siteName)];
    return typeof val === "string" && val.length > 0 ? val : null;
  }

  setApiKey(siteName: string, apiKey: string): "file" {
    this.write({ ...this.read(true), [accountKey(siteName)]: apiKey });
    return "file";
  }

  deleteApiKey(siteName: string): void {
    const data = this.read(true);
    delete data[accountKey(siteName)];
    if (Object.keys(data).length === 0) rmSync(this.path, { force: true });
    else this.write(data);
  }
}

/**
 * The keychain first, the private file when the keychain cannot be used.
 *
 * A write goes to the keychain and is read back, because a blocked keychain
 * can accept a write silently and then return nothing. When that fails, the
 * key goes to the file. When a file already exists, it is updated too, so a
 * new key saved from the desktop does not leave SSH sessions on the old one.
 */
class KeyringWithFileFallback implements CredentialStore {
  readonly kind = "keyring" as const;
  readonly persistent = true;

  constructor(
    private readonly keyring: KeyringCredentialStore,
    private readonly file: FileCredentialStore
  ) {}

  getApiKey(siteName: string): string | null {
    let fromKeyring: string | null = null;
    try {
      fromKeyring = this.keyring.getApiKey(siteName);
    } catch {
      fromKeyring = null;
    }
    return fromKeyring ?? this.file.getApiKey(siteName);
  }

  setApiKey(siteName: string, apiKey: string): "keyring" | "file" {
    let inKeyring = false;
    try {
      this.keyring.setApiKey(siteName, apiKey);
      inKeyring = this.keyring.getApiKey(siteName) === apiKey;
    } catch {
      inKeyring = false;
    }
    if (!inKeyring || this.file.exists()) this.file.setApiKey(siteName, apiKey);
    return inKeyring ? "keyring" : "file";
  }

  deleteApiKey(siteName: string): void {
    try {
      this.keyring.deleteApiKey(siteName);
    } catch {
      // A blocked keychain cannot be cleared from here; the file still is.
    }
    this.file.deleteApiKey(siteName);
  }
}

class MemoryCredentialStore implements CredentialStore {
  readonly kind = "memory" as const;
  readonly persistent = false;
  private store = new Map<string, string>();

  getApiKey(siteName: string): string | null {
    return this.store.get(accountKey(siteName)) ?? null;
  }

  setApiKey(siteName: string, apiKey: string): void {
    this.store.set(accountKey(siteName), apiKey);
  }

  deleteApiKey(siteName: string): void {
    this.store.delete(accountKey(siteName));
  }
}

let cachedStore: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (cachedStore) return cachedStore;

  if (process.env.TEAMWORK_CLI_CREDENTIAL_STORE === "memory") {
    cachedStore = new MemoryCredentialStore();
    return cachedStore;
  }

  if (process.env.TEAMWORK_CLI_CREDENTIAL_STORE === "file") {
    cachedStore = new FileCredentialStore();
    return cachedStore;
  }

  try {
    require.resolve("@napi-rs/keyring");
    const keyring = new KeyringCredentialStore();
    keyring.getApiKey("__teamwork_cli_probe__");
    cachedStore = new KeyringWithFileFallback(keyring, new FileCredentialStore());
  } catch {
    cachedStore = new FileCredentialStore();
  }

  return cachedStore;
}

export function getCredentialStoreInfo(): {
  kind: CredentialStore["kind"];
  persistent: boolean;
} {
  const store = getCredentialStore();
  return { kind: store.kind, persistent: store.persistent };
}

export function resetCredentialStore(): void {
  cachedStore = null;
}
