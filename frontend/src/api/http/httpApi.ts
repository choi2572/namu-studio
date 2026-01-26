import {
  NodeDebugBundle,
  RunEvent,
  RunStatus,
  RunSummary,
  ValidationError,
  WorkflowDraft,
  WorkflowListItem,
  WorkflowVersionSummary
} from "@/domain/types";
import { RunListFilters, RunSnapshot, RunsApi, WorkflowsApi } from "@/api/interfaces";

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

export const httpWorkflowsApi: WorkflowsApi = {
  async list(): Promise<WorkflowListItem[]> {
    const url = getApiUrl("/workflows");
    logApiCall("GET", url);
    const response = await fetch(url);
    return handleResponse<WorkflowListItem[]>(response);
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
    const url = getApiUrl(`/runs${queryString ? `?${queryString}` : ""}`);
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
  }
};
