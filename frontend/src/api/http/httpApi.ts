import {
  NodeDebugBundle,
  RunEvent,
  RunSummary,
  SkillsetsResponse,
  ValidationError,
  WorkflowDraft,
  WorkflowListItem,
  WorkflowVersionSummary
} from "@/domain/types";
import {
  MiddlewareApi,
  RunnerStatusResponse,
  RunListFilters,
  RunSnapshot,
  RunsApi,
  SkillsetsApi,
  WorkflowActionStatusRequest,
  WorkflowActionStatusResponse,
  WorkflowsApi,
  WorkflowRunResponse
} from "@/api/interfaces";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api";

function getApiUrl(path: string): string {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`API error: ${response.status} ${errorText}`);
  }
  return response.json();
}

function logApiCall(method: string, url: string, data?: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.log(`[API] ${method} ${url}`, data ? { data } : "");
  }
}

export const httpMiddlewareApi: MiddlewareApi = {
  async getRunnerStatus(): Promise<RunnerStatusResponse> {
    // docs/middleware-api-spec.md - GET /api/v1/runner/status
    const url = getApiUrl("/v1/runner/status");
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<RunnerStatusResponse>(response);
  },

  async getWorkflowDslJson(workflowId: string): Promise<Record<string, unknown>> {
    const url = getApiUrl(`/v1/workflows/${encodeURIComponent(workflowId)}/json`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<Record<string, unknown>>(response);
  },

  async runWorkflowStart(workflowJson: Record<string, unknown>): Promise<WorkflowRunResponse> {
    const url = getApiUrl("/v1/workflows/run");
    logApiCall("POST", url, { request_type: "start" });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_type: "start", workflow_json: workflowJson })
    });
    if (!response.ok) {
      const text = await response.text();
      let body: {
        error?: string;
        message?: string;
        details?: { state?: string; reason?: string };
      } = {};
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`API error: ${response.status} ${text}`);
      }
      const msg = body.message || body.error || text || response.statusText;
      const err = new Error(msg) as Error & { status?: number; body?: typeof body };
      err.status = response.status;
      err.body = body;
      throw err;
    }
    return response.json();
  },

  async runWorkflowCancel(): Promise<WorkflowRunResponse> {
    const url = getApiUrl("/v1/workflows/run");
    logApiCall("POST", url, { request_type: "cancel" });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_type: "cancel" })
    });
    return handleResponse<WorkflowRunResponse>(response);
  },

  async postWorkflowActionStatus(
    payload: WorkflowActionStatusRequest
  ): Promise<WorkflowActionStatusResponse> {
    const url = getApiUrl("/v1/workflows/action-status");
    logApiCall("POST", url, payload);
    const controller = new AbortController();
    const timeoutMs = 10_000;
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      return handleResponse<WorkflowActionStatusResponse>(response);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
};

export const httpWorkflowsApi: WorkflowsApi = {
  async list(): Promise<WorkflowListItem[]> {
    const url = getApiUrl("/workflows");
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<WorkflowListItem[]>(response);
  },

  async get(workflowId: string): Promise<WorkflowListItem> {
    const url = getApiUrl(`/workflows/${workflowId}`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<WorkflowListItem>(response);
  },

  async create(payload?: { name?: string; description?: string }): Promise<WorkflowListItem> {
    const url = getApiUrl("/workflows");
    logApiCall("POST", url, payload);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: payload?.name,
        description: payload?.description
      })
    });
    return handleResponse<WorkflowListItem>(response);
  },

  async update(
    workflowId: string,
    payload: { name?: string; description?: string }
  ): Promise<WorkflowListItem> {
    const url = getApiUrl(`/workflows/${workflowId}`);
    logApiCall("PATCH", url, payload);
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    return handleResponse<WorkflowListItem>(response);
  },

  async getDraft(workflowId: string): Promise<WorkflowDraft> {
    const url = getApiUrl(`/workflows/${workflowId}/draft`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<WorkflowDraft>(response);
  },

  async saveDraft(workflowId: string, payload: WorkflowDraft): Promise<WorkflowDraft> {
    const url = getApiUrl(`/workflows/${workflowId}/draft`);
    logApiCall("PUT", url, payload);
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dsl_json: payload.dsl_json,
        view_json: payload.view_json
      })
    });
    return handleResponse<WorkflowDraft>(response);
  },

  async validateDraft(workflowId: string): Promise<ValidationError[]> {
    const url = getApiUrl(`/workflows/${workflowId}/validate`);
    logApiCall("POST", url);
    const response = await fetch(url, {
      method: "POST"
    });
    return handleResponse<ValidationError[]>(response);
  },

  async publish(workflowId: string): Promise<WorkflowVersionSummary> {
    const url = getApiUrl(`/workflows/${workflowId}/publish`);
    logApiCall("POST", url);
    const response = await fetch(url, {
      method: "POST"
    });
    return handleResponse<WorkflowVersionSummary>(response);
  },

  async delete(workflowId: string): Promise<void> {
    const url = getApiUrl(`/workflows/${workflowId}`);
    logApiCall("DELETE", url);
    const response = await fetch(url, {
      method: "DELETE"
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`API error: ${response.status} ${errorText}`);
    }
  }
};

export const httpSkillsetsApi: SkillsetsApi = {
  async list(): Promise<SkillsetsResponse> {
    const url = getApiUrl("/capabilities/skill-set");
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<SkillsetsResponse>(response);
  }
};

export const httpRunsApi: RunsApi = {
  async list(filters?: RunListFilters): Promise<RunSummary[]> {
    const params = new URLSearchParams();
    if (filters?.status) {
      params.append("status", filters.status);
    }
    if (filters?.workflowId) {
      params.append("workflowId", filters.workflowId);
    }
    if (filters?.timeRange) {
      params.append("timeRange", filters.timeRange);
    }
    const queryString = params.toString();
    const query = queryString ? `?${queryString}` : "";
    const url = getApiUrl(`/runs${query}`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<RunSummary[]>(response);
  },

  async get(runId: string): Promise<RunSummary> {
    const url = getApiUrl(`/runs/${runId}`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<RunSummary>(response);
  },

  async getSnapshot(runId: string): Promise<RunSnapshot> {
    const url = getApiUrl(`/runs/${runId}/snapshot`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<RunSnapshot>(response);
  },

  async getNodeDebug(runId: string, stateName: string): Promise<NodeDebugBundle> {
    const url = getApiUrl(`/runs/${runId}/nodes/${encodeURIComponent(stateName)}/debug`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<NodeDebugBundle>(response);
  },

  async getEvents(runId: string, afterSeq: number): Promise<RunEvent[]> {
    const params = new URLSearchParams();
    params.append("afterSeq", afterSeq.toString());
    const url = getApiUrl(`/runs/${runId}/events?${params.toString()}`);
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<RunEvent[]>(response);
  },

  async startRun(workflowId: string, runInput?: Record<string, unknown>): Promise<RunSummary> {
    const url = getApiUrl("/runs");
    logApiCall("POST", url, { workflowId, runInput });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId, runInput: runInput ?? {} })
    });
    const created = await handleResponse<{ runId: string; workflowId: string; status: string }>(
      response
    );
    return this.get(created.runId);
  },

  async cancelRun(runId: string): Promise<RunSummary> {
    const url = getApiUrl(`/runs/${runId}/cancel`);
    logApiCall("POST", url);
    const response = await fetch(url, { method: "POST" });
    await handleResponse<{ runId: string; status: string }>(response);
    return this.get(runId);
  }
};
