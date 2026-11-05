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
