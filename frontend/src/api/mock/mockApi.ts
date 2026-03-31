import {
  nodeDebugBundles,
  nodeStateSnapshots,
  runEvents,
  runSummaries,
  workflowDrafts,
  workflowList,
  workflowVersions
} from "@/api/mock/data";
import {
  MiddlewareApi,
  WorkflowActionStatusRequest,
  WorkflowActionStatusResponse,
  RunnerStatusResponse,
  RunListFilters,
  RunSnapshot,
  RunsApi,
  SkillsetsApi,
  WorkflowsApi,
  WorkflowRunResponse
} from "@/api/interfaces";
import {
  NodeDebugBundle,
  NodeStatus,
  RunEvent,
  RunStatus,
  RunSummary,
  SkillsetsResponse,
  ValidationError,
  WorkflowDraft,
  WorkflowListItem,
  WorkflowVersionSummary
} from "@/domain/types";

const MOCK_DELAY_MS = 120;
const MOCK_NOW = "2026-01-22T09:00:00Z";
const WORKFLOW_FILES_STORAGE_KEY = "mock.workflow.files.v1";

function delay<T>(value: T, delayMs = MOCK_DELAY_MS) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), delayMs);
  });
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

type WorkflowFileEntry = {
  workflowId: string;
  fileName: string;
  dsl_json: Record<string, unknown>;
  view_json: Record<string, unknown>;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getWorkflowFileName(workflowId: string) {
  return `${workflowId}.asl.json`;
}

function readWorkflowFiles(): WorkflowFileEntry[] {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(WORKFLOW_FILES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => {
        if (!isRecord(entry)) return false;
        return (
          typeof entry.workflowId === "string" &&
          typeof entry.fileName === "string" &&
          typeof entry.updatedAt === "string"
        );
      })
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          workflowId: record.workflowId as string,
          fileName: record.fileName as string,
          updatedAt: record.updatedAt as string,
          dsl_json: isRecord(record.dsl_json) ? record.dsl_json : {},
          view_json: isRecord(record.view_json) ? record.view_json : {}
        };
      });
  } catch {
    return [];
  }
}

function writeWorkflowFiles(files: WorkflowFileEntry[]) {
  if (!canUseStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(
      WORKFLOW_FILES_STORAGE_KEY,
      JSON.stringify(files)
    );
  } catch {
    return;
  }
}

function upsertWorkflowFile(entry: WorkflowFileEntry) {
  const files = readWorkflowFiles();
  const index = files.findIndex(
    (item) => item.workflowId === entry.workflowId || item.fileName === entry.fileName
  );
  if (index >= 0) {
    files[index] = entry;
  } else {
    files.unshift(entry);
  }
  writeWorkflowFiles(files);
}

function findWorkflowFile(workflowId: string) {
  const normalizedId = workflowId.replace(/\.asl\.json$/i, "");
  const files = readWorkflowFiles();
  return (
    files.find((file) => file.workflowId === workflowId) ??
    files.find((file) => file.workflowId === normalizedId) ??
    files.find((file) => file.fileName === workflowId) ??
    null
  );
}

