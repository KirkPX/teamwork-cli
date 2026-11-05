import { ApiError, NetworkError, TimeoutError, UsageError, WriteNotSavedError, redact } from "./errors.js";

export type TeamworkClientOptions = {
  siteName: string;
  /**
   * Overrides `https://<site>.teamwork.com`. Only tests use it, and
   * `createClient` accepts only an address on this machine.
   */
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  onRetry?: (info: RetryInfo) => void;
};

export type RetryInfo = {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  status: number;
  operation: string;
};

export type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  method?: RequestMethod;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
};

export type ApiResponse<T = unknown> = {
  status: number;
  data: T | null;
};

/** Project feature names this CLI accepts, and the API field each one sets. */
export const PROJECT_FEATURES: Record<string, string> = {
  tasks: "use-tasks",
  messages: "use-messages",
  time: "use-time",
  billing: "use-billing",
  milestones: "use-milestones",
  files: "use-files",
  notebook: "use-notebook",
  links: "use-links",
  riskregister: "use-riskregister",
  comments: "use-comments",
  board: "use-board",
  table: "use-table",
  gantt: "use-gantt",
  finance: "use-finance",
  forms: "use-forms",
  proofs: "use-proofs",
  tickets: "use-tickets",
  timeline: "use-timeline",
  dashboard: "use-dashboard",
  calendar: "use-calendar",
  overview: "use-overview",
  activity: "use-activity",
};

