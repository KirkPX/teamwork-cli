import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import pc from "picocolors";
import { openBrowser } from "./browser.js";
import { loginPage } from "./page.js";
import { LoginError, type VerifiedAccount } from "./discover.js";

const MAX_BODY_BYTES = 8 * 1024;

export type BrowserLoginOptions = {
  siteName?: string;
  /** Verifies the pasted key and persists it. Throws to reject the paste. */
  accept: (apiKey: string, siteHint?: string) => Promise<VerifiedAccount>;
  timeoutMs?: number;
};

/**
 * Serve a one-page login on loopback, open it, and wait for a pasted token.
 *
 * The page is bound to 127.0.0.1 on an ephemeral port and carries a one-time
 * nonce, so another local process cannot post a token into this session.
 */
export async function runBrowserLogin(
  opts: BrowserLoginOptions
): Promise<VerifiedAccount> {
  const nonce = randomUUID();
  const html = loginPage({ nonce, siteName: opts.siteName });
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return await new Promise<VerifiedAccount>((resolve, reject) => {
    let settled = false;

    const finish = (
      outcome: { ok: true; account: VerifiedAccount } | { ok: false; error: Error }
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      server.close();
      // server.close() stops new connections but leaves established ones, and
      // a live socket keeps Node running. Browsers hold theirs open under
      // keep-alive, so drop them explicitly rather than trusting the peer to
      // hang up. The delay lets the final response flush first.
      server.closeIdleConnections();
      const drain = setTimeout(() => server.closeAllConnections(), 300);
      drain.unref();

      if (outcome.ok) resolve(outcome.account);
      else reject(outcome.error);
    };

    const server = createServer(async (req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(html);
        return;
      }

      if (req.method === "POST" && req.url === "/callback") {
        let payload: { apiKey?: string; siteName?: string; nonce?: string };
        try {
          payload = JSON.parse(await readBody(req));
        } catch {
          respond(res, 400, { error: "Could not read that request." });
          return;
        }

        if (payload.nonce !== nonce) {
          respond(res, 403, { error: "This login page has expired. Run `teamwork login` again." });
          return;
        }

        try {
          const account = await opts.accept(
            payload.apiKey ?? "",
            payload.siteName || undefined
          );
          respond(res, 200, {
            siteName: account.siteName,
            userName: account.userName,
            email: account.email,
          });
          finish({ ok: true, account });
        } catch (error) {
          // Report and keep listening — the user can correct a bad paste
          // without restarting the CLI.
          const message =
            error instanceof LoginError
              ? [error.message, error.hint].filter(Boolean).join(" ")
              : error instanceof Error
                ? error.message
                : "That token was rejected.";
          respond(res, 400, { error: message });
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: new LoginError(
          "Login timed out.",
          "Run `teamwork login --paste` to enter the token in the terminal instead."
        ),
      });
    }, timeoutMs);
    // A pending timer must not hold the process open on its own.
    timer.unref?.();

    server.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        error: new LoginError(
          `Could not start the local login page: ${error.message}`,
          "Run `teamwork login --paste` to enter the token in the terminal instead."
        ),
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const url = `http://127.0.0.1:${port}`;

      if (openBrowser(url)) {
        console.log(`Opened ${pc.cyan(url)} in your browser.`);
      } else {
        console.log(`Open this page to finish signing in: ${pc.cyan(url)}`);
      }
      console.log(pc.dim("Waiting for your Teamwork token... (Ctrl+C to cancel)"));
    });
  });
}

function respond(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf-8");
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