function createWorkflowId() {
  return `workflow-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
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
    const storedFiles = readWorkflowFiles();
    const storedItems: WorkflowListItem[] = storedFiles.map((file) => ({
      workflowId: file.workflowId,
      name: file.fileName,
      state: "DRAFT",
      latestVersion: null,
      latestRun: null
    }));
    const storedIds = new Set(storedItems.map((item) => item.workflowId));
    const merged = [
      ...storedItems,
      ...workflowList.filter((item) => !storedIds.has(item.workflowId))
    ];
    return delay(deepClone(merged));
  },

  async get(workflowId: string): Promise<WorkflowListItem> {
    const storedFiles = readWorkflowFiles();
    const stored = storedFiles.find((file) => file.workflowId === workflowId);
    const base =
      workflowList.find((item) => item.workflowId === workflowId) ??
      (stored
        ? ({
            workflowId: stored.workflowId,
            name: stored.fileName,
            state: "DRAFT",
            latestVersion: null,
            latestRun: null
          } as WorkflowListItem)
        : null);
    if (!base) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    return delay(deepClone(base));
  },
  async create(payload?: {
    name?: string;
    description?: string;
  }): Promise<WorkflowListItem> {
    const workflowId = createWorkflowId();
    const workflowName = payload?.name ?? "Untitled Workflow";
    const item: WorkflowListItem = {
      workflowId,
      name: workflowName,
      state: "DRAFT",
      latestVersion: null,
      latestRun: null
    };
    workflowList.unshift(item);
    workflowDrafts[workflowId] = {
      workflowId,
      dsl_json: {},
      view_json: {},
      updatedAt: new Date().toISOString()
    };
    return delay(deepClone(item));
  },

  async update(
    workflowId: string,
    payload: { name?: string; description?: string }
  ): Promise<WorkflowListItem> {
    const index = workflowList.findIndex((w) => w.workflowId === workflowId);
    if (index < 0) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    const current = workflowList[index];
    const updated: WorkflowListItem = {
      ...current,
      name: payload.name ?? current.name
    };
    workflowList[index] = updated;
    return delay(deepClone(updated));
  },
  async getDraft(workflowId: string): Promise<WorkflowDraft> {
    const stored = findWorkflowFile(workflowId);
    if (stored) {
      return delay(
        deepClone({
          workflowId: stored.workflowId,
          dsl_json: stored.dsl_json,
          view_json: stored.view_json,
          updatedAt: stored.updatedAt
        })
      );
    }
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
    const isNewWorkflow = workflowId === "new";
    const resolvedWorkflowId = isNewWorkflow ? createWorkflowId() : workflowId;
    const updatedAt = payload.updatedAt || new Date().toISOString();
    const entry: WorkflowFileEntry = {
      workflowId: resolvedWorkflowId,
      fileName: getWorkflowFileName(resolvedWorkflowId),
      dsl_json: payload.dsl_json ?? {},
      view_json: payload.view_json ?? {},
      updatedAt
    };
    upsertWorkflowFile(entry);
    workflowDrafts[resolvedWorkflowId] = {
      workflowId: resolvedWorkflowId,
      dsl_json: entry.dsl_json,
      view_json: entry.view_json,
      updatedAt: entry.updatedAt
    };
    if (!workflowList.some((item) => item.workflowId === resolvedWorkflowId)) {
      workflowList.unshift({
        workflowId: resolvedWorkflowId,
        name: entry.fileName,
        state: "DRAFT",
        latestVersion: null,
        latestRun: null
      });
    }
    return delay(deepClone(workflowDrafts[resolvedWorkflowId]));
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
  },

  async delete(workflowId: string): Promise<void> {
    // workflow 리스트에서 제거
    const index = workflowList.findIndex(
      (workflow) => workflow.workflowId === workflowId
    );
    if (index >= 0) {
      workflowList.splice(index, 1);
    }

    // draft 제거
    if (workflowDrafts[workflowId]) {
      delete workflowDrafts[workflowId];
    }

    // 로컬 스토리지에 저장된 파일 제거
    const files = readWorkflowFiles();
    const nextFiles = files.filter((file) => file.workflowId !== workflowId);
    writeWorkflowFiles(nextFiles);

    return delay(undefined);
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

// Mock state for workflow run (start/cancel). getRunnerStatus uses this.
let mockCurrentWorkflowRun: {
  workflow_id: string;
  status: "running" | "cancelled";
  started_at: string;
  updated_at: string;
  current_node: string;
  completed_states: string[];
  pending_states: string[];
} | null = null;

/** DSL from last mock start — used by getWorkflowDslJson for the live Monitor tab in mock mode. */
let mockLastStartedDsl: Record<string, unknown> | null = null;

function getMockRunnerStatus(): RunnerStatusResponse {
  if (!mockCurrentWorkflowRun || mockCurrentWorkflowRun.status !== "running") {
    return { runner_status: "idle" };
  }
  const w = mockCurrentWorkflowRun;
  return {
    runner_status: "running",
    workflow: {
      workflow_id: w.workflow_id,
      current_node: w.current_node,
      progress: {
        completed_states: w.completed_states,
        current_state: w.current_node,
        pending_states: w.pending_states
      },
      started_at: w.started_at,
      updated_at: w.updated_at
    }
  };
}

export const mockMiddlewareApi: MiddlewareApi = {
  async getRunnerStatus(): Promise<RunnerStatusResponse> {
    return delay(deepClone(getMockRunnerStatus()));
  },

  async getWorkflowDslJson(workflowId: string): Promise<Record<string, unknown>> {
    const current = mockCurrentWorkflowRun;
    if (
      !current ||
      current.workflow_id !== workflowId ||
      current.status !== "running" ||
      !mockLastStartedDsl
    ) {
      throw new Error("API error: 404 Workflow DSL not available in mock (start a run first)");
    }
    return delay(deepClone(mockLastStartedDsl));
  },

  async runWorkflowStart(workflowJson: Record<string, unknown>): Promise<WorkflowRunResponse> {
    // Optional: simulate validation error for empty or invalid workflow
    const states = workflowJson?.States as Record<string, unknown> | undefined;
    if (!states || typeof states !== "object" || Object.keys(states).length === 0) {
      const err = new Error("Invalid workflow JSON") as Error & {
        status?: number;
        body?: { error: string; message: string; details?: { state?: string; reason?: string } };
      };
      err.status = 400;
      err.body = {
        error: "validation error",
        message: "Invalid workflow JSON",
        details: { state: "", reason: "Workflow must have at least one state" }
      };
      throw err;
    }
    const workflow_id = `wf_${Date.now()}`;
    const now = new Date().toISOString();
    const stateNames = Object.keys(states);
    const startAt = (workflowJson.StartAt as string) ?? stateNames[0];
    mockCurrentWorkflowRun = {
      workflow_id,
      status: "running",
      started_at: now,
      updated_at: now,
      current_node: startAt,
      completed_states: [],
      pending_states: stateNames.filter((s) => s !== startAt)
    };
    mockLastStartedDsl = deepClone(workflowJson) as Record<string, unknown>;
    return delay(
      deepClone({
        workflow_id,
        status: "running"
      })
    );
  },

  async runWorkflowCancel(): Promise<WorkflowRunResponse> {
    const current = mockCurrentWorkflowRun;
    if (!current) {
      return delay(
        deepClone({
          workflow_id: `wf_${Date.now()}`,
          status: "cancelled"
        })
      );
    }
    const workflow_id = current.workflow_id;
    mockCurrentWorkflowRun = {
      ...current,
      status: "cancelled",
      updated_at: new Date().toISOString()
    };
    // runSummaries / nodeStateSnapshots 갱신해서 getSnapshot이 즉시 cancelled + 노드 not run 반환
    const run = runSummaries.find((r) => r.runId === workflow_id);
    if (run) {
      run.status = RunStatus.CANCELED;
    }
    const nodes = nodeStateSnapshots[workflow_id];
    if (Array.isArray(nodes)) {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].status === NodeStatus.RUNNING || nodes[i].status === NodeStatus.WAITING) {
          nodes[i] = { ...nodes[i], status: NodeStatus.CANCELED };
        }
      }
    }
    // After cancel, runner becomes idle (getRunnerStatus will return idle)
    const result: WorkflowRunResponse = { workflow_id, status: "cancelled" };
    setTimeout(() => {
      mockCurrentWorkflowRun = null;
      mockLastStartedDsl = null;
    }, 0);
    return delay(deepClone(result));
  },

  async postWorkflowActionStatus(
    payload: WorkflowActionStatusRequest
  ): Promise<WorkflowActionStatusResponse> {
    const results = (payload.statuses ?? []).map((s) => ({
      action_id: s.action_id,
      result: (s.status === "success" || s.status === "failure" ? "accepted" : "rejected") as
        | "accepted"
        | "rejected"
    }));
    return delay(deepClone({ results }));
  }
};

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
  },

  async startRun(
    workflowId: string,
    _runInput?: Record<string, unknown>
  ): Promise<RunSummary> {
    const workflow = workflowList.find((w) => w.workflowId === workflowId);
    if (!workflow || workflow.state !== "PUBLISHED") {
      throw new Error(`Workflow ${workflowId} not found or not published`);
    }
    const runId = `run-${Date.now()}`;
    const now = new Date().toISOString();
    const newRun: RunSummary = {
      runId,
      workflowId,
      workflowName: workflow.name,
      status: RunStatus.RUNNING,
      startedAt: now,
      durationMs: null
    };
    runSummaries.unshift(newRun);
    runEvents[runId] = [
      {
        eventId: `ev-${runId}`,
        runId,
        seq: 1,
        timestamp: now,
        eventType: "RUN_STARTED",
        payload: {}
      }
    ];
    nodeStateSnapshots[runId] = [];
    const wfIndex = workflowList.findIndex((w) => w.workflowId === workflowId);
    if (wfIndex >= 0) {
      workflowList[wfIndex] = {
        ...workflowList[wfIndex],
        latestRun: newRun
      };
    }
    return delay(deepClone(newRun));
  },

  async cancelRun(runId: string): Promise<RunSummary> {
    const run = runSummaries.find((r) => r.runId === runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (run.status === RunStatus.SUCCESS || run.status === RunStatus.FAILED || run.status === RunStatus.CANCELED) {
      return delay(deepClone(run));
    }
    run.status = RunStatus.CANCELED;
    const nodes = nodeStateSnapshots[runId];
    if (Array.isArray(nodes)) {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].status === NodeStatus.RUNNING || nodes[i].status === NodeStatus.WAITING) {
          nodes[i] = { ...nodes[i], status: NodeStatus.CANCELED };
        }
      }
    }
    const events = runEvents[runId] ?? [];
    const nextSeq = events.length > 0 ? Math.max(...events.map((e) => e.seq)) + 1 : 1;
    events.push({
      eventId: `event-cancel-${nextSeq}`,
      runId,
      seq: nextSeq,
      timestamp: new Date().toISOString(),
      eventType: "RUN_CANCELED",
      payload: { source: "backend_cancel" }
    });
    return delay(deepClone(run));
  }
};

export const mockSkillsetsApi: SkillsetsApi = {
  async list(): Promise<SkillsetsResponse> {
    const skillsets: SkillsetsResponse = {
      skill_sets: [
        {
          namespace: "default",
          name: "PickObject",
          version: "0.0.1",
          description: "Pick an object from a target location",
          allow_status_external_change: true,
          parameters: {
            target_object: {
              type: "string",
              description: "The target object identifier to pick"
            },
            location: {
              type: "string",
              description: "The location where the object is located"
            }
          },
          outputs: {
            object_weight: {
              type: "int",
              description: "The weight of the picked object in grams"
            }
          },
          feedback: [],
          pre_conditions: [
            "Object must be visible",
            "Gripper must be ready"
          ],
          post_effects: [
            "Object is held by gripper",
            "Location is now empty"
          ]
        },
        {
          namespace: "default",
          name: "PlaceObject",
          version: "0.0.1",
          description: "Place an object at a destination location",
          parameters: {
            target_object: {
              type: "string",
              description: "The object identifier to place"
            },
            destination: {
              type: "string",
              description: "The destination location identifier"
            },
            orientation: {
              type: "string",
              description: "The orientation of the object (north, south, east, west)"
            }
          },
          outputs: {
            placement_success: {
              type: "bool",
              description: "Whether the placement was successful"
            }
          },
          feedback: [],
          pre_conditions: [
            "Object must be held by gripper",
            "Destination must be available"
          ],
          post_effects: [
            "Object is placed at destination",
            "Gripper is now empty"
          ]
        },
        {
          namespace: "default",
          name: "MoveObject",
          version: "0.0.1",
          description: "Move an object from one location to another",
          parameters: {
            target_object: {
              type: "string",
              description: "The object identifier to move"
            },
            source_location: {
              type: "string",
              description: "The source location identifier"
            },
            target_location: {
              type: "string",
              description: "The target location identifier"
            }
          },
          outputs: {
            move_distance: {
              type: "float",
              description: "The distance moved in meters"
            },
            move_duration: {
              type: "int",
              description: "The time taken to move in milliseconds"
            }
          },
          feedback: [],
          pre_conditions: [
            "Object must exist at source location",
            "Target location must be available"
          ],
          post_effects: [
            "Object is now at target location",
            "Source location is now empty"
          ]
        }
      ]
    };
    return delay(deepClone(skillsets));
  }
};