export class TeamworkClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly onRetry?: (info: RetryInfo) => void;
  private lastRequest = 0;
  private readonly minInterval = 500;

  constructor(options: TeamworkClientOptions) {
    this.baseUrl = options.baseUrl
      ? new URL(options.baseUrl).origin
      : normalizeBaseUrl(options.siteName);
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.onRetry = options.onRetry;
  }

  async request<T = unknown>(
    path: string,
    opts: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const { method = "GET", body, params, headers: extraHeaders } = opts;
    const url = buildUrl(this.baseUrl, path, params);
    const operation = `${method} ${path}`;
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

    for (let attempt = 1; ; attempt++) {
      const { response, body: data } = await this.fetchWithTimeout(url, operation, {
        method,
        headers: {
          Accept: "application/json",
          ...this.authHeader(),
          ...(body !== undefined && !isFormData
            ? { "Content-Type": "application/json" }
            : {}),
          ...extraHeaders,
        },
        ...(body !== undefined
          ? { body: isFormData ? body : JSON.stringify(body) }
          : {}),
      }, parseResponseBody);

      if (response.ok) {
        return { status: response.status, data: data as T | null };
      }

      if (isRetryable(response.status, method) && attempt < this.maxRetries) {
        const delayMs = retryDelayMs(response, attempt, this.retryBaseDelayMs);
        this.onRetry?.({
          attempt,
          maxRetries: this.maxRetries,
          delayMs,
          status: response.status,
          operation,
        });
        await sleep(delayMs);
        continue;
      }

      throw new ApiError({
        status: response.status,
        statusText: response.statusText,
        operation,
        safeDetail: extractSafeDetail(data),
      });
    }
  }

  async requestBytes(
    pathOrUrl: string,
    opts: RequestOptions = {}
  ): Promise<{ bytes: Uint8Array; filename?: string; contentType: string }> {
    const { method = "GET", params, headers: extraHeaders } = opts;
    const url = buildUrl(this.baseUrl, pathOrUrl, params);
    const operation = `${method} ${pathOrUrl}`;

    for (let attempt = 1; ; attempt++) {
      const { response, body } = await this.fetchWithTimeout(
        url,
        operation,
        {
          method,
          headers: {
            Accept: "*/*",
            ...this.authHeader(),
            ...extraHeaders,
          },
        },
        async (res) => (res.ok ? new Uint8Array(await res.arrayBuffer()) : await parseResponseBody(res))
      );

      if (response.ok) {
        return {
          bytes: body as Uint8Array,
          filename: filenameFromHeaders(response.headers),
          contentType:
            response.headers.get("content-type") ?? "application/octet-stream",
        };
      }

      const data = body;
      if (isRetryable(response.status, method) && attempt < this.maxRetries) {
        const delayMs = retryDelayMs(response, attempt, this.retryBaseDelayMs);
        this.onRetry?.({
          attempt,
          maxRetries: this.maxRetries,
          delayMs,
          status: response.status,
          operation,
        });
        await sleep(delayMs);
        continue;
      }

      throw new ApiError({
        status: response.status,
        statusText: response.statusText,
        operation,
        safeDetail: extractSafeDetail(data),
      });
    }
  }

  /**
   * Send one request and read its body, both inside one time limit. A reply
   * that starts quickly and then stalls is stopped too, not only one that never
   * starts.
   */
  private async fetchWithTimeout<B>(
    url: string,
    operation: string,
    init: RequestInit,
    readBody: (response: Response) => Promise<B>
  ): Promise<{ response: Response; body: B }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    await this.rateLimitWait();

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return { response, body: await readBody(response) };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // This string names the platform's abort error, not our TimeoutError.
      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError({ operation, timeoutMs: this.timeoutMs });
      }
      // fetch reports every network failure as "fetch failed", with the
      // reason, such as ENOTFOUND, on `cause`.
      if (error instanceof TypeError) {
        throw new NetworkError({ operation, host: new URL(url).host, cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeader(): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`${this.apiKey}:X`).toString(
        "base64"
      )}`,
    };
  }

  async paginated<T>(
    path: string,
    opts: RequestOptions = {}
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    const pageSize = 500;
    const params = { ...opts.params, page, pageSize };

    while (true) {
      const { data } = await this.request<Record<string, unknown>>(path, {
        ...opts,
        params,
      });

      const items = extractArray(data);
      if (!items || items.length === 0) break;

      all.push(...(items as T[]));

      if (items.length < pageSize) break;
      page++;
      params.page = page;
    }

    return all;
  }

  private async rateLimitWait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.minInterval) {
      await new Promise((r) =>
        setTimeout(r, this.minInterval - elapsed)
      );
    }
    this.lastRequest = Date.now();
  }

  // ── V3 reads ──────────────────────────────────────────

  async me() {
    const { data } = await this.request("/projects/api/v3/me.json");
    return (data as Record<string, unknown>) ?? {};
  }

  async getProjects(status?: "active" | "archived" | "all") {
    const params: Record<string, string> = {
      includeCompletedProjects: "true",
    };
    if (status) {
      params.projectStatuses =
        status === "all" ? "active,archived" : status;
    }
    return this.paginated("/projects/api/v3/projects.json", { params });
  }

  async getProject(projectId: number) {
    const { data } = await this.request(
      `/projects/api/v3/projects/${projectId}.json`
    );
    return ((data as Record<string, unknown>)?.project ?? data) as Record<
      string,
      unknown
    >;
  }

  async getProjectTasks(projectId: number) {
    return this.paginated(
      `/projects/api/v3/projects/${projectId}/tasks.json`,
      {
        params: {
          include: "assignees,tasklists",
          includeCompletedTasks: "true",
        },
      }
    );
  }

  async getTaskLists(projectId: number) {
    return this.paginated(
      `/projects/api/v3/projects/${projectId}/tasklists.json`
    );
  }

  async getTimeEntries(
    projectId?: number,
    fromDate?: string,
    toDate?: string
  ) {
    const params: Record<string, string> = {};
    if (projectId) params.projectIds = String(projectId);
    if (fromDate) params.fromdate = fromDate;
    if (toDate) params.todate = toDate;
    return this.paginated("/projects/api/v3/time.json", { params });
  }

  async getPeople() {
    return this.paginated("/projects/api/v3/people.json");
  }

  async getCompanies() {
    return this.paginated("/projects/api/v3/companies.json");
  }

  async getProjectExpenses(projectId: number) {
    return this.paginated(
      `/projects/api/v3/projects/${projectId}/expenses.json`
    );
  }

  // ── V3 task mutations ─────────────────────────────────

  async createTask(
    tasklistId: number,
    opts: {
      name: string;
      description?: string;
      assigneeUserIds?: number[];
      startDate?: string;
      dueDate?: string;
      priority?: string;
      estimateMinutes?: number;
      notify?: boolean;
      fireWebhook?: boolean;
    }
  ) {
    const task: Record<string, unknown> = {
      tasklistId,
      name: opts.name,
    };
    if (opts.description) task.description = opts.description;
    if (opts.assigneeUserIds?.length) {
      task.assignees = { userIds: opts.assigneeUserIds };
    }
    if (opts.startDate) task.startAt = opts.startDate;
    if (opts.dueDate) task.dueAt = opts.dueDate;
    if (opts.priority) task.priority = opts.priority;
    if (opts.estimateMinutes !== undefined) task.estimatedMinutes = opts.estimateMinutes;
    if (opts.notify !== undefined) task.notify = opts.notify;

    const body: Record<string, unknown> = { task };
    if (opts.notify !== undefined || opts.fireWebhook !== undefined) {
      body.taskOptions = {
        notify: opts.notify ?? true,
        fireWebhook: opts.fireWebhook ?? true,
        useNotifyViaTWIM: opts.notify ?? true,
      };
    }

    const params: Record<string, string> = {};
    if (opts.fireWebhook === false) params.fireWebhook = "false";

    const { data } = await this.request(
      `/projects/api/v3/tasklists/${tasklistId}/tasks.json`,
      { method: "POST", body, params }
    );
    assertEstimateSaved(data, opts.estimateMinutes, "POST tasks");
    return data;
  }

  async updateTask(
    taskId: number,
    updates: {
      name?: string;
      description?: string;
      assigneeUserIds?: number[];
      startDate?: string;
      dueDate?: string;
      priority?: string;
      estimateMinutes?: number;
      progress?: number;
    }
  ) {
    const task: Record<string, unknown> = {};
    if (updates.name) task.name = updates.name;
    if (updates.description !== undefined)
      task.description = updates.description;
    if (updates.assigneeUserIds !== undefined)
      task.assignees = { userIds: updates.assigneeUserIds };
    if (updates.startDate) task.startAt = updates.startDate;
    if (updates.dueDate) task.dueAt = updates.dueDate;
    if (updates.priority) task.priority = updates.priority;
    if (updates.estimateMinutes !== undefined)
      task.estimatedMinutes = updates.estimateMinutes;
    if (updates.progress !== undefined) task.progress = updates.progress;

    const { data } = await this.request(
      `/projects/api/v3/tasks/${taskId}.json`,
      { method: "PATCH", body: { task } }
    );
    assertEstimateSaved(data, updates.estimateMinutes, `PATCH task ${taskId}`);
    return data;
  }

  async deleteTask(taskId: number) {
    await this.request(`/tasks/${taskId}.json`, { method: "DELETE" });
  }

  // ── V1 fallbacks ──────────────────────────────────────

  async createProject(opts: {
    name: string;
    description?: string;
    companyId?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const project: Record<string, unknown> = { name: opts.name };
    if (opts.description) project.description = opts.description;
    if (opts.companyId) project.companyId = opts.companyId;
    if (opts.startDate) project.startDate = opts.startDate;
    if (opts.endDate) project.endDate = opts.endDate;
    const { data } = await this.request("/projects.json", {
      method: "POST",
      body: { project },
    });
    return data;
  }

  async updateProject(
    projectId: number,
    updates: {
      name?: string;
      description?: string;
      categoryId?: number;
      startDate?: string;
      endDate?: string;
      status?: string;
      features?: Record<string, boolean>;
    }
  ) {
    const project: Record<string, unknown> = {};
    if (updates.name) project.name = updates.name;
    if (updates.description !== undefined)
      project.description = updates.description;
    if (updates.categoryId)
      project["category-id"] = String(updates.categoryId);
    if (updates.startDate) project.startDate = updates.startDate;
    if (updates.endDate) project.endDate = updates.endDate;
    if (updates.status) project.status = updates.status;

    if (updates.features) {
      for (const [key, val] of Object.entries(updates.features)) {
        const apiField = PROJECT_FEATURES[key.toLowerCase()];
        if (apiField) project[apiField] = val ? "1" : "0";
      }
    }

    await this.request(`/projects/${projectId}.json`, {
      method: "PUT",
      body: { project },
    });
  }

  async addProjectMembers(projectId: number, userIds: number[]) {
    await this.request(
      `/projects/api/v3/projects/${projectId}/people.json`,
      { method: "PUT", body: { add: { userIds } } }
    );
  }

  async createTaskList(
    projectId: number,
    opts: { name: string; description?: string; addToTop?: boolean }
  ) {
    const todoList: Record<string, unknown> = { name: opts.name };
    if (opts.description) todoList.description = opts.description;
    const params: Record<string, string> = {};
    if (opts.addToTop) params.addToTop = "true";
    const { data } = await this.request(
      `/projects/${projectId}/tasklists.json`,
      { method: "POST", body: { "todo-list": todoList }, params }
    );
    return data;
  }

  async updateTaskList(
    tasklistId: number,
    updates: { name?: string; description?: string }
  ) {
    const todoList: Record<string, unknown> = {};
    if (updates.name) todoList.name = updates.name;
    if (updates.description) todoList.description = updates.description;
    await this.request(`/tasklists/${tasklistId}.json`, {
      method: "PUT",
      body: { "todo-list": todoList },
    });
  }

  async deleteTaskList(tasklistId: number) {
    await this.request(`/tasklists/${tasklistId}.json`, {
      method: "DELETE",
    });
  }

  async getNotebooks(projectId: number) {
    const { data } = await this.request(
      `/projects/${projectId}/notebooks.json`
    );
    const project = (data as Record<string, unknown>)?.project as
      | Record<string, unknown>
      | undefined;
    return (project?.notebooks ?? []) as Record<string, unknown>[];
  }

  async createNotebook(
    projectId: number,
    opts: {
      name: string;
      content: string;
      description?: string;
      notify?: string;
    }
  ) {
    const notebook: Record<string, unknown> = {
      name: opts.name,
      content: opts.content,
    };
    if (opts.description) notebook.description = opts.description;
    if (opts.notify) notebook.notify = opts.notify;
    const { data } = await this.request(
      `/projects/${projectId}/notebooks.json`,
      { method: "POST", body: { notebook } }
    );
    return data;
  }

  async updateNotebook(
    notebookId: number,
    updates: { name?: string; content?: string; description?: string }
  ) {
    const notebook: Record<string, unknown> = {};
    if (updates.name) notebook.name = updates.name;
    if (updates.content) notebook.content = updates.content;
    if (updates.description) notebook.description = updates.description;
    await this.request(`/notebooks/${notebookId}.json`, {
      method: "PUT",
      body: { notebook },
    });
  }

  async deleteNotebook(notebookId: number) {
    await this.request(`/notebooks/${notebookId}.json`, {
      method: "DELETE",
    });
  }

  async getTaskFiles(taskId: number) {
    const { data } = await this.request(`/tasks/${taskId}/files.json`);
    return ((data as Record<string, unknown>)?.files ?? []) as Record<
      string,
      unknown
    >[];
  }

  async getFile(fileId: number) {
    const { data } = await this.request(`/files/${fileId}.json`);
    return ((data as Record<string, unknown>)?.file ?? data) as Record<
      string,
      unknown
    >;
  }

  async downloadFile(fileId: number) {
    const file = await this.getFile(fileId);
    const versions = Array.isArray(file.versions) ? file.versions : [];
    const latestVersion = versions[0] as Record<string, unknown> | undefined;
    const downloadUrl =
      typeof latestVersion?.downloadURL === "string"
        ? latestVersion.downloadURL
        : typeof file.downloadURL === "string"
          ? file.downloadURL
          : undefined;

    if (!downloadUrl) {
      throw new ApiError({
        status: 502,
        statusText: "Bad Gateway",
        operation: `GET /files/${fileId}.json`,
        safeDetail: "Response contained no download URL.",
      });
    }

    const downloaded = await this.requestBytes(downloadUrl);
    return {
      bytes: downloaded.bytes,
      filename:
        downloaded.filename ??
        (typeof file.name === "string" ? file.name : `file_${fileId}`),
      contentType: downloaded.contentType,
    };
  }

  async uploadPendingFile(
    filename: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream"
  ) {
    const form = new FormData();
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    form.append("file", new Blob([arrayBuffer], { type: contentType }), filename);

    const { data } = await this.request<Record<string, unknown>>(
      "/pendingfiles.json",
      {
        method: "POST",
        body: form,
      }
    );
    const pendingFile = data?.pendingFile as Record<string, unknown> | undefined;
    const ref = pendingFile?.ref;
    if (typeof ref !== "string" || ref.length === 0) {
      throw new ApiError({
        status: 502,
        statusText: "Bad Gateway",
        operation: "POST /pendingfiles.json",
        safeDetail: "Response contained no pending file reference.",
      });
    }
    return ref;
  }

  async attachFileToTask(
    taskId: number,
    pendingFileRef: string,
    description?: string
  ) {
    const file: Record<string, unknown> = { pendingFileRef };
    if (description) file.description = description;
    const { data } = await this.request(`/tasks/${taskId}/files.json`, {
      method: "POST",
      body: { file },
    });
    return data;
  }
}

// ── Helpers ────────────────────────────────────────────

function normalizeBaseUrl(siteName: string) {
  const host = siteName.endsWith(".teamwork.com")
    ? siteName
    : `${siteName}.teamwork.com`;
  return `https://${host}`;
}

