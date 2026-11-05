import { readFile } from "node:fs/promises";
import { UsageError } from "../errors.js";

/**
 * Read a text file named by an option, as UTF-8. A failure names the option
 * and the file in plain words, not as a raw system error.
 */
export async function readOptionFile(option: string, file: string): Promise<string> {
  try {
    return await readFile(file, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason =
      code === "ENOENT" ? "the file does not exist"
      : code === "EISDIR" ? "it is a folder, not a file"
      : code === "EACCES" || code === "EPERM" ? "you do not have permission to read it"
      : (code ?? "unknown error");
    throw new UsageError(`${option} cannot read "${file}": ${reason}.`);
  }
}
