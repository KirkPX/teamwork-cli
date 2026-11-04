import { createRequire } from "node:module";
import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pc from "picocolors";
import { credentialsFilePath, getCredentialStore, getCredentialStoreInfo } from "../../auth.js";
import { getConfigPath, getSiteName } from "../../config.js";
import { reporter } from "../output.js";

type CheckResult = {
  name: string;
  ok: boolean;
  value: string;
  fix?: string[];
};

export async function doctorCommand(
  opts: { install?: boolean; json?: boolean } = {}
): Promise<void> {
  const pathCheck = commandOnPathCheck();
  const checks: CheckResult[] = [
    { name: "Node.js", ok: true, value: process.version },
    { name: "Platform", ok: true, value: `${process.platform}/${process.arch}` },
    pathCheck,
  ];

  let keyringOk = false;
  try {
    const require = createRequire(import.meta.url);
    require.resolve("@napi-rs/keyring");
    keyringOk = true;
  } catch {
    // not available
  }

  // Doctor exists to diagnose problems, so a broken settings file is a result
  // here and not a crash.
  let siteName: string | undefined;
  try {
    siteName = getSiteName();
    checks.push({ name: "Config file", ok: true, value: getConfigPath() });
  } catch (error) {
    siteName = process.env.TEAMWORK_SITE_NAME || undefined;
    checks.push({
      name: "Config file",
      ok: false,
      value: getConfigPath(),
      fix: [(error as Error).message],
    });
  }
  checks.push({
    name: "Site",
    ok: Boolean(siteName),
    value: siteName ? `${siteName}.teamwork.com` : "not set — run `teamwork login`",
  });
  checks.push({
    name: "API key",
    // Never the key itself, only whether one is reachable.
    ok: hasApiKey(siteName),
    value: hasApiKey(siteName)
      ? "present"
      : "not found — run `teamwork login`, or set TEAMWORK_API_KEY",
  });

  const credentialStore = getCredentialStoreInfo();

  checks.push({
    name: "Keyring",
    ok: credentialStore.persistent,
    value:
      credentialStore.kind === "file"
        ? `unavailable (credentials persist in ${credentialsFilePath()})`
        : keyringOk && credentialStore.persistent
          ? `available (credentials persist in OS keychain, or ${credentialsFilePath()} where the keychain is closed, as over SSH)`
          : "unavailable (credentials do not persist; use TEAMWORK_API_KEY for automation)",
  });

  const r = reporter(opts);
  const pretty = checks
    .flatMap((check) => [
      `${check.ok ? pc.green("OK") : pc.yellow("WARN")} ${check.name}: ${check.value}`,
      ...(check.fix ?? []).map((line) => `     ${pc.dim(line)}`),
    ])
    .join("\n");

  r.result({ ok: checks.every((c) => c.ok), checks }, pretty);

  // The closing verdict for `npm run setup` goes to stderr: it is a message
  // about the install, not part of doctor's result, so it must not land in a
  // pipe. It still shows in a terminal, in both formats.
  if (opts.install) {
    if (pathCheck.ok) {
      r.warn("\n" + pc.green("Installed.") + " Next: " + pc.cyan("teamwork login"));
    } else {
      r.warn(
        "\n" +
          pc.yellow("Almost there — the `teamwork` command is not reachable yet.") +
          "\nDo this, then run " +
          pc.cyan("teamwork login") +
          ":\n" +
          (pathCheck.fix ?? []).map((line) => `  ${line}`).join("\n")
      );
    }
  }
}

/**
 * Is `teamwork` actually runnable by name?
 *
 * This is the one failure a user cannot be told about by the CLI itself — if
 * the shim is missing, typing `teamwork` prints a shell error and nothing here
 * ever runs. So `npm run doctor` calls this through Node directly, which works
 * before the shim resolves.
 */
export function commandOnPathCheck(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  // argv[1] is the entry script, which is what a shim symlinks to. The module
  // path is not usable here: the bundler code-splits, so import.meta.url
  // points at a chunk that no shim ever references.
  ownEntry: string = process.argv[1] ?? fileURLToPath(import.meta.url)
): CheckResult {
  const found = findCommandOnPath("teamwork", env, platform);

  if (!found) {
    return {
      name: "teamwork on PATH",
      ok: false,
      value: "not found — the `teamwork` command will not be recognised yet",
      fix:
        platform === "win32"
          ? [
              "`npm link` writes its shims to %APPDATA%\\npm.",
              "Open a NEW terminal — an existing one keeps the old PATH.",
              "Still missing? Check that directory is on your PATH:",
              "  npm config get prefix",
              "  $env:PATH -split ';' | Select-String 'npm'",
            ]
          : [
              "Run `npm link` in the repo, then open a new terminal.",
              "Still missing? Check npm's bin directory is on your PATH:",
              "  npm config get prefix    # binaries land in <prefix>/bin",
            ],
    };
  }

  // Finding *a* `teamwork` is not enough. Another tool of the same name
  // earlier on PATH wins, and the user gets its errors while believing they
  // are running this one.
  if (!pointsAtUs(found, ownEntry, platform)) {
    return {
      name: "teamwork on PATH",
      ok: false,
      value: `shadowed — \`teamwork\` runs ${found}, which is not this CLI`,
      fix: [
        "Another program of the same name comes first on your PATH.",
        "If you already fixed your PATH, open a NEW terminal — this one",
        "still has the PATH it started with.",
        "Otherwise put npm's bin directory ahead of the other program.",
        `This CLI lives at ${ownEntry}`,
      ],
    };
  }

  return { name: "teamwork on PATH", ok: true, value: found };
}

/** Does the shim on PATH actually lead back to this build? */
function pointsAtUs(
  found: string,
  ownEntry: string,
  platform: NodeJS.Platform
): boolean {
  try {
    if (realpathSync(found) === realpathSync(ownEntry)) return true;
  } catch {
    // fall through to the Windows shim check
  }

  // npm writes .cmd/.ps1 wrapper scripts on Windows rather than symlinks, so
  // there is no path to compare — read the wrapper and look for the package.
  if (platform === "win32") {
    try {
      return readFileSync(found, "utf-8").includes("teamwork-cli");
    } catch {
      return false;
    }
  }

  return false;
}

function findCommandOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string | null {
  // Windows resolves a bare name through PATHEXT, and npm writes several
  // shims. Any one of them makes the command work.
  const candidates =
    platform === "win32" ? [`${name}.cmd`, `${name}.ps1`, `${name}.exe`, name] : [name];

  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      try {
        accessSync(full, platform === "win32" ? constants.F_OK : constants.X_OK);
        return full;
      } catch {
        // keep looking
      }
    }
  }

  return null;
}

/** True when a key is reachable, without ever revealing it. */
function hasApiKey(siteName: string | undefined): boolean {
  if (process.env.TEAMWORK_API_KEY) return true;
  if (!siteName) return false;
  try {
    return getCredentialStore().getApiKey(siteName) !== null;
  } catch {
    return false;
  }
}
