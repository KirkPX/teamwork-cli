import { describe, expect, it, vi, beforeEach } from "vitest";
import { TeamworkClient, buildUrl } from "../src/client.js";
import { ApiError, TimeoutError, WriteNotSavedError } from "../src/errors.js";

function makeClient() {
  return new TeamworkClient({
    siteName: "test-site",
    apiKey: "test-key-12345",
    timeoutMs: 5000,
  });
}

describe("TeamworkClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct headers", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await client.request("/test.json");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: expect.stringContaining("Basic "),
    });
  });

  it("handles 204 No Content", async () => {
    const client = makeClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 })
    );

    const result = await client.request("/delete.json", {
      method: "DELETE",
    });

    expect(result.status).toBe(204);
    expect(result.data).toBeNull();
  });

  it("throws ApiError on non-OK status", async () => {
    const client = makeClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "application/json" },
      })
    );

    await expect(client.request("/missing.json")).rejects.toThrow(
      ApiError
    );
  });

  it("redacts API key from error messages", async () => {
    const client = makeClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "error" }), {
        status: 500,
        statusText: "Server Error",
        headers: { "content-type": "application/json" },
      })
    );

    try {
      await client.request("/fail.json");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const msg = (e as Error).message;
      expect(msg).not.toContain("test-key-12345");
    }
  });

  it("throws TimeoutError on timeout", async () => {
    const client = new TeamworkClient({
      siteName: "test-site",
      apiKey: "key",
      timeoutMs: 1,
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal?.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          const timer = setTimeout(
            () => resolve(new Response("ok")),
            2000
          );
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );

    await expect(client.request("/slow.json")).rejects.toThrow(TimeoutError);
  });

  it("passes query params", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
    );

    await client.request("/test.json", {
      params: { page: 1, pageSize: 100 },
    });

    const url = fetchSpy.mock.calls[0]![0] as string | URL;
    expect(url.toString()).toContain("page=1");
    expect(url.toString()).toContain("pageSize=100");
  });

  it("sends request body as JSON", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );

    await client.request("/create.json", {
      method: "POST",
      body: { name: "Test" },
    });

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({ name: "Test" }));
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });

  it("retries 429 responses and then succeeds", async () => {
    const retries: unknown[] = [];
    const client = new TeamworkClient({
      siteName: "test-site",
      apiKey: "test-key-12345",
      timeoutMs: 5000,
      retryBaseDelayMs: 0,
      onRetry: (info) => retries.push(info),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const result = await client.request("/retry.json");

    expect(result.data).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(retries).toMatchObject([
      { attempt: 1, maxRetries: 3, delayMs: 0, status: 429 },
    ]);
  });

  // 5xx is retried only where replaying is safe, which is the distinction the
  // three tests below draw.
  function failing(status: number, statusText: string) {
    return new Response(JSON.stringify({ message: statusText }), {
      status,
      statusText,
      headers: { "content-type": "application/json" },
    });
  }

  function retryClient() {
    return new TeamworkClient({
      siteName: "test-site",
      apiKey: "test-key-12345",
      timeoutMs: 5000,
      retryBaseDelayMs: 0,
    });
  }

  it("retries a 5xx on GET, because replaying a read is safe", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(failing(500, "Server Error"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    await expect(retryClient().request("/flaky.json")).resolves.toMatchObject({ status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 5xx on POST — the mutation may already have applied", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(failing(500, "Server Error"));

    await expect(
      retryClient().request("/tasks.json", { method: "POST", body: { name: "x" } })
    ).rejects.toThrow(ApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 4xx", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(failing(404, "Not Found"));

    await expect(retryClient().request("/missing.json")).rejects.toThrow(ApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("scales the delay with the attempt, and Retry-After overrides it", async () => {
    const delays: number[] = [];
    const client = new TeamworkClient({
      siteName: "test-site",
      apiKey: "test-key-12345",
      timeoutMs: 5000,
      retryBaseDelayMs: 100,
      maxRetries: 3,
      onRetry: (info) => delays.push(info.delayMs),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(failing(429, "Too Many Requests"));

    await expect(client.request("/rate-limited.json")).rejects.toThrow(ApiError);

    // Jitter is multiplicative (0.5x-1.0x), so assert ranges, not exact values.
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(50);
    expect(delays[0]).toBeLessThanOrEqual(100);
    expect(delays[1]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeLessThanOrEqual(200);
  });

  it("honors Retry-After ahead of the computed backoff", async () => {
    const delays: number[] = [];
    const client = new TeamworkClient({
      siteName: "test-site",
      apiKey: "test-key-12345",
      timeoutMs: 5000,
      retryBaseDelayMs: 0,
      onRetry: (info) => delays.push(info.delayMs),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "2" },
      })
    );

    await expect(client.request("/rate-limited.json")).rejects.toThrow(ApiError);
    expect(delays[0]).toBe(2000);
  });

  it("downloads file content from the latest file version", async () => {
    const client = makeClient();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            file: {
              id: 12,
              name: "fallback.txt",
              versions: [{ downloadURL: "https://test-site.teamwork.com/projects/api/v3/files/1/download" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response("hello", {
          status: 200,
          headers: {
            "content-type": "text/plain",
            "content-disposition": 'attachment; filename="hello.txt"',
          },
        })
      );

    const downloaded = await client.downloadFile(12);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(downloaded.filename).toBe("hello.txt");
    expect(downloaded.contentType).toBe("text/plain");
    expect(Buffer.from(downloaded.bytes).toString("utf8")).toBe("hello");
  });

  it("uploads pending files as multipart form data", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ pendingFile: { ref: "abc123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const ref = await client.uploadPendingFile(
      "hello.txt",
      new TextEncoder().encode("hello"),
      "text/plain"
    );

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(ref).toBe("abc123");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(init?.headers).not.toMatchObject({ "Content-Type": expect.any(String) });
  });

  it("creates a project with a v1 project payload", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ STATUS: "OK", id: "77" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );

    await client.createProject({ name: "New Project", description: "desc" });

    const url = fetchSpy.mock.calls[0]![0] as string | URL;
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(url.toString()).toContain("/projects.json");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ project: { name: "New Project", description: "desc" } })
    );
  });

  it("creates a tasklist using the v1 todo-list body key", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ STATUS: "OK", id: "5" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );

    await client.createTaskList(42, { name: "Phase 1" });

    const url = fetchSpy.mock.calls[0]![0] as string | URL;
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(url.toString()).toContain("/projects/42/tasklists.json");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ "todo-list": { name: "Phase 1" } })
    );
  });

  it("sends addToTop as a query param when creating a tasklist", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ STATUS: "OK", id: "6" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );

    await client.createTaskList(42, { name: "Phase 0", addToTop: true });

    const url = fetchSpy.mock.calls[0]![0] as string | URL;
    expect(url.toString()).toContain("addToTop=true");
  });

  it("updates a tasklist", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await client.updateTaskList(9, { name: "Renamed" });

    const url = fetchSpy.mock.calls[0]![0] as string | URL;
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(url.toString()).toContain("/tasklists/9.json");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ "todo-list": { name: "Renamed" } }));
  });

  it("fetches tasklists for a project from the v3 endpoint", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tasklists: [{ id: 1, name: "Phase 1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const lists = await client.getTaskLists(42);

    const url = fetchSpy.mock.calls[0]![0] as string | URL;
    expect(url.toString()).toContain("/projects/api/v3/projects/42/tasklists.json");
    expect(lists).toEqual([{ id: 1, name: "Phase 1" }]);
  });

  it("attaches pending files to tasks", async () => {
    const client = makeClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await client.attachFileToTask(99, "pending-ref", "A file");

    const url = fetchSpy.mock.calls[0]![0] as string | URL;
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(url.toString()).toContain("/tasks/99/files.json");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ file: { pendingFileRef: "pending-ref", description: "A file" } })
    );
  });
});

