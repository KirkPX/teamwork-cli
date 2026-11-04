import { UsageError } from "../errors.js";

/**
 * Parse a comma-separated list of numeric IDs, rejecting anything that is not
 * one.
 *
 * `parseInt` is the wrong tool here: it returns NaN for an empty segment and
 * truncates, so `"1,,3"` would become `[1, NaN, 3]` and `"3.9"` would become `3`.
 *
 * `/^\d+$/` is deliberately stricter than a finite-number check: it also
 * rejects `"-1"`, `"3.9"` and `"1e3"`. A trailing comma is an error, not something
 * to drop quietly.
 */
export function resolveIdList(input: string, label: string): number[] {
  const ids = input.split(",").map((part) => {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new UsageError(
        `Invalid ${label} "${trimmed}" in "${input}". Expected comma-separated numeric IDs.`
      );
    }
    return Number(trimmed);
  });

  if (ids.length === 0) throw new UsageError(`No ${label} provided.`);
  return ids;
}

/** The same check for an already-split list, e.g. commander's `<ids...>`. */
export function resolveIds(parts: string[], label: string): number[] {
  return resolveIdList(parts.join(","), label);
}

export function resolveProjectInput(input: string): number | null {
  const trimmed = input.trim();

  if (trimmed.startsWith("http")) {
    const id = extractProjectIdFromUrl(trimmed);
    if (id) return id;
    return null;
  }

  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  return null;
}

function extractProjectIdFromUrl(url: string): number | null {
  const patterns = [/\/projects\/(\d+)/, /projectId=(\d+)/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return parseInt(match[1]!, 10);
  }
  return null;
}
