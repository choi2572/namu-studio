import { NodeStatus, RunEvent } from "@/domain/types";

export type SimulatedEvent = {
  event: RunEvent;
  nodeUpdate?: {
    stateName: string;
    status: NodeStatus;
  };
};

export const SIMULATED_EVENTS_BY_RUN: Record<string, SimulatedEvent[]> = {
  "run-100": [
    {
      event: {
        eventId: "event-004",
        runId: "run-100",
        seq: 4,
        timestamp: "2026-01-22T08:30:20Z",
        eventType: "NODE_SUCCEEDED",
        stateName: "ScanRack",
        payload: { durationMs: 4000 }
      },
      nodeUpdate: { stateName: "ScanRack", status: NodeStatus.SUCCEEDED }
    },
    {
      event: {
        eventId: "event-005",
        runId: "run-100",
        seq: 5,
        timestamp: "2026-01-22T08:30:26Z",
        eventType: "NODE_STARTED",
        stateName: "PickItem"
      },
      nodeUpdate: { stateName: "PickItem", status: NodeStatus.RUNNING }
    },
    {
      event: {
        eventId: "event-006",
        runId: "run-100",
        seq: 6,
        timestamp: "2026-01-22T08:30:40Z",
        eventType: "NODE_SUCCEEDED",
        stateName: "PickItem",
        payload: { durationMs: 9000 }
      },
      nodeUpdate: { stateName: "PickItem", status: NodeStatus.SUCCEEDED }
    },
    {
      event: {
        eventId: "event-007",
        runId: "run-100",
        seq: 7,
        timestamp: "2026-01-22T08:30:42Z",
        eventType: "NODE_STARTED",
        stateName: "PlaceItem"
      },
      nodeUpdate: { stateName: "PlaceItem", status: NodeStatus.RUNNING }
    },
    {
      event: {
        eventId: "event-008",
        runId: "run-100",
        seq: 8,
        timestamp: "2026-01-22T08:30:55Z",
        eventType: "NODE_WAITING",
        stateName: "PlaceItem"
      },
      nodeUpdate: { stateName: "PlaceItem", status: NodeStatus.WAITING }
    },
    {
      event: {
        eventId: "event-009",
        runId: "run-100",
        seq: 9,
        timestamp: "2026-01-22T08:31:02Z",
        eventType: "NODE_STARTED",
        stateName: "QualityGate"
      },
      nodeUpdate: { stateName: "QualityGate", status: NodeStatus.RUNNING }
    }
  ]
};