describe("buildUrl keeps requests on the signed-in site", () => {
  const base = "https://acmecorp.teamwork.com";

  it("accepts paths and full addresses on the site", () => {
    expect(buildUrl(base, "/projects.json", { page: 2 })).toBe("https://acmecorp.teamwork.com/projects.json?page=2");
    expect(buildUrl(base, "projects.json")).toBe("https://acmecorp.teamwork.com/projects.json");
    expect(buildUrl(base, "https://acmecorp.teamwork.com/files/1/download")).toBe(
      "https://acmecorp.teamwork.com/files/1/download"
    );
  });

  it.each([
    "//other.example/x",
    "/\\other.example/x",
    "https://other.example/x",
    "http://acmecorp.teamwork.com/x",
    "https://acmecorp.teamwork.com.other.example/x",
  ])("refuses %s", (path) => {
    expect(() => buildUrl(base, path)).toThrow("requests go only to acmecorp.teamwork.com");
  });

  it("refuses before any request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new TeamworkClient({ siteName: "acmecorp", apiKey: "secret-key" });
    await expect(client.request("//other.example/x")).rejects.toThrow("Refusing");
    await expect(client.requestBytes("https://other.example/f")).rejects.toThrow("Refusing");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("task estimates", () => {
  // Teamwork takes `estimatedMinutes` on a write and returns `estimateMinutes`.
  // It drops a write field it does not know, with no error.
  function stubTaskReply(estimateMinutes: number) {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ task: { id: 5, estimateMinutes } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const sentTask = (fetchMock: ReturnType<typeof vi.fn>) =>
    JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).task;

  it("create sends estimatedMinutes", async () => {
    const fetchMock = stubTaskReply(45);
    await makeClient().createTask(7, { name: "t", estimateMinutes: 45 });
    expect(sentTask(fetchMock)).toMatchObject({ estimatedMinutes: 45 });
    expect(sentTask(fetchMock)).not.toHaveProperty("estimateMinutes");
    vi.unstubAllGlobals();
  });

  it("update sends estimatedMinutes, including 0 to clear it", async () => {
    let fetchMock = stubTaskReply(30);
    await makeClient().updateTask(5, { estimateMinutes: 30 });
    expect(sentTask(fetchMock)).toEqual({ estimatedMinutes: 30 });
    fetchMock = stubTaskReply(0);
    await makeClient().updateTask(5, { estimateMinutes: 0 });
    expect(sentTask(fetchMock)).toEqual({ estimatedMinutes: 0 });
    vi.unstubAllGlobals();
  });

  it("fails when Teamwork answers OK but did not save the estimate", async () => {
    stubTaskReply(0);
    await expect(makeClient().updateTask(5, { estimateMinutes: 30 })).rejects.toThrow(
      "saved an estimate of 0 minutes, not 30"
    );
    await expect(makeClient().createTask(7, { name: "t", estimateMinutes: 30 })).rejects.toBeInstanceOf(
      WriteNotSavedError
    );
    vi.unstubAllGlobals();
  });
});
