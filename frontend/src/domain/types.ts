export type WorkflowState = "DRAFT" | "PUBLISHED";

export enum RunStatus {
  CREATED = "CREATED",
  RUNNING = "RUNNING",
  WAITING = "WAITING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  CANCELED = "CANCELED"
}

export enum NodeStatus {
  RUNNING = "RUNNING",
  WAITING = "WAITING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
  CANCELED = "CANCELED"
}

export type WorkflowVersionSummary = {
  versionId: string;
  versionNumber: string;
  publishedAt: string;
};

export type RunSummary = {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  startedAt: string;
  durationMs: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
};

export type WorkflowListItem = {
  workflowId: string;
  name: string;
  state: WorkflowState;
  latestVersion?: WorkflowVersionSummary | null;
  latestRun?: RunSummary | null;
};

export type WorkflowDraft = {
  workflowId: string;
  dsl_json: Record<string, unknown>;
  view_json: Record<string, unknown>;
  updatedAt: string;
};

export type NodeDebugBundle = {
  runId: string;
  stateName: string;
  nodeName: string;
  status: NodeStatus;
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  feedback: Record<string, unknown> | null;
  decision?: Record<string, unknown> | null;
};

export type RunEvent = {
  eventId: string;
  runId: string;
  seq: number;
  timestamp: string;
  eventType: string;
  stateName?: string | null;
  payload?: Record<string, unknown> | null;
};

export type ValidationError = {
  id: string;
  message: string;
  nodeId?: string | null;
};

export const RUN_TERMINAL_STATUSES = [
  RunStatus.SUCCESS,
  RunStatus.FAILED,
  RunStatus.CANCELED
];

export function isRunTerminal(status: RunStatus) {
  return RUN_TERMINAL_STATUSES.includes(status);
}

export function isRunActive(status: RunStatus) {
  return status === RunStatus.RUNNING || status === RunStatus.WAITING;
}

export type SkillParameter = {
  type: string;
  description: string;
};

export type SkillOutput = {
  type: string;
  description: string;
};

export type Skillset = {
  namespace: string;
  name: string;
  version: string;
  description: string;
  parameters: Record<string, SkillParameter>;
  outputs: Record<string, SkillOutput>;
  feedback: unknown[];
  pre_conditions: string[];
  post_effects: string[];
};

export type SkillsetsResponse = {
  skillsets: Skillset[];
};
