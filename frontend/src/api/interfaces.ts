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

export interface WorkflowsApi {
  list(): Promise<WorkflowListItem[]>;
  create(payload?: { name?: string; description?: string }): Promise<WorkflowListItem>;
  getDraft(workflowId: string): Promise<WorkflowDraft>;
  saveDraft(workflowId: string, payload: WorkflowDraft): Promise<WorkflowDraft>;
  validateDraft(workflowId: string): Promise<ValidationError[]>;
  publish(workflowId: string): Promise<WorkflowVersionSummary>;
  delete(workflowId: string): Promise<void>;
}

export interface RunsApi {
  list(filters?: RunListFilters): Promise<RunSummary[]>;
  get(runId: string): Promise<RunSummary>;
  getSnapshot(runId: string): Promise<RunSnapshot>;
  getNodeDebug(runId: string, stateName: string): Promise<NodeDebugBundle>;
  getEvents(runId: string, afterSeq: number): Promise<RunEvent[]>;
}

export interface SkillsetsApi {
  list(): Promise<import("@/domain/types").SkillsetsResponse>;
}