/**
 * Teamwork's task API takes the estimate as `estimatedMinutes` on a write, and
 * returns it as `estimateMinutes`. It ignores an unknown write field without
 * an error, so the returned task is checked: a write that reports success but
 * did not save the estimate fails here instead.
 */
function assertEstimateSaved(data: unknown, wanted: number | undefined, operation: string): void {
  if (wanted === undefined) return;
  const saved = (data as { task?: { estimateMinutes?: unknown } } | null)?.task?.estimateMinutes;
  if (saved === undefined || saved === wanted) return;
  throw new WriteNotSavedError(
    `${operation}: Teamwork answered OK but saved an estimate of ${String(saved)} minutes, not ${wanted}.`
  );
}

/**
 * The full address for a request. It must stay on the signed-in site, because
 * every request carries the API key. A path such as `//other.example/x` or an
 * absolute address elsewhere would otherwise send the key to that host.
 */
export function buildUrl(
  base: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) {
    throw new UsageError(
      `Refusing to send a request to ${url.host}: requests go only to ${new URL(base).host}.`,
      "Pass a path on your Teamwork site, such as /projects/api/v3/tasks.json."
    );
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Idempotent by definition: replaying one cannot create or change anything. */
const IDEMPOTENT: ReadonlySet<RequestMethod> = new Set<RequestMethod>(["GET"]);

/**
 * 429 is always safe to retry: the request was rejected, so nothing was applied.
 *
 * 5xx is only safe on an idempotent method. A 500 from `POST /tasks.json` may
 * well have created the task before failing to answer, so replaying it could
 * duplicate work.
 */
export function isRetryable(status: number, method: RequestMethod): boolean {
  if (status === 429) return true;
  if (status >= 500 && status < 600) return IDEMPOTENT.has(method);
  return false;
}

/**
 * Retry-After wins outright and uncapped — the server is telling us when it
 * will be ready. Otherwise back off exponentially with jitter.
 *
 * Jitter is multiplicative so a base of 0 stays exactly 0, which keeps tests
 * fast and deterministic about "no delay".
 */
function retryDelayMs(
  response: Response,
  attempt: number,
  baseMs: number,
  capMs = 30_000
): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }

  const backoff = Math.min(baseMs * 2 ** (attempt - 1), capMs);
  return Math.round(backoff * (0.5 + Math.random() * 0.5));
}

