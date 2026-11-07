import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamworkClient } from "../src/client.js";
import { parseDate } from "../src/cli/parse.js";

function makeClient() {
  return new TeamworkClient({ siteName: "test-site", apiKey: "test-key-12345", timeoutMs: 5000 });
}

function fakeTeamwork(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  );
}

afterEach(() => vi.restoreAllMocks());

describe("parseDate", () => {
  it("takes both forms and returns YYYY-MM-DD", () => {
    expect(parseDate("2026-01-31")).toBe("2026-01-31");
    expect(parseDate("20260131")).toBe("2026-01-31");
  });

  it("refuses an impossible or unreadable date", () => {
    expect(() => parseDate("2026-02-30")).toThrow(/YYYY-MM-DD or YYYYMMDD/);
    expect(() => parseDate("31/01/2026")).toThrow(/YYYY-MM-DD or YYYYMMDD/);
    expect(() => parseDate("2026-1-5")).toThrow(/YYYY-MM-DD or YYYYMMDD/);
  });
});

describe("dates reach Teamwork in the form each API reads", () => {
  it("time list filters with startDate and endDate", async () => {
    const fetchSpy = fakeTeamwork({ timelogs: [], meta: { page: { hasMore: false } } });
    await makeClient().getTimeEntries(5, "2026-01-01", "2026-01-31");
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.searchParams.get("startDate")).toBe("2026-01-01");
    expect(url.searchParams.get("endDate")).toBe("2026-01-31");
    expect(url.searchParams.has("fromdate")).toBe(false);
  });

  it("project create and update send YYYYMMDD to the v1 project API", async () => {
    const fetchSpy = fakeTeamwork({ id: "1" });
    await makeClient().createProject({ name: "P", startDate: "2026-01-01", endDate: "2026-12-31" });
    await makeClient().updateProject(1, { startDate: "2026-02-01" });
    const sent = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).project);
    expect(sent[0]).toMatchObject({ startDate: "20260101", endDate: "20261231" });
    expect(sent[1]).toMatchObject({ startDate: "20260201" });
  });
});
