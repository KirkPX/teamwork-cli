import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSiteName, verifyApiKey, LoginError } from "../src/login/discover.js";
import { runBrowserLogin } from "../src/login/server.js";
import { loginPage } from "../src/login/page.js";
import path from "node:path";
import { findOpener, openBrowser, openerArgument } from "../src/login/browser.js";
import { TeamworkClient } from "../src/client.js";

describe("normalizeSiteName", () => {
  it("accepts a bare site name", () => {
    expect(normalizeSiteName("acmecorp")).toBe("acmecorp");
  });

  it("strips a full URL down to the subdomain", () => {
    expect(normalizeSiteName("https://acmecorp.teamwork.com/app/home")).toBe(
      "acmecorp"
    );
  });

  it("strips a bare host", () => {
    expect(normalizeSiteName("acmecorp.teamwork.com")).toBe("acmecorp");
  });

  it("lowercases", () => {
    expect(normalizeSiteName("AcmeCorp")).toBe("acmecorp");
  });

  it("returns null for empty or junk input", () => {
    expect(normalizeSiteName("")).toBeNull();
    expect(normalizeSiteName(undefined)).toBeNull();
    expect(normalizeSiteName("not a site name")).toBeNull();
  });
});

describe("verifyApiKey", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockAuthenticate(status: number, body: unknown) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as typeof fetch;
  }

  it("discovers the site from the account payload, whatever the field name", async () => {
    // The response shape is undocumented, so discovery scans for the URL
    // rather than betting on a key name.
    mockAuthenticate(200, {
      account: { id: 1, someUndocumentedField: "https://acmecorp.teamwork.com/" },
    });
    vi.spyOn(TeamworkClient.prototype, "me").mockResolvedValue({
      person: { firstName: "Ada", lastName: "Lovelace", email: "k@example.com" },
    });

    const account = await verifyApiKey("twp_abc123");
    expect(account.siteName).toBe("acmecorp");
    expect(account.userName).toBe("Ada Lovelace");
    expect(account.email).toBe("k@example.com");
  });

  it("finds the URL nested inside arrays", async () => {
    mockAuthenticate(200, {
      accounts: [{ installation: { url: "https://nested.teamwork.com" } }],
    });
    vi.spyOn(TeamworkClient.prototype, "me").mockResolvedValue({
      person: { fullName: "Someone" },
    });

    const account = await verifyApiKey("twp_abc123");
    expect(account.siteName).toBe("nested");
  });

  it("rejects a bad key without touching the site API", async () => {
    mockAuthenticate(401, {});
    const me = vi.spyOn(TeamworkClient.prototype, "me");

    await expect(verifyApiKey("wrong")).rejects.toThrow(/rejected that API key/i);
    expect(me).not.toHaveBeenCalled();
  });

  it("rejects an empty key before making any request", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(verifyApiKey("   ")).rejects.toThrow(LoginError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prefers an explicit site hint over discovery", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    vi.spyOn(TeamworkClient.prototype, "me").mockResolvedValue({
      person: { fullName: "Someone" },
    });

    const account = await verifyApiKey("twp_abc123", "https://onprem.teamwork.com");
    expect(account.siteName).toBe("onprem");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks for a site when discovery is unreachable", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    await expect(verifyApiKey("twp_abc123")).rejects.toThrow(
      /could not be matched to a Teamwork site/i
    );
  });

  it("reports a key that discovers a site but fails against it", async () => {
    mockAuthenticate(200, { account: { url: "https://acmecorp.teamwork.com" } });
    vi.spyOn(TeamworkClient.prototype, "me").mockRejectedValue(
      new Error("GET /projects/api/v3/me.json failed: 403 Forbidden")
    );

    await expect(verifyApiKey("twp_abc123")).rejects.toThrow(
      /did not work against acmecorp\.teamwork\.com/i
    );
  });
});

