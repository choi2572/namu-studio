import {
  NodeDebugBundle,
  NodeStatus,
  RunEvent,
  RunStatus,
  RunSummary,
  ValidationError,
  WorkflowDraft,
  WorkflowListItem,
  WorkflowVersionSummary
} from "@/domain/types";

export type RunListFilters = {
  status?: RunStatus;
  workflowId?: string;
  timeRange?: "24h" | "7d" | "30d" | "all";
};

export type NodeStateSnapshot = {
  stateName: string;
  nodeName: string;
  status: NodeStatus;
  durationMs: number | null;
};

export type RunSnapshot = {
  run: RunSummary;
  workflowName: string;
  nodeStates: NodeStateSnapshot[];
};

// Middleware runner status (see docs/middleware-api-spec.md + live monitor contract)
export type RunnerStatusValue =
  | "idle"
  | "running"
  | "paused"
  | "unspecified"
  | "unknown"
  | "error";

/** @deprecated use RunnerStatusValue */
export type RunnerStatus = "idle" | "running" | "error";

export type RunnerWorkflowProgress = {
  completed_states: string[];
  current_state: string;
  pending_states: string[];
};

/** Single node entry from middleware monitor / runner APIs. */
export type MiddlewareNodeHistoryItem = {
  node_name?: string;
  name?: string;
  status?: string;
  started_at?: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  input?: Record<string, unknown>;
  output?: Record<string, unknown> | null;
};

export type RunnerWorkflowInfo = {
  workflow_id: string;
  current_node?: string;
  progress?: RunnerWorkflowProgress;
  started_at: string;
  updated_at: string;
  /** Present on some monitor `initial` payloads (nested history). */
  node_history?: MiddlewareNodeHistoryItem[];
  execution_stats?: Record<string, unknown>;
};

/**
 * Runner status JSON from GET /api/v1/runner/status (shape varies by middleware version).
 * When `runner_status` is `running` or `paused`, `workflow` may describe the active run.
 */
export type RunnerStatusResponse = {
  runner_status: RunnerStatusValue;
  workflow?: RunnerWorkflowInfo | null;
  error?: string;
  details?: {
    error_code: string;
    error_message: string;
  };
};

// POST /api/v1/workflows/run (docs/middleware-api-spec.md)
export type WorkflowRunStartPayload = {
  request_type: "start";
  workflow_json: Record<string, unknown>;
};

export type WorkflowRunCancelPayload = {
  request_type: "cancel";
};

export type WorkflowRunResponse = {
  workflow_id: string;
  status: "running" | "cancelled";
};

export type WorkflowActionStatusItem = {
  action_id: string;
  status: "success" | "failure";
  reason: string;
};

export type WorkflowActionStatusRequest = {
  statuses: WorkflowActionStatusItem[];
};

export type WorkflowActionStatusResult = {
  action_id: string;
  result: "accepted" | "rejected";
};

export type WorkflowActionStatusResponse = {
  results: WorkflowActionStatusResult[];
};

export type WorkflowRunValidationError = {
  error: string;
  message: string;
  details?: {
    state?: string;
    reason?: string;
  };
};

export interface WorkflowsApi {
  list(): Promise<WorkflowListItem[]>;
  create(payload?: { name?: string; description?: string }): Promise<WorkflowListItem>;
  /** 단일 워크플로우 메타 조회 (name/description 등) */
  get(workflowId: string): Promise<WorkflowListItem>;
  /** 워크플로우 메타(name/description) 수정 */
  update(
    workflowId: string,
    payload: {
      name?: string;
      description?: string;
    }
  ): Promise<WorkflowListItem>;
  getDraft(workflowId: string): Promise<WorkflowDraft>;
  saveDraft(workflowId: string, payload: WorkflowDraft): Promise<WorkflowDraft>;
  validateDraft(workflowId: string): Promise<ValidationError[]>;
  publish(workflowId: string): Promise<WorkflowVersionSummary>;
  delete(workflowId: string): Promise<void>;
}

export interface MiddlewareApi {
  /** 현재 미들웨어 runner의 상태를 조회 */
  getRunnerStatus(): Promise<RunnerStatusResponse>;
  /** GET /api/v1/workflows/{workflow_id}/json — DSL JSON for live monitor (proxied via backend). */
  getWorkflowDslJson(workflowId: string): Promise<Record<string, unknown>>;
  /** 워크플로우 실행 시작 (POST /api/v1/workflows/run, request_type: start) */
  runWorkflowStart(workflowJson: Record<string, unknown>): Promise<WorkflowRunResponse>;
  /** 워크플로우 실행 취소 (POST /api/v1/workflows/run, request_type: cancel) */
  runWorkflowCancel(): Promise<WorkflowRunResponse>;
  /** 액션 상태 변경 요청 (POST /api/v1/workflows/action-status) */
  postWorkflowActionStatus(payload: WorkflowActionStatusRequest): Promise<WorkflowActionStatusResponse>;
}

export interface RunsApi {
  list(filters?: RunListFilters): Promise<RunSummary[]>;
  get(runId: string): Promise<RunSummary>;
  getSnapshot(runId: string): Promise<RunSnapshot>;
  getNodeDebug(runId: string, stateName: string): Promise<NodeDebugBundle>;
  getEvents(runId: string, afterSeq: number): Promise<RunEvent[]>;
  /** Start a new run for a published workflow. Returns the new run summary. */
  startRun(workflowId: string, runInput?: Record<string, unknown>): Promise<RunSummary>;
  /** Cancel a run (backend DB + execution engine). */
  cancelRun(runId: string): Promise<RunSummary>;
}

export interface SkillsetsApi {
  list(): Promise<import("@/domain/types").SkillsetsResponse>;
}
