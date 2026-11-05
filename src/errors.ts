export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly operation: string;
  readonly safeDetail: string;

  constructor(opts: {
    status: number;
    statusText: string;
    operation: string;
    safeDetail: string;
  }) {
    super(
      `${opts.operation} failed: ${opts.status} ${opts.statusText} — ${opts.safeDetail}`
    );
    this.name = "ApiError";
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.operation = opts.operation;
    this.safeDetail = opts.safeDetail;
  }
}

export class TimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(opts: { operation: string; timeoutMs: number }) {
    super(
      `${opts.operation} timed out after ${opts.timeoutMs}ms`
    );
    this.name = "TimeoutError";
    this.operation = opts.operation;
    this.timeoutMs = opts.timeoutMs;
  }
}

/**
 * The CLI is not set up correctly, or was invoked in a way it cannot act on.
 * `hint` is the next step, printed by the top-level handler.
 */
export class ConfigError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ConfigError";
    this.hint = hint;
  }
}

/**
 * A malformed invocation: a bad flag value, a missing required combination.
 *
 * A subclass of ConfigError, so anything matching on ConfigError still matches,
 * with a name that says what went wrong.
 */
export class UsageError extends ConfigError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = "UsageError";
  }
}

/**
 * Sign-in could not complete.
 */
export class LoginError extends ConfigError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = "LoginError";
  }
}

/**
 * The person pressed Ctrl-C at a prompt. The top-level handler exits 130, the
 * code a shell gives a command stopped by Ctrl-C.
 */
export class InterruptedError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "InterruptedError";
  }
}

export function redact(value: string, show = 4): string {
  if (value.length <= show + 4) return "****";
  return value.slice(0, show) + "****" + value.slice(-show);
}

export function safeErrorMessage(raw: string): string {
  return redactUrlCredentials(raw);
}

function redactUrlCredentials(msg: string): string {
  return msg.replace(
    /(?<=:\/{2})[^@]+@/g,
    "****@"
  );
}
