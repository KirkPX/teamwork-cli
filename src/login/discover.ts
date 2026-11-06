import { TeamworkClient } from "../client.js";
import { ApiError, LoginError } from "../errors.js";

export { LoginError };

/** Where a person finds their token. The login page, `--paste` and the README give these steps. */
export const TOKEN_STEPS =
  "In Teamwork, click your profile picture (bottom left, or top right on older layouts) → Edit My Details → API & Mobile → Show your Token.";

/** The token lives in the profile, so the route is the same however a person signs in. */
export const SIGN_IN_NOTE =
  "This works however you sign in to Teamwork: password, Google or single sign-on. If you cannot see API & Mobile, ask your site administrator.";

// Teamwork validates a bare API key here and answers with the account the key
// belongs to. That is what lets `teamwork login` ask for a key and nothing
// else — the site name comes back with the answer.
const AUTHENTICATE_URL = "https://authenticate.teamwork.com/authenticate.json";

const TEAMWORK_HOST = /https?:\/\/([a-z0-9-]+)\.(?:teamwork|companyname)\.com/i;

export type VerifiedAccount = {
  siteName: string;
  userName: string | null;
  email: string | null;
};

/**
 * Turn a pasted API key into a verified account.
 *
 * `siteHint` is only needed when Teamwork's discovery endpoint cannot name the
 * site — an on-premise host, say. The happy path passes nothing.
 */
export async function verifyApiKey(
  apiKey: string,
  siteHint?: string,
  timeoutMs = 15_000
): Promise<VerifiedAccount> {
  const key = apiKey.trim();
  if (!key) {
    throw new LoginError("No API key entered.");
  }

  const siteName =
    normalizeSiteName(siteHint) ?? (await discoverSiteName(key, timeoutMs));

  if (!siteName) {
    throw new LoginError(
      "That key could not be matched to a Teamwork site.",
      "Enter your site name (the part before .teamwork.com) and try again."
    );
  }

  // Discovery proves the key is real. This proves it reaches the site's API,
  // which is the thing every other command depends on.
  const client = new TeamworkClient({ siteName, apiKey: key, timeoutMs });
  let person: Record<string, unknown>;
  try {
    const me = await client.me();
    person = extractPerson(me);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      throw new LoginError(
        `Teamwork refused that key for ${siteName}.teamwork.com.`,
        `Copy the token again. ${TOKEN_STEPS} If you use more than one Teamwork site, copy the token from this site.`
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new LoginError(
      `The key did not work against ${siteName}.teamwork.com.`,
      detail
    );
  }

  return {
    siteName,
    userName: buildName(person),
    email: stringField(person, "email") ?? stringField(person, "email-address"),
  };
}

async function discoverSiteName(
  apiKey: string,
  timeoutMs: number
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(AUTHENTICATE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${apiKey}:X`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Offline, or the endpoint is unreachable. Fall back to asking for a site
    // rather than failing the whole login.
    return null;
  }

  if (response.status === 401) {
    throw new LoginError(
      "Teamwork rejected that API key.",
      `Copy the whole token again: it is easy to miss part of it. ${TOKEN_STEPS}`
    );
  }

  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  const url = findTeamworkUrl(body);
  return url ? normalizeSiteName(url) : null;
}

/**
 * Teamwork's account payload is not a documented shape, so rather than bet on
 * a field name we look for the first Teamwork URL anywhere inside it.
 */
function findTeamworkUrl(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;

  if (typeof value === "string") {
    return TEAMWORK_HOST.test(value) ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTeamworkUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      const found = findTeamworkUrl(item, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/** Accepts a bare name, a host, or a full URL. Returns the subdomain. */
export function normalizeSiteName(input?: string | null): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  const match = trimmed.match(TEAMWORK_HOST);
  if (match) return match[1]!.toLowerCase();

  const bare = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.teamwork\.com$/i, "")
    .trim();

  return /^[a-z0-9-]+$/i.test(bare) ? bare.toLowerCase() : null;
}

function extractPerson(me: Record<string, unknown>): Record<string, unknown> {
  const person = me.person ?? me.people ?? me.user ?? me;
  if (Array.isArray(person)) {
    return (person[0] as Record<string, unknown>) ?? {};
  }
  return typeof person === "object" && person !== null
    ? (person as Record<string, unknown>)
    : {};
}

function buildName(person: Record<string, unknown>): string | null {
  const full = stringField(person, "fullName") ?? stringField(person, "name");
  if (full) return full;

  const first =
    stringField(person, "firstName") ?? stringField(person, "first-name");
  const last =
    stringField(person, "lastName") ?? stringField(person, "last-name");
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || null;
}

function stringField(
  source: Record<string, unknown>,
  key: string
): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
