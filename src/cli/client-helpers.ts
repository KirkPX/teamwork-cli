import { TeamworkClient } from "../client.js";
import { resolveConfig } from "../config.js";
import { requireApiKey, requireSiteName } from "./guardrails.js";

export function createClient(): TeamworkClient {
  const { siteName, apiKey, timeoutMs } = resolveConfig();
  requireSiteName(siteName);
  requireApiKey(apiKey);
  return new TeamworkClient({
    siteName,
    // For tests and self-hosted proxies. Every request still goes only to this
    // one address.
    baseUrl: process.env.TEAMWORK_BASE_URL || undefined,
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
