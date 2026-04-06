import {
  NodeDebugBundle,
  NodeStatus,
  RunEvent,
  RunStatus,
  RunSummary,
  WorkflowDraft,
  WorkflowListItem,
  WorkflowVersionSummary
} from "@/domain/types";
import { NodeStateSnapshot } from "@/api/interfaces";

export const workflowVersions: Record<string, WorkflowVersionSummary> = {
  "workflow-002": {
    versionId: "version-003",
    versionNumber: "3",
    publishedAt: "2026-01-21T10:15:00Z"
  }
};

/** 백엔드 `app/seed.py` 시드 워크플로 개수(4)와 맞춤 — Mock 모드에서도 Total Workflows 카드가 E2E와 동일하게 보이도록 */
export const workflowList: WorkflowListItem[] = [
  {
    workflowId: "workflow-001",
    name: "Pick & Place Draft",
    state: "DRAFT",
    latestVersion: null,
    latestRun: null
  },
  {
    workflowId: "workflow-002",
    name: "Warehouse Cycle",
    state: "PUBLISHED",
    latestVersion: workflowVersions["workflow-002"],
    latestRun: {
      runId: "run-100",
      workflowId: "workflow-002",
      workflowName: "Warehouse Cycle",
      status: RunStatus.RUNNING,
      startedAt: "2026-01-22T08:30:00Z",
      durationMs: 540000,
      failureCode: null,
      failureMessage: null
    }
  },
  {
    workflowId: "workflow-003",
    name: "Seeded Condition + Parallel Workflow",
    state: "PUBLISHED",
    latestVersion: {
      versionId: "version-003",
      versionNumber: "v1",
      publishedAt: "2026-01-15T10:00:00Z"
    },
    latestRun: null
  },
  {
    workflowId: "workflow-004",
    name: "Seeded Wait Workflow",
    state: "PUBLISHED",
    latestVersion: {
      versionId: "version-004",
      versionNumber: "v1",
      publishedAt: "2026-01-15T11:00:00Z"
    },
    latestRun: null
  }
];

export const workflowDrafts: Record<string, WorkflowDraft> = {
  "workflow-001": {
    workflowId: "workflow-001",
    dsl_json: {
      StartAt: "Initialize",
      States: {
        Initialize: { Type: "Skill", Next: "PickItem" },
        PickItem: { Type: "Skill", Next: "PlaceItem" },
        PlaceItem: { Type: "Skill", End: true }
      }
    },
    view_json: {
      nodes: [
        { id: "Initialize", x: 120, y: 80 },
        { id: "PickItem", x: 320, y: 80 },
        { id: "PlaceItem", x: 520, y: 80 }
      ]
    },
    updatedAt: "2026-01-22T07:10:00Z"
  },
  "workflow-002": {
    workflowId: "workflow-002",
    dsl_json: {
      StartAt: "Boot",
      States: {
        Boot: { Type: "Skill", Next: "ScanRack" },
        ScanRack: { Type: "Skill", Next: "PickItem" },
        PickItem: { Type: "Skill", Next: "PlaceItem" },
        PlaceItem: { Type: "Skill", Next: "QualityGate" },
        QualityGate: {
          Type: "Condition",
          Choices: ["True", "False"],
          Next: "Finish"
        },
        Finish: { Type: "Skill", End: true }
      }
    },
    view_json: {
      nodes: [
        { id: "Boot", x: 80, y: 120 },
        { id: "ScanRack", x: 260, y: 120 },
        { id: "PickItem", x: 440, y: 120 },
        { id: "PlaceItem", x: 620, y: 120 },
        { id: "QualityGate", x: 800, y: 120 },
        { id: "Finish", x: 980, y: 120 }
      ]
    },
    updatedAt: "2026-01-21T09:45:00Z"
  }
};

export const runSummaries: RunSummary[] = [
  {
    runId: "run-100",
    workflowId: "workflow-002",
    workflowName: "Warehouse Cycle",
    status: RunStatus.RUNNING,
    startedAt: "2026-01-22T08:30:00Z",
    durationMs: 540000,
    failureCode: null,
    failureMessage: null
  },
  {
    runId: "run-099",
    workflowId: "workflow-002",
    workflowName: "Warehouse Cycle",
    status: RunStatus.FAILED,
    startedAt: "2026-01-22T06:10:00Z",
    durationMs: 240000,
    failureCode: "ARM_OVERLOAD",
    failureMessage: "Joint torque exceeded safe limit."
  },
  {
    runId: "run-098",
    workflowId: "workflow-002",
    workflowName: "Warehouse Cycle",
    status: RunStatus.SUCCESS,
    startedAt: "2026-01-21T21:40:00Z",
    durationMs: 420000,
    failureCode: null,
    failureMessage: null
  }
];

