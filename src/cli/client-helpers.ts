import { TeamworkClient } from "../client.js";
import { ConfigError } from "../errors.js";
import { resolveConfig } from "../config.js";
import { requireApiKey, requireSiteName } from "./guardrails.js";

export function createClient(): TeamworkClient {
  const { siteName, apiKey, timeoutMs } = resolveConfig();
  requireSiteName(siteName);
  requireApiKey(apiKey);
  return new TeamworkClient({
    siteName,
    baseUrl: testBaseUrl(process.env.TEAMWORK_BASE_URL),
    apiKey,
    timeoutMs,
    onRetry: reportRetry,
  });
}

function reportRetry(info: {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  status: number;
  operation: string;
}): void {
  const seconds = Math.ceil(info.delayMs / 1000);
  console.error(
    `Teamwork returned ${info.status} for ${info.operation}; retrying in ${seconds}s (${info.attempt + 1}/${info.maxRetries}).`
  );
}

/**
 * `TEAMWORK_BASE_URL` exists only so tests can send requests to a server on
 * this machine. Every request carries the API key, so any other address is
 * refused: the key goes only to the signed-in site or to this machine.
 */
export function testBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(
      `TEAMWORK_BASE_URL is not a valid address: "${value}".`,
      "Unset TEAMWORK_BASE_URL. It is only for tests, such as http://127.0.0.1:8080."
    );
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new ConfigError(
      `TEAMWORK_BASE_URL must point at this machine (127.0.0.1 or localhost), not ${url.host || value}.`,
      "Unset TEAMWORK_BASE_URL. Requests go to your Teamwork site without it."
    );
  }
  return url.origin;
}
