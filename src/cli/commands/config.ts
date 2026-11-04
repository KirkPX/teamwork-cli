import pc from "picocolors";
import { getConfigPath } from "../../config.js";
import { loadSettings } from "../../settings.js";
import { reporter } from "../output.js";

type Opts = { json?: boolean };

export async function configPath(opts: Opts): Promise<void> {
  const path = getConfigPath();
  reporter(opts).result({ path }, path);
}

/** Print the validated settings. An invalid file fails here with the reason. */
export async function configShow(opts: Opts): Promise<void> {
  const settings = loadSettings();
  const body = JSON.stringify(settings, null, 2);
  reporter(opts).result({ path: getConfigPath(), settings }, `${pc.dim(getConfigPath())}\n${body}`);
}
