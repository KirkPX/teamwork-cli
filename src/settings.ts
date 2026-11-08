import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { PROJECT_FEATURES } from "./client.js";
import { ConfigError, UsageError, fileErrorReason } from "./errors.js";
import { settingsFilePath } from "./paths.js";

const presetSchema = z
  .strictObject({
    description: z.string().optional(),
    namePrefix: z.string().min(1).optional(),
    categoryId: z.number().int().positive().optional(),
    features: z
      .record(
        z.string().refine((name) => Object.hasOwn(PROJECT_FEATURES, name), {
          error: `must be one of: ${Object.keys(PROJECT_FEATURES).join(", ")}`,
        }),
        z.boolean()
      )
      .optional(),
  })
  .refine((p) => p.namePrefix || p.categoryId || p.features, {
    error: "must set at least one of namePrefix, categoryId or features",
  });

/**
 * The settings file. Unknown keys are refused: a misspelt `readonly` must stop
 * the command, because ignoring it would allow the writes it was meant to block.
 */
export const settingsSchema = z.strictObject({
  siteName: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+(\.teamwork\.com)?$/i, "must be the part before .teamwork.com, such as acme")
    .optional(),
  readOnly: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  projectPresets: z
    .record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase and hyphenated"), presetSchema)
    .optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type ProjectPreset = NonNullable<Settings["projectPresets"]>[string];

function parse(value: unknown): Settings {
  const result = settingsSchema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => {
      // A bad record key reports "Invalid key in record"; the reason is one level down.
      const inner = issue.code === "invalid_key" ? issue.issues[0]?.message : undefined;
      return `${issue.path.map(String).join(".") || "settings"}: ${inner ?? issue.message}`;
    })
    .join("; ");
  throw new ConfigError(`Invalid settings: ${detail}`, `Settings file: ${settingsFilePath()}`);
}

/** Read and validate the settings file. A missing file means no settings. */
export function loadSettings(): Settings {
  const path = settingsFilePath();
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(
      `Cannot read the settings file: ${fileErrorReason(error)}.`,
      `Settings file: ${path}. Run \`teamwork config path\` to see where it should be.`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError("The settings file is not valid JSON.", `Settings file: ${path}`);
  }
  return parse(value);
}

/**
 * Merge a change into the settings file. The new file is written beside the old
 * one and renamed over it, so a crash cannot leave half a file. A patch value of
 * undefined removes that key.
 */
export function updateSettings(patch: Partial<Settings>): void {
  const merged: Record<string, unknown> = { ...loadSettings(), ...patch };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  writeSettings(merged);
}

function writeSettings(value: Record<string, unknown>): void {
  const next = parse(value);
  const path = settingsFilePath();
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8");
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw new ConfigError(
      `Cannot save the settings file: ${fileErrorReason(error)}.`,
      `Settings file: ${path}. Check the folder exists and you can write to it, or point TEAMWORK_CLI_CONFIG_FILE at another file.`
    );
  }
}

type Leaf = "string" | "boolean" | "integer";

/**
 * What a dotted setting name holds, or null when no such setting exists.
 * `projectPresets.<preset>.features.<feature>` reaches inside a preset.
 */
function leafType(parts: string[]): Leaf | null {
  const [top, preset, field, feature] = parts;
  if (parts.length === 1) {
    if (top === "siteName") return "string";
    if (top === "readOnly") return "boolean";
    if (top === "timeoutMs") return "integer";
    return null;
  }
  if (top !== "projectPresets" || !preset) return null;
  if (parts.length === 3) {
    if (field === "description" || field === "namePrefix") return "string";
    if (field === "categoryId") return "integer";
    return null;
  }
  if (parts.length === 4 && field === "features" && feature) return "boolean";
  return null;
}

const SETTING_NAMES =
  "siteName, readOnly, timeoutMs, projectPresets.<preset>.description, .namePrefix, .categoryId or .features.<feature>";

// A preset or feature name is whatever was typed, and these names would reach
// JavaScript's own objects instead of the settings file.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function settingPath(name: string): { parts: string[]; type: Leaf } {
  const parts = name.split(".");
  const type = parts.every((p) => p && !UNSAFE_KEYS.has(p)) ? leafType(parts) : null;
  if (!type) {
    throw new UsageError(`There is no setting called "${name}".`, `Settings: ${SETTING_NAMES}.`);
  }
  return { parts, type };
}

function coerce(name: string, type: Leaf, raw: string): string | boolean | number {
  if (type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new UsageError(`${name} takes true or false, not "${raw}".`);
  }
  if (type === "integer") {
    if (/^\d+$/.test(raw)) return Number(raw);
    throw new UsageError(`${name} takes a whole number, not "${raw}".`);
  }
  return raw;
}

/**
 * Set one value in the settings file, by its dotted name. The whole file is
 * checked before it is written, so a bad value never reaches the disk.
 */
export function setSetting(name: string, raw: string): Settings {
  const { parts, type } = settingPath(name);
  const value = coerce(name, type, raw);
  const settings = structuredClone(loadSettings()) as Record<string, unknown>;
  let node = settings;
  for (const part of parts.slice(0, -1)) {
    const child = node[part];
    node[part] = typeof child === "object" && child !== null ? child : {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
  writeSettings(settings);
  return loadSettings();
}

/**
 * Remove one value from the settings file. A preset can be removed whole with
 * `projectPresets.<preset>`. Returns false when the value was not set.
 */
export function unsetSetting(name: string): boolean {
  const parts = name.split(".");
  const isPreset =
    parts.length === 2 &&
    parts[0] === "projectPresets" &&
    Boolean(parts[1]) &&
    !UNSAFE_KEYS.has(parts[1]!);
  if (!isPreset) settingPath(name);
  const settings = structuredClone(loadSettings()) as Record<string, unknown>;
  const chain: Record<string, unknown>[] = [settings];
  for (const part of parts.slice(0, -1)) {
    const child = chain[chain.length - 1]![part];
    if (typeof child !== "object" || child === null) return false;
    chain.push(child as Record<string, unknown>);
  }
  const last = parts[parts.length - 1]!;
  if (!Object.hasOwn(chain[chain.length - 1]!, last)) return false;
  delete chain[chain.length - 1]![last];
  // Drop the objects the removal left empty, such as an empty features list.
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]!).length > 0) break;
    delete chain[i - 1]![parts[i - 1]!];
  }
  writeSettings(settings);
  return true;
}