export const nodeStateSnapshots: Record<string, NodeStateSnapshot[]> = {
  "run-100": [
    {
      stateName: "Boot",
      nodeName: "Boot",
      status: NodeStatus.SUCCEEDED,
      durationMs: 2000
    },
    {
      stateName: "ScanRack",
      nodeName: "Scan Rack",
      status: NodeStatus.SUCCEEDED,
      durationMs: 4000
    },
    {
      stateName: "PickItem",
      nodeName: "Pick Item",
      status: NodeStatus.RUNNING,
      durationMs: null
    },
    {
      stateName: "PlaceItem",
      nodeName: "Place Item",
      status: NodeStatus.WAITING,
      durationMs: null
    },
    {
      stateName: "QualityGate",
      nodeName: "Quality Gate",
      status: NodeStatus.WAITING,
      durationMs: null
    }
  ],
  "run-099": [
    {
      stateName: "Boot",
      nodeName: "Boot",
      status: NodeStatus.SUCCEEDED,
      durationMs: 2000
    },
    {
      stateName: "ScanRack",
      nodeName: "Scan Rack",
      status: NodeStatus.SUCCEEDED,
      durationMs: 4000
    },
    {
      stateName: "PickItem",
      nodeName: "Pick Item",
      status: NodeStatus.FAILED,
      durationMs: 8000
    },
    {
      stateName: "PlaceItem",
      nodeName: "Place Item",
      status: NodeStatus.SKIPPED,
      durationMs: null
    }
  ],
  "run-098": [
    {
      stateName: "Boot",
      nodeName: "Boot",
      status: NodeStatus.SUCCEEDED,
      durationMs: 2000
    },
    {
      stateName: "ScanRack",
      nodeName: "Scan Rack",
      status: NodeStatus.SUCCEEDED,
      durationMs: 4000
    },
    {
      stateName: "PickItem",
      nodeName: "Pick Item",
      status: NodeStatus.SUCCEEDED,
      durationMs: 7000
    },
    {
      stateName: "PlaceItem",
      nodeName: "Place Item",
      status: NodeStatus.SUCCEEDED,
      durationMs: 6000
    }
  ]
};

export const nodeDebugBundles: Record<string, NodeDebugBundle[]> = {
  "run-100": [
    {
      runId: "run-100",
      stateName: "PickItem",
      nodeName: "Pick Item",
      status: NodeStatus.RUNNING,
      durationMs: null,
      input: { targetBin: "A3", gripStrength: "medium" },
      output: null,
      feedback: { note: "Aligning to target bin." }
    },
    {
      runId: "run-100",
      stateName: "PlaceItem",
      nodeName: "Place Item",
      status: NodeStatus.WAITING,
      durationMs: null,
      input: { dropZone: "Conveyor-2" },
      output: null,
      feedback: { waitingFor: "Conveyor ready signal" }
    }
  ],
  "run-099": [
    {
      runId: "run-099",
      stateName: "PickItem",
      nodeName: "Pick Item",
      status: NodeStatus.FAILED,
      durationMs: 8000,
      input: { targetBin: "A1", gripStrength: "high" },
      output: null,
      feedback: { error: "Torque overload detected." }
    }
  ],
  "run-098": [
    {
      runId: "run-098",
      stateName: "PlaceItem",
      nodeName: "Place Item",
      status: NodeStatus.SUCCEEDED,
      durationMs: 6000,
      input: { dropZone: "Conveyor-1" },
      output: { placed: true },
      feedback: { note: "Placement completed." }
    }
  ]
};

export const runEvents: Record<string, RunEvent[]> = {
  "run-100": [
    {
      eventId: "event-001",
      runId: "run-100",
      seq: 1,
      timestamp: "2026-01-22T08:30:02Z",
      eventType: "RUN_STARTED",
      payload: { operator: "auto" }
    },
    {
      eventId: "event-002",
      runId: "run-100",
      seq: 2,
      timestamp: "2026-01-22T08:30:05Z",
      eventType: "NODE_SUCCEEDED",
      stateName: "Boot",
      payload: { durationMs: 2000 }
    },
    {
      eventId: "event-003",
      runId: "run-100",
      seq: 3,
      timestamp: "2026-01-22T08:30:10Z",
      eventType: "NODE_STARTED",
      stateName: "ScanRack",
      payload: { attempt: 1 }
    }
  ],
  "run-099": [
    {
      eventId: "event-101",
      runId: "run-099",
      seq: 1,
      timestamp: "2026-01-22T06:10:00Z",
      eventType: "RUN_STARTED"
    },
    {
      eventId: "event-102",
      runId: "run-099",
      seq: 2,
      timestamp: "2026-01-22T06:12:20Z",
      eventType: "NODE_FAILED",
      stateName: "PickItem",
      payload: { code: "ARM_OVERLOAD" }
    },
    {
      eventId: "event-103",
      runId: "run-099",
      seq: 3,
      timestamp: "2026-01-22T06:14:00Z",
      eventType: "RUN_FAILED",
      payload: { code: "ARM_OVERLOAD" }
    }
  ],
  "run-098": [
    {
      eventId: "event-201",
      runId: "run-098",
      seq: 1,
      timestamp: "2026-01-21T21:40:00Z",
      eventType: "RUN_STARTED"
    },
    {
      eventId: "event-202",
      runId: "run-098",
      seq: 2,
      timestamp: "2026-01-21T21:46:20Z",
      eventType: "RUN_SUCCEEDED"
    }
  ]
};
