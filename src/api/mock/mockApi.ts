import {
  nodeDebugBundles,
  nodeStateSnapshots,
  runEvents,
  runSummaries,
  workflowDrafts,
  workflowList,
  workflowVersions
} from "@/api/mock/data";
import { RunListFilters, RunSnapshot, RunsApi, WorkflowsApi } from "@/api/interfaces";
import {
  NodeDebugBundle,
  NodeStatus,
  RunEvent,
  RunSummary,
  ValidationError,
  WorkflowDraft,
  WorkflowListItem,
  WorkflowVersionSummary
} from "@/domain/types";

const MOCK_DELAY_MS = 120;
const MOCK_NOW = "2026-01-22T09:00:00Z";

function delay<T>(value: T, delayMs = MOCK_DELAY_MS) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), delayMs);
  });
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const validationErrorsByWorkflow: Record<string, ValidationError[]> = {
  "workflow-001": [
    {
      id: "error-001",
      message: "Exactly one Start node is required.",
      nodeId: "Initialize"
    },
    {
      id: "error-002",
      message: "Condition node must have True/False branches.",
      nodeId: "QualityGate"
    }
  ],
  "workflow-002": []
};

export const mockWorkflowsApi: WorkflowsApi = {
  async list(): Promise<WorkflowListItem[]> {
    return delay(deepClone(workflowList));
  },
  async getDraft(workflowId: string): Promise<WorkflowDraft> {
    const draft = workflowDrafts[workflowId];
    if (draft) {
      return delay(deepClone(draft));
    }
    return delay({
      workflowId,
      dsl_json: {},
      view_json: {},
      updatedAt: MOCK_NOW
    });
  },
  async saveDraft(
    workflowId: string,
    payload: WorkflowDraft
  ): Promise<WorkflowDraft> {
    workflowDrafts[workflowId] = {
      ...payload,
      workflowId,
      updatedAt: payload.updatedAt || MOCK_NOW
    };
    return delay(deepClone(workflowDrafts[workflowId]));
  },
  async validateDraft(workflowId: string): Promise<ValidationError[]> {
    return delay(deepClone(validationErrorsByWorkflow[workflowId] ?? []));
  },
  async publish(workflowId: string): Promise<WorkflowVersionSummary> {
    const existingVersion = workflowVersions[workflowId];
    if (existingVersion) {
      return delay(deepClone(existingVersion));
    }
    const newVersion: WorkflowVersionSummary = {
      versionId: `version-${workflowId}`,
      versionNumber: "1",
      publishedAt: MOCK_NOW
    };
    workflowVersions[workflowId] = newVersion;
    const workflowIndex = workflowList.findIndex(
      (workflow) => workflow.workflowId === workflowId
    );
    if (workflowIndex >= 0) {
      workflowList[workflowIndex] = {
        ...workflowList[workflowIndex],
        state: "PUBLISHED",
        latestVersion: newVersion
      };
    }
    return delay(deepClone(newVersion));
  }
};

function applyRunFilters(runs: RunSummary[], filters?: RunListFilters) {
  if (!filters) {
    return runs;
  }
  return runs.filter((run) => {
    if (filters.status && run.status !== filters.status) {
      return false;
    }
    if (filters.workflowId && run.workflowId !== filters.workflowId) {
      return false;
    }
    return true;
  });
}

export const mockRunsApi: RunsApi = {
  async list(filters?: RunListFilters): Promise<RunSummary[]> {
    const filtered = applyRunFilters(runSummaries, filters);
    return delay(deepClone(filtered));
  },
  async get(runId: string): Promise<RunSummary> {
    const run = runSummaries.find((item) => item.runId === runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return delay(deepClone(run));
  },
  async getSnapshot(runId: string): Promise<RunSnapshot> {
    const run = runSummaries.find((item) => item.runId === runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const nodeStates = nodeStateSnapshots[runId] ?? [];
    return delay(
      deepClone({
        run,
        workflowName: run.workflowName,
        nodeStates
      })
    );
  },
  async getNodeDebug(runId: string, stateName: string): Promise<NodeDebugBundle> {
    const bundle = (nodeDebugBundles[runId] ?? []).find(
      (item) => item.stateName === stateName
    );
    if (!bundle) {
      return delay({
        runId,
        stateName,
        nodeName: stateName,
        status: NodeStatus.WAITING,
        durationMs: null,
        input: null,
        output: null,
        feedback: null
      });
    }
    return delay(deepClone(bundle));
  },
  async getEvents(runId: string, afterSeq: number): Promise<RunEvent[]> {
    const events = runEvents[runId] ?? [];
    return delay(deepClone(events.filter((event) => event.seq > afterSeq)));
  }
};
