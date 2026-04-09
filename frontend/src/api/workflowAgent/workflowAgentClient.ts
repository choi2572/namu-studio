import type {
  WorkflowAgentDraftRequest,
  WorkflowAgentDraftResponse,
  WorkflowAgentModelActivateRequest,
  WorkflowAgentModelActivateResponse,
  WorkflowAgentSkillSyncRequest,
  WorkflowAgentSkillSyncResponse,
  WorkflowAgentStatusResponse
} from "./types";

export class WorkflowAgentNotConfiguredError extends Error {
  constructor() {
    super("Workflow Agent base URL is not configured (set NEXT_PUBLIC_WORKFLOW_AGENT_BASE_URL).");
    this.name = "WorkflowAgentNotConfiguredError";
  }
}

/** Returns origin only (scheme + host + port). Strips accidental path segments. */
export function normalizeWorkflowAgentBaseUrl(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

function agentPath(suffix: string): string {
  const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/workflow-agent${s}`;
}

function joinBaseAndPath(baseOrigin: string, path: string): string {
  const b = baseOrigin.endsWith("/") ? baseOrigin.slice(0, -1) : baseOrigin;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function logDev(method: string, url: string, body?: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkflowAgent] ${method} ${url}`, body !== undefined ? { body } : "");
  }
}

async function readBodyText(response: Response): Promise<string> {
  return response.text();
}

function formatHttpError(status: number, bodyText: string): string {
  if (!bodyText) {
    return `HTTP ${status}`;
  }
  try {
    const parsed = JSON.parse(bodyText) as { detail?: unknown };
    if (parsed && typeof parsed === "object" && "detail" in parsed) {
      return `HTTP ${status}: ${JSON.stringify(parsed.detail)}`;
    }
  } catch {
    // keep raw text
  }
  return `HTTP ${status}: ${bodyText}`;
}

export type WorkflowAgentClient = {
  readonly baseUrl: string | null;
  isConfigured(): boolean;
  getStatus(): Promise<WorkflowAgentStatusResponse>;
  syncSkills(body: WorkflowAgentSkillSyncRequest): Promise<WorkflowAgentSkillSyncResponse>;
  activateModel(
    body: WorkflowAgentModelActivateRequest
  ): Promise<WorkflowAgentModelActivateResponse>;
  postDraft(body: WorkflowAgentDraftRequest): Promise<WorkflowAgentDraftResponse>;
};

export type CreateWorkflowAgentClientOptions = {
  /** 테스트용. 설정 시 env 대신 사용. 빈 문자열이면 미구성과 동일. */
  baseUrl?: string | null;
  fetchImpl?: typeof fetch;
};

export function createWorkflowAgentClient(
  options?: CreateWorkflowAgentClientOptions
): WorkflowAgentClient {
  const baseUrl =
    options && "baseUrl" in options
      ? normalizeWorkflowAgentBaseUrl(options.baseUrl ?? "")
      : normalizeWorkflowAgentBaseUrl(process.env.NEXT_PUBLIC_WORKFLOW_AGENT_BASE_URL);

  const fetchFn = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);

  function requireBase(): string {
    if (!baseUrl) {
      throw new WorkflowAgentNotConfiguredError();
    }
    return baseUrl;
  }

  return {
    baseUrl,

    isConfigured(): boolean {
      return baseUrl !== null;
    },

    async getStatus(): Promise<WorkflowAgentStatusResponse> {
      const b = requireBase();
      const url = joinBaseAndPath(b, agentPath("/status"));
      logDev("GET", url);
      const response = await fetchFn(url, { method: "GET" });
      const text = await readBodyText(response);
      if (!response.ok) {
        throw new Error(formatHttpError(response.status, text));
      }
      return JSON.parse(text) as WorkflowAgentStatusResponse;
    },

    async syncSkills(body: WorkflowAgentSkillSyncRequest): Promise<WorkflowAgentSkillSyncResponse> {
      const b = requireBase();
      const url = joinBaseAndPath(b, agentPath("/skills/sync"));
      logDev("POST", url, body);
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await readBodyText(response);
      if (!response.ok) {
        throw new Error(formatHttpError(response.status, text));
      }
      return JSON.parse(text) as WorkflowAgentSkillSyncResponse;
    },

    async activateModel(
      body: WorkflowAgentModelActivateRequest
    ): Promise<WorkflowAgentModelActivateResponse> {
      const b = requireBase();
      const url = joinBaseAndPath(b, agentPath("/models/activate"));
      logDev("POST", url, body);
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await readBodyText(response);
      if (!response.ok) {
        throw new Error(formatHttpError(response.status, text));
      }
      return JSON.parse(text) as WorkflowAgentModelActivateResponse;
    },

    async postDraft(body: WorkflowAgentDraftRequest): Promise<WorkflowAgentDraftResponse> {
      const b = requireBase();
      const url = joinBaseAndPath(b, agentPath("/draft"));
      logDev("POST", url, {
        model: body.model,
        requestLength: body.request.length
      });
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await readBodyText(response);
      if (!response.ok) {
        throw new Error(formatHttpError(response.status, text));
      }
      const parsed = JSON.parse(text) as WorkflowAgentDraftResponse;
      if (typeof parsed !== "object" || parsed === null || typeof parsed.success !== "boolean") {
        throw new Error("Workflow Agent draft: invalid response shape");
      }
      return parsed;
    }
  };
}

/** 앱 기본 클라이언트 — `NEXT_PUBLIC_WORKFLOW_AGENT_BASE_URL` 사용 */
export const workflowAgentApi = createWorkflowAgentClient();
