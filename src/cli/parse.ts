import { InvalidArgumentError } from "commander";

/**
 * Parsers for number options. Plain `Number` turns `abc` into NaN, which then
 * reads as "no filter" or reaches Teamwork as `null`. These reject it before
 * the command runs, and commander names the option in the message.
 */

/** A Teamwork ID: a whole number greater than 0. */
export function parseId(value: string): number {
  const n = parseWhole(value);
  if (n === 0) throw new InvalidArgumentError("Expected an ID greater than 0.");
  return n;
}

/** A count such as minutes: a whole number, 0 or more. */
export function parseCount(value: string): number {
  return parseWhole(value);
}

/** A percentage: a whole number from 0 to 100. */
export function parsePercent(value: string): number {
  const n = parseWhole(value);
  if (n > 100) throw new InvalidArgumentError("Expected a number from 0 to 100.");
  return n;
}

function parseWhole(value: string): number {
  const text = value.trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new InvalidArgumentError(`Expected a whole number, not "${value}".`);
  }
  return Number(text);
}

/**
 * A calendar date, typed as YYYY-MM-DD or YYYYMMDD. Returns YYYY-MM-DD; the
 * client turns it into the form each Teamwork endpoint takes. A date Teamwork
 * cannot read is ignored without an error, so an impossible date is refused here.
 */
export function parseDate(value: string): string {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value.trim());
  const [, y, m, d] = match ?? [];
  const date = match ? new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))) : null;
  if (!date || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    throw new InvalidArgumentError(`Expected a date as YYYY-MM-DD or YYYYMMDD, not "${value}".`);
  }
  return `${y}-${m}-${d}`;
}
