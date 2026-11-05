import { describe, expect, it, vi } from "vitest";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { ask } from "../src/cli/ask.js";
import { InterruptedError } from "../src/errors.js";

// A stand-in terminal: readline puts a TTY input in raw mode, and must take it
// out again, or the shell shows nothing the person types after the CLI exits.
function fakeTerminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: vi.fn(),
  });
  const output = new PassThrough();
  const rl = createInterface({ input, output, terminal: true });
  return { input, rl };
}

describe("ask", () => {
  it("returns the typed answer", async () => {
    const { input, rl } = fakeTerminal();
    const answer = ask(rl, "Name? ");
    input.write("Ada\r");
    await expect(answer).resolves.toBe("Ada");
    rl.close();
  });

  it("Ctrl-C rejects and restores the terminal", async () => {
    const { input, rl } = fakeTerminal();
    const answer = ask(rl, "Token: ");
    expect(input.setRawMode).toHaveBeenLastCalledWith(true);
    input.write("\x03");
    await expect(answer).rejects.toBeInstanceOf(InterruptedError);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
