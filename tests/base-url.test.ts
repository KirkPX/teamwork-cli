import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { testBaseUrl } from "../src/cli/client-helpers.js";

const exec = promisify(execFile);
const distIndex = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");

// Every request carries the API key, so the override may point only at this machine.
describe("TEAMWORK_BASE_URL", () => {
  it("accepts an address on this machine", () => {
    expect(testBaseUrl(undefined)).toBeUndefined();
    expect(testBaseUrl("")).toBeUndefined();
    expect(testBaseUrl("http://127.0.0.1:9")).toBe("http://127.0.0.1:9");
    expect(testBaseUrl("http://localhost:8080/ignored/path")).toBe("http://localhost:8080");
    expect(testBaseUrl("https://localhost")).toBe("https://localhost");
  });

  it.each([
    "https://other.example",
    "https://acmecorp.teamwork.com",
    "http://127.0.0.1.other.example",
    "http://localhost.other.example",
    "http://10.0.0.5",
    "file://localhost/etc/passwd",
  ])("refuses %s", (value) => {
    expect(() => testBaseUrl(value)).toThrow("must point at this machine");
  });

  it("refuses text that is not an address", () => {
    expect(() => testBaseUrl("not a url")).toThrow("not a valid address");
  });

  it("the built CLI stops before sending anything", async () => {
    const failed = await exec(process.execPath, [distIndex, "--json", "projects", "list"], {
      env: {
        ...process.env,
        TEAMWORK_API_KEY: "test-key",
        TEAMWORK_SITE_NAME: "acmecorp",
        TEAMWORK_BASE_URL: "https://other.example",
      },
    }).catch((e: { code: number; stderr: string }) => e);
    expect((failed as { code: number }).code).toBe(1);
    const { message, hint } = JSON.parse((failed as { stderr: string }).stderr);
    expect(message).toContain("must point at this machine");
    expect(hint).toContain("Unset TEAMWORK_BASE_URL");
  });
});
