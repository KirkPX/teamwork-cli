import { createInterface, type Interface } from "node:readline";
import { ask } from "../cli/ask.js";

/**
 * Read a secret from the terminal without echoing it.
 *
 * The prompt is written to stderr so a piped `--json` run keeps stdout clean.
 */
export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped input: read it plainly. There is no terminal to echo to.
    return (await readAllStdin()).trim();
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  // readline has no built-in masking, so suppress its echo while the answer
  // is being typed. The prompt itself still needs to print.
  const muted = rl as Interface & {
    _writeToOutput?: (text: string) => void;
    output?: NodeJS.WritableStream;
  };
  let masking = false;
  muted._writeToOutput = (text: string) => {
    if (masking && !text.includes(question)) return;
    muted.output?.write(text);
  };

  try {
    const answer = ask(rl, question);
    masking = true;
    return (await answer).trim();
  } finally {
    // The answer's Enter, or the Ctrl-C, was not echoed: end the line.
    process.stderr.write("\n");
    rl.close();
  }
}

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return (await ask(rl, question)).trim();
  } finally {
    rl.close();
  }
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
