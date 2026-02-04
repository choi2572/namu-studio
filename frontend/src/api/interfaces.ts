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

// Middleware runner status (see docs/middleware_api_spec.md)
export type RunnerStatus = "idle" | "running" | "error";

export type RunnerWorkflowProgress = {
  completed_states: string[];
  current_state: string;
  pending_states: string[];
};

export type RunnerWorkflowInfo = {
  workflow_id: string;
  current_node?: string;
  progress?: RunnerWorkflowProgress;
  started_at: string;
  updated_at: string;
};

export type RunnerStatusResponse =
  | {
      runner_status: "idle";
    }
  | {
      runner_status: "running";
      workflow: RunnerWorkflowInfo;
    }
  | {
      runner_status: "error";
      error: string;
      details?: {
        error_code: string;
        error_message: string;
      };
    };

export interface WorkflowsApi {
  list(): Promise<WorkflowListItem[]>;
  create(payload?: { name?: string; description?: string }): Promise<WorkflowListItem>;
  getDraft(workflowId: string): Promise<WorkflowDraft>;
  saveDraft(workflowId: string, payload: WorkflowDraft): Promise<WorkflowDraft>;
  validateDraft(workflowId: string): Promise<ValidationError[]>;
  publish(workflowId: string): Promise<WorkflowVersionSummary>;
  delete(workflowId: string): Promise<void>;
}

export interface MiddlewareApi {
  /** 현재 미들웨어 runner의 상태를 조회 */
  getRunnerStatus(): Promise<RunnerStatusResponse>;
}

export interface RunsApi {
  list(filters?: RunListFilters): Promise<RunSummary[]>;
  get(runId: string): Promise<RunSummary>;
  getSnapshot(runId: string): Promise<RunSnapshot>;
  getNodeDebug(runId: string, stateName: string): Promise<NodeDebugBundle>;
  getEvents(runId: string, afterSeq: number): Promise<RunEvent[]>;
  /** Start a new run for a published workflow. Returns the new run summary. */
  startRun(workflowId: string, runInput?: Record<string, unknown>): Promise<RunSummary>;
}

export interface SkillsetsApi {
  list(): Promise<import("@/domain/types").SkillsetsResponse>;
}