function filenameFromHeaders(headers: Headers): string | undefined {
  const disposition = headers.get("content-disposition");
  if (!disposition) return undefined;
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) return decodeURIComponent(utf8[1].replace(/"/g, ""));
  const ascii = disposition.match(/filename="?([^";]+)"?/i);
  return ascii?.[1];
}

async function parseResponseBody(
  response: globalThis.Response
): Promise<unknown> {
  if (response.status === 204) return null;
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try {
    return await response.json();
  } catch (error) {
    // A timeout while the body arrives must reach the caller as a timeout.
    if (error instanceof Error && error.name === "AbortError") throw error;
    return null;
  }
}

function extractArray(data: unknown): unknown[] | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const arrayKeys = [
    "projects",
    "tasks",
    "taskLists",
    "tasklists",
    "timeEntries",
    "timelogs",
    "people",
    "companies",
    "notebooks",
    "expenses",
    "files",
    "data",
    "items",
    "results",
  ];
  for (const key of arrayKeys) {
    const val = obj[key];
    if (Array.isArray(val)) return val;
  }
  return null;
}

function extractSafeDetail(data: unknown): string {
  if (!data || typeof data !== "object") return "no response detail";
  const obj = data as Record<string, unknown>;
  const msg = obj.message || obj.error || obj.msg;
  if (typeof msg === "string") return redact(msg, 20);
  return "no response detail";
}
