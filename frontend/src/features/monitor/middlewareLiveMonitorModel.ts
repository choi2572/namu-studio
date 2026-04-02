import type { MiddlewareNodeHistoryItem, RunnerWorkflowInfo } from "@/api/interfaces";
import type { NodeStateSnapshot } from "@/api/interfaces";
import type { RunEvent } from "@/domain/types";
import { NodeStatus, RunStatus } from "@/domain/types";
import type { GraphPatchPayload, MonitorGraph } from "./monitorGraph";

export function runnerStatusIndicatesActiveWorkflow(
  rs: { runner_status?: string; workflow?: RunnerWorkflowInfo | null } | null | undefined
): boolean {
  if (!rs?.workflow?.workflow_id) return false;
  const s = (rs.runner_status || "").toLowerCase();
  if (s === "idle" || s === "error") return false;
  return true;
}

export function extractNodeHistoryFromInitialPayload(data: Record<string, unknown>): MiddlewareNodeHistoryItem[] {
  const wf = data.workflow as Record<string, unknown> | null | undefined;
  const nested = wf?.node_history;
  const top = data.node_history;
  const raw = Array.isArray(nested) ? nested : Array.isArray(top) ? top : [];
  return raw as MiddlewareNodeHistoryItem[];
}

export function mapMiddlewareNodeStatus(status: string | undefined): NodeStatus {
  const u = (status || "").toUpperCase();
  if (u === "SUCCESS") return NodeStatus.SUCCEEDED;
  if (u === "FAILURE" || u === "FAILED") return NodeStatus.FAILED;
  if (u === "RUNNING") return NodeStatus.RUNNING;
  if (u === "SKIPPED") return NodeStatus.SKIPPED;
  if (u === "CANCELED" || u === "CANCELLED") return NodeStatus.CANCELED;
  if (u === "WAITING") return NodeStatus.WAITING;
  return NodeStatus.WAITING;
}

export function currentNodeNameFromWorkflow(wf: RunnerWorkflowInfo | null | undefined): string | null {
  if (!wf) return null;
  const cn = wf.current_node as unknown;
  if (typeof cn === "string") return cn || null;
  if (cn && typeof cn === "object" && cn !== null && "name" in cn) {
    const n = (cn as { name?: string }).name;
    if (typeof n === "string" && n) return n;
  }
  return wf.progress?.current_state || null;
}

export function baseNodesFromDsl(dsl: Record<string, unknown>): NodeStateSnapshot[] {
  const states = (dsl as { States?: Record<string, { Label?: string }> }).States;
  if (!states || typeof states !== "object") return [];
  return Object.entries(states).map(([stateName, st]) => ({
    stateName,
    nodeName: (typeof st?.Label === "string" ? st.Label : stateName) || stateName,
    status: NodeStatus.WAITING,
    durationMs: null
  }));
}

export function buildLiveNodeStatesFromInitial(
  dsl: Record<string, unknown>,
  wf: RunnerWorkflowInfo | null | undefined,
  historyFromPayload: MiddlewareNodeHistoryItem[],
  monitorGraph: MonitorGraph | null
): NodeStateSnapshot[] {
  const dslNodes = baseNodesFromDsl(dsl);
  const byName = new Map(dslNodes.map((n) => [n.stateName, { ...n }]));

  for (const item of historyFromPayload) {
    const name = item.node_name || item.name;
    if (!name) continue;
    const dur = typeof item.duration_ms === "number" ? item.duration_ms : null;
    const st = mapMiddlewareNodeStatus(item.status);
    const prev = byName.get(name);
    byName.set(name, {
      stateName: name,
      nodeName: prev?.nodeName ?? name,
      status: st,
      durationMs: dur
    });
  }

  const cur = currentNodeNameFromWorkflow(wf ?? null);
  if (cur) {
    const n = byName.get(cur);
    if (n && n.status !== NodeStatus.SUCCEEDED && n.status !== NodeStatus.FAILED) {
      byName.set(cur, { ...n, status: NodeStatus.RUNNING });
    }
  }

  const result: NodeStateSnapshot[] = Array.from(byName.values());
  if (monitorGraph) {
    const smap = new Map(result.map((n) => [n.stateName, n]));
    for (const mn of monitorGraph.nodes) {
      const key = mn.apiStateName;
      if (!smap.has(key)) {
        smap.set(key, {
          stateName: key,
          nodeName: mn.nodeName,
          status: NodeStatus.WAITING,
          durationMs: null
        });
      }
    }
    return Array.from(smap.values());
  }
  return result;
}