describe("loginPage", () => {
  it("embeds the nonce so only this page can post back", () => {
    const html = loginPage({ nonce: "abc-123" });
    expect(html).toContain('"abc-123"');
  });

  it("loads no external scripts", () => {
    const html = loginPage({ nonce: "n" });
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it("deep-links to a known site when one is already saved", () => {
    expect(loginPage({ nonce: "n", siteName: "acmecorp" })).toContain(
      "https://acmecorp.teamwork.com/"
    );
  });
});

describe("findOpener", () => {
  // This is developed on macOS, so the Windows branch gets no real exercise.
  // Assert its exact shape instead of trusting it.
  it("uses cmd's empty-title form on Windows", () => {
    const opener = findOpener("win32", { ComSpec: "C:\\WINDOWS\\system32\\cmd.exe" });
    expect(opener).toEqual({
      command: "C:\\WINDOWS\\system32\\cmd.exe",
      args: ["/c", "start", ""],
    });
  });

  it("passes an empty string, not two quote characters, as the title", () => {
    // Node renders an empty argument as "" on Windows. A literal '""' would be
    // escaped to "\"\"" and reach cmd as a real title, swallowing the URL.
    const title = findOpener("win32", {})!.args[2];
    expect(title).toBe("");
    expect(title).not.toBe('""');
  });

  it("falls back to cmd.exe when ComSpec is unset", () => {
    expect(findOpener("win32", {})!.command).toBe("cmd.exe");
  });

  // These pass an explicit existence probe. Probing the real filesystem made
  // the macOS case fail on the Windows runner, where /usr/bin/open is absent —
  // a test asserting the host, not the code.
  const present = () => true;
  const absent = () => false;

  it("uses /usr/bin/open on macOS", () => {
    expect(findOpener("darwin", {}, present)).toEqual({
      command: "/usr/bin/open",
      args: [],
    });
  });

  it("returns null on macOS when /usr/bin/open is missing", () => {
    expect(findOpener("darwin", {}, absent)).toBeNull();
  });

  it("uses xdg-open from PATH on Linux", () => {
    expect(findOpener("linux", { PATH: "/usr/bin" }, present)).toEqual({
      command: path.join("/usr/bin", "xdg-open"),
      args: [],
    });
  });

  it("returns null on Linux when xdg-open is not on PATH", () => {
    expect(findOpener("linux", { PATH: "/nonexistent-dir-for-test" }, absent)).toBeNull();
  });
});

// The guard belongs inside openBrowser, so no caller can launch a browser past it.
describe("openBrowser", () => {
  it("refuses to launch anything when TEAMWORK_CLI_NO_BROWSER is set", () => {
    const original = process.env.TEAMWORK_CLI_NO_BROWSER;
    process.env.TEAMWORK_CLI_NO_BROWSER = "1";
    try {
      expect(openBrowser("http://127.0.0.1:9/should-never-open")).toBe(false);
    } finally {
      if (original === undefined) delete process.env.TEAMWORK_CLI_NO_BROWSER;
      else process.env.TEAMWORK_CLI_NO_BROWSER = original;
    }
  });
});

describe("openerArgument", () => {
  const url = "http://127.0.0.1:5000/?nonce=a&site=b";

  it("escapes cmd's special characters on Windows, so the whole URL reaches the browser", () => {
    expect(openerArgument(url, "win32")).toBe("http://127.0.0.1:5000/?nonce=a^&site=b");
    expect(openerArgument("a|b<c>d^e", "win32")).toBe("a^|b^<c^>d^^e");
  });

  it("leaves the URL alone elsewhere", () => {
    expect(openerArgument(url, "darwin")).toBe(url);
    expect(openerArgument(url, "linux")).toBe(url);
  });
});

describe("runBrowserLogin", () => {
  beforeEach(() => {
    // Keep the test from launching a real browser window.
    process.env.TEAMWORK_CLI_NO_BROWSER = "1";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.TEAMWORK_CLI_NO_BROWSER;
    vi.restoreAllMocks();
  });

  /** Reads the served page's nonce, then posts to /callback like the browser. */
  async function drive(
    accept: (apiKey: string, siteHint?: string) => Promise<never | {
      siteName: string;
      userName: string | null;
      email: string | null;
    }>,
    post: (base: string, nonce: string) => Promise<Response>
  ) {
    let captured: { base: string; nonce: string } | null = null;
    const logSpy = vi.spyOn(console, "log");

    const pending = runBrowserLogin({ accept, timeoutMs: 10_000 });

    // The listen callback logs the URL; poll for it.
    for (let i = 0; i < 200 && !captured; i++) {
      const line = logSpy.mock.calls.flat().join(" ");
      const match = /(http:\/\/127\.0\.0\.1:\d+)/.exec(line);
      if (match) {
        const base = match[1]!;
        const html = await (await fetch(base)).text();
        const nonceMatch = /var NONCE = "([^"]+)"/.exec(html);
        captured = { base, nonce: nonceMatch![1]! };
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    if (!captured) throw new Error("server never reported a URL");
    const response = await post(captured.base, captured.nonce);
    return { pending, response, ...captured };
  }

  it("accepts a pasted token and returns the verified account", async () => {
    const account = { siteName: "acmecorp", userName: "Ada", email: null };
    const { pending, response } = await drive(
      async () => account,
      (base, nonce) =>
        fetch(`${base}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: "twp_abc", nonce }),
        })
    );

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual(account);
  });

  it("answers 400 to a body that is valid JSON but not an object, and keeps listening", async () => {
    const account = { siteName: "acmecorp", userName: null, email: null };
    const accept = vi.fn().mockResolvedValue(account);
    const send = (base: string, body: unknown) =>
      fetch(`${base}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const { pending, response, base, nonce } = await drive(accept as never, (b) => send(b, null));
    expect(response.status).toBe(400);
    for (const body of [7, ["x"]]) expect((await send(base, body)).status).toBe(400);
    expect(accept).not.toHaveBeenCalled();

    expect((await send(base, { apiKey: "twp_abc", nonce })).status).toBe(200);
    await expect(pending).resolves.toEqual(account);
  });

  it("refuses a post from another local process without the page's nonce", async () => {
    const accept = vi
      .fn()
      .mockResolvedValue({ siteName: "acmecorp", userName: null, email: null });

    const { pending, response, base, nonce } = await drive(accept as never, (b) =>
      fetch(`${b}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "twp_abc", nonce: "wrong-nonce" }),
      })
    );

    expect(response.status).toBe(403);
    expect(accept).not.toHaveBeenCalled();

    // The real page still works, so a stray post costs the user nothing.
    const real = await fetch(`${base}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "twp_abc", nonce }),
    });
    expect(real.status).toBe(200);
    await expect(pending).resolves.toMatchObject({ siteName: "acmecorp" });
  });

  it("keeps listening after a rejected token so the user can retry", async () => {
    const accept = vi
      .fn()
      .mockRejectedValueOnce(new LoginError("Teamwork rejected that API key."))
      .mockResolvedValueOnce({ siteName: "acmecorp", userName: "Ada", email: null });

    const { pending, response, base, nonce } = await drive(accept as never, (b, n) =>
      fetch(`${b}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "bad", nonce: n }),
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/rejected/i);

    const retry = await fetch(`${base}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "good", nonce }),
    });
    expect(retry.status).toBe(200);
    await expect(pending).resolves.toMatchObject({ siteName: "acmecorp" });
  });
});