export function applyRunnerPollToNodeStates(
  nodes: NodeStateSnapshot[],
  wf: RunnerWorkflowInfo
): NodeStateSnapshot[] {
  const completed = new Set((wf.progress?.completed_states ?? []).filter(Boolean) as string[]);
  const cur =
    wf.progress?.current_state ||
    (typeof wf.current_node === "string" ? wf.current_node : currentNodeNameFromWorkflow(wf));

  return nodes.map((n) => {
    if (completed.has(n.stateName)) {
      if (n.status === NodeStatus.SUCCEEDED || n.status === NodeStatus.FAILED) return n;
      return { ...n, status: NodeStatus.SUCCEEDED };
    }
    if (cur && n.stateName === cur) {
      return { ...n, status: NodeStatus.RUNNING };
    }
    if (
      n.status === NodeStatus.SUCCEEDED ||
      n.status === NodeStatus.FAILED ||
      n.status === NodeStatus.SKIPPED ||
      n.status === NodeStatus.CANCELED
    ) {
      return n;
    }
    return { ...n, status: NodeStatus.WAITING };
  });
}

function isTerminalNodeStatus(s: NodeStatus): boolean {
  return (
    s === NodeStatus.SUCCEEDED ||
    s === NodeStatus.FAILED ||
    s === NodeStatus.CANCELED ||
    s === NodeStatus.SKIPPED
  );
}

/**
 * Workflow terminal 이벤트 처리용 보정.
 * WS에서 `node_status_change`가 누락되더라도, RUNNING/WAITING 노드를
 * workflow terminal 결과에 맞춰 강제로 마감한다.
 */
export function applyTerminalWorkflowToNodeStates(
  nodes: NodeStateSnapshot[],
  wf: RunnerWorkflowInfo,
  finalRunStatus: RunStatus
): NodeStateSnapshot[] {
  const completed = new Set((wf.progress?.completed_states ?? []).filter(Boolean) as string[]);
  const pending = new Set((wf.progress?.pending_states ?? []).filter(Boolean) as string[]);

  // node_history가 있으면 "정확한 종료 상태"를 우선한다.
  // 단, node_history가 RUNNING 같은 미종료 상태로 남아있을 수 있으니
  // 그 경우에는 terminal 보정(아래 completed/pending 기반)을 덮어쓴다.
  const historyStatusByNodeName = new Map<string, NodeStatus>();
  for (const h of wf.node_history ?? []) {
    const name = h.node_name || h.name;
    if (!name) continue;
    const mapped = mapMiddlewareNodeStatus(h.status);
    if (isTerminalNodeStatus(mapped)) {
      historyStatusByNodeName.set(name, mapped);
    }
  }

  const pendingStatusForRun =
    finalRunStatus === RunStatus.CANCELED
      ? NodeStatus.CANCELED
      : finalRunStatus === RunStatus.FAILED
        ? NodeStatus.SKIPPED
        : NodeStatus.SUCCEEDED;

  return nodes.map((n) => {
    const fromHistory = historyStatusByNodeName.get(n.stateName);
    if (fromHistory) return { ...n, status: fromHistory };

    if (pending.has(n.stateName)) {
      return { ...n, status: pendingStatusForRun };
    }

    if (completed.has(n.stateName)) {
      // completed_states는 보통 성공/완료된 상태이므로 SUCCEEDED로 마감한다.
      // 실패 노드는 node_history에 FAILED가 찍히는 케이스가 많아, 그 경우는 위 history 우선으로 처리된다.
      return { ...n, status: NodeStatus.SUCCEEDED };
    }

    // spec상 workflow terminal 시점에는 node_status_change가 누락될 수 있다.
    // 그 경우 progress.pending/completed가 "현재 화면에 있는 모든 RUNNING 노드"를
    // 포함하지 못할 수 있으므로, 최소한 현재 RUNNING인 노드는 terminal 결과로 마감한다.
    if (n.status === NodeStatus.RUNNING) {
      return { ...n, status: pendingStatusForRun };
    }

    return n;
  });
}

export function applyNodeStatusChangeMessage(
  prev: NodeStateSnapshot[],
  msg: Record<string, unknown>,
  monitorGraph: MonitorGraph | null
): NodeStateSnapshot[] {
  const nodeName = typeof msg.node_name === "string" ? msg.node_name : null;
  if (!nodeName) return prev;

  const incomingStatus = typeof msg.status === "string" ? msg.status : null;
  const prevMw = typeof msg.prev_status === "string" ? msg.prev_status : null;
  let nextStatus: NodeStatus;
  if (incomingStatus) {
    nextStatus = mapMiddlewareNodeStatus(incomingStatus);
  } else if (prevMw === "IDLE" || prevMw === "WAITING") {
    nextStatus = NodeStatus.RUNNING;
  } else {
    nextStatus = NodeStatus.RUNNING;
  }

  const durationMs =
    typeof msg.duration_ms === "number" && msg.duration_ms >= 0 ? msg.duration_ms : null;

  const resolveKey = (name: string) => {
    const direct = prev.find((n) => n.stateName === name);
    if (direct) return direct.stateName;
    if (monitorGraph) {
      const mn = monitorGraph.nodes.find((x) => x.apiStateName === name || x.stateName === name);
      if (mn) return mn.apiStateName;
    }
    return name;
  };

  const key = resolveKey(nodeName);
  const map = new Map(prev.map((n) => [n.stateName, { ...n }]));
  const existing = map.get(key);
  map.set(key, {
    stateName: key,
    nodeName: existing?.nodeName ?? nodeName,
    status: nextStatus,
    durationMs: durationMs ?? existing?.durationMs ?? null
  });
  return Array.from(map.values());
}

export function workflowCompletedRunStatus(msg: Record<string, unknown>): RunStatus {
  const s = String(msg.status || "").toLowerCase();
  if (s === "failed" || s === "failure") return RunStatus.FAILED;
  if (s === "cancelled" || s === "canceled") return RunStatus.CANCELED;
  return RunStatus.SUCCESS;
}

/** Maps middleware monitor WS `node_status_change` to a run timeline row (seq assigned by caller). */
export function runEventFromMiddlewareNodeStatusChange(
  runId: string,
  workflowId: string,
  msg: Record<string, unknown>,
  opts: { seq: number; eventId: string }
): RunEvent {
  const tsRaw = msg.timestamp;
  let timestamp: string;
  if (typeof tsRaw === "number") {
    timestamp = new Date(tsRaw > 1e12 ? tsRaw : tsRaw * 1000).toISOString();
  } else if (typeof tsRaw === "string") {
    timestamp = tsRaw;
  } else {
    timestamp = new Date().toISOString();
  }
  const node = String(msg.node_name || "");
  const st = String(msg.status || "").toUpperCase();
  let eventType = "NODE_STARTED";
  if (st === "SUCCESS") eventType = "NODE_SUCCEEDED";
  else if (st === "FAILURE" || st === "FAILED") eventType = "NODE_FAILED";
  else if (st === "SKIPPED") eventType = "NODE_SKIPPED";
  else if (st === "CANCELED" || st === "CANCELLED") eventType = "NODE_CANCELED";
  else if (st === "WAITING") eventType = "NODE_WAITING";

  const durationMs = typeof msg.duration_ms === "number" ? msg.duration_ms : undefined;
  return {
    eventId: opts.eventId,
    runId,
    seq: opts.seq,
    timestamp,
    eventType,
    stateName: node || null,
    payload: durationMs != null ? { durationMs } : {}
  };
}

/** Align middleware `node_name` with monitor / OnFailure set keys (apiStateName when graph is known). */
export function resolveTimelineStateNameFromMiddleware(
  nodeName: string,
  monitorGraph: MonitorGraph | null,
  nodeStatesFallback: Array<{ stateName: string }>
): string {
  const direct = nodeStatesFallback.find((n) => n.stateName === nodeName);
  if (direct) return direct.stateName;
  if (monitorGraph) {
    const mn = monitorGraph.nodes.find((x) => x.apiStateName === nodeName || x.stateName === nodeName);
    if (mn) return mn.apiStateName;
  }
  return nodeName;
}

export function parseGraphPatchMessage(msg: Record<string, unknown>): GraphPatchPayload | null {
  if ((msg.type || "").toString().toLowerCase() !== "graph_patch") return null;
  return msg as unknown as GraphPatchPayload;
}

export function parseInitialWorkflow(data: Record<string, unknown>): RunnerWorkflowInfo | null {
  const wf = data.workflow;
  if (!wf || typeof wf !== "object") return null;
  const w = wf as RunnerWorkflowInfo;
  if (!w.workflow_id) return null;
  return w;
}
