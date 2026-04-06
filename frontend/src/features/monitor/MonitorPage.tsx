"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { middlewareApi, runsApi, skillsetsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { NodeStateSnapshot } from "@/api/interfaces";
import {
  isRunActive,
  isRunTerminal,
  NodeStatus,
  RunEvent,
  RunStatus,
  RunSummary
} from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { pathIdToApiStateName } from "@/lib/ids";
import { SIMULATED_EVENTS_BY_RUN } from "@/features/monitor/simulatedEvents";
import {
  buildMonitorGraph,
  applyGraphPatches,
  collectOnFailureApiStateNames,
  type GraphPatchPayload
} from "@/features/monitor/monitorGraph";
import {
  resolveTimelineStateNameFromMiddleware,
  runEventFromMiddlewareNodeStatusChange
} from "@/features/monitor/middlewareLiveMonitorModel";
import { getMonitorWebSocketUrl } from "@/lib/middlewareWsUrl";
import { ENABLE_DYNAMIC_GRAPH_PATCH } from "@/lib/featureFlags";
import { DagView } from "@/features/monitor/DagView";
import { TimelineTable } from "@/features/monitor/TimelineTable";
import {
  ActionStatusToast,
  ACTION_STATUS_TOAST_DISMISS_MS,
  isFetchAbortError,
  type ActionStatusToastState
} from "@/features/monitor/ActionStatusToast";
import { skillNodeAllowsExternalStatusChange } from "@/features/monitor/skillsetExternalStatus";

type MonitorPageProps = {
  runId: string;
};

function getNextSeq(events: RunEvent[]) {
  if (events.length === 0) {
    return 1;
  }
  return Math.max(...events.map((event) => event.seq)) + 1;
}

/** Keeps middleware WS tail rows across run-events polling. */
function mergeServerRunEventsWithLive(server: RunEvent[], prev: RunEvent[]): RunEvent[] {
  const live = prev.filter(
    (e) =>
      e.eventId.startsWith("mw-live-") ||
      e.eventId.startsWith("mw-onfailure-entry-")
  );
  const byId = new Map<string, RunEvent>();
  for (const e of server) byId.set(e.eventId, e);
  for (const e of live) byId.set(e.eventId, e);
  return Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
}

const MONITOR_PAGE_WS_PING_MS = 25_000;
const MONITOR_PAGE_WS_RECONNECT_MS = 3000;

/** DSL 기준 노드 대분류 (Timeline 뱃지용) */
function getNodeTypeCategory(
  dslType: string,
  containerType: "repeat" | "parallel" | null
): string {
  if (containerType === "repeat" || containerType === "parallel") return "Flow Control";
  const t = dslType ?? "";
  if (t === "Skill") return "Skill";
  if (t === "Condition" || t === "Choice" || t === "Repeat" || t === "Parallel") return "Flow Control";
  if (t === "Wait" || t === "Event") return "Event";
  return "Flow Control";
}

function getNextTimestamp(events: RunEvent[], fallback: string) {
  const last = events[events.length - 1]?.timestamp ?? fallback;
  const date = new Date(last);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  date.setSeconds(date.getSeconds() + 5);
  return date.toISOString();
}

/** Replay: apply events in order to initial (all WAITING) node states */
function applyEventsToNodeStates(
  baseNodes: NodeStateSnapshot[],
  eventsToApply: RunEvent[]
): NodeStateSnapshot[] {
  const byStateName = new Map<string, NodeStateSnapshot>();
  baseNodes.forEach((n) => byStateName.set(n.stateName, { ...n }));

  function findNode(evStateName: string): NodeStateSnapshot | undefined {
    const direct = byStateName.get(evStateName);
    if (direct) return direct;
    for (const [, node] of byStateName) {
      if (node.stateName === evStateName || node.stateName.endsWith("/" + evStateName)) return node;
    }
    return undefined;
  }

  eventsToApply.forEach((ev) => {
    const stateName = ev.stateName ?? (ev.payload as { stateName?: string } | undefined)?.stateName;
    if (!stateName) return;
    const node = findNode(stateName);
    if (!node) return;

    const key = node.stateName;
    switch (ev.eventType) {
      case "NODE_STARTED":
        byStateName.set(key, { ...node, status: NodeStatus.RUNNING });
        break;
      case "NODE_SUCCEEDED": {
        const durationMs = (ev.payload as { durationMs?: number } | undefined)?.durationMs ?? null;
        byStateName.set(key, { ...node, status: NodeStatus.SUCCEEDED, durationMs });
        break;
      }
      case "NODE_FAILED":
        byStateName.set(key, { ...node, status: NodeStatus.FAILED });
        break;
      case "NODE_WAITING":
        byStateName.set(key, { ...node, status: NodeStatus.WAITING });
        break;
      case "NODE_SKIPPED":
        byStateName.set(key, { ...node, status: NodeStatus.SKIPPED });
        break;
      case "NODE_CANCELED":
        byStateName.set(key, { ...node, status: NodeStatus.CANCELED });
        break;
      default:
        break;
    }
  });

  return baseNodes.map((n) => byStateName.get(n.stateName) ?? n);
}

/** Condition pathId -> "then" | "else" for the branch that was actually taken (from event order). */
function computeTakenBranches(
  monitorGraph: ReturnType<typeof buildMonitorGraph>,
  events: RunEvent[]
): Map<string, "then" | "else"> {
  const result = new Map<string, "then" | "else">();
  if (!monitorGraph || events.length === 0) return result;
  const sortedEvents = [...events].sort((a, b) => a.seq - b.seq);
  const conditionNodes = monitorGraph.nodes.filter((n) => n.dslType === "Condition");
  for (const cond of conditionNodes) {
    const outgoing = monitorGraph.edges.filter(
      (e) => e.from === cond.pathId && (e.conditionBranch === "then" || e.conditionBranch === "else")
    );
    if (outgoing.length === 0) continue;
    const thenEdge = outgoing.find((e) => e.conditionBranch === "then");
    const elseEdge = outgoing.find((e) => e.conditionBranch === "else");
    const thenToNode = thenEdge ? monitorGraph.nodes.find((n) => n.pathId === thenEdge.to) : null;
    const elseToNode = elseEdge ? monitorGraph.nodes.find((n) => n.pathId === elseEdge.to) : null;
    const condSucceededIdx = sortedEvents.findIndex(
      (ev) =>
        ev.eventType === "NODE_SUCCEEDED" &&
        (ev.stateName === cond.apiStateName || ev.stateName === cond.stateName)
    );
    if (condSucceededIdx < 0) continue;
    const firstStartedAfter = sortedEvents
      .slice(condSucceededIdx + 1)
      .find((ev) => ev.eventType === "NODE_STARTED");
    const startedStateName = firstStartedAfter?.stateName;
    if (!startedStateName) continue;
    const match = (node: { apiStateName: string; stateName: string } | null) =>
      node && (startedStateName === node.apiStateName || startedStateName === node.stateName);
    if (thenToNode && match(thenToNode)) result.set(cond.pathId, "then");
    else if (elseToNode && match(elseToNode)) result.set(cond.pathId, "else");
  }
  return result;
}

export function MonitorPage({ runId }: MonitorPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const isReplayMode = searchParams.get("mode") === "replay";
  const { data: snapshot } = useQuery({
    queryKey: ["run-snapshot", runId],
    queryFn: () => runsApi.getSnapshot(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      if (status == null) return 1500;
      if (isRunTerminal(status as RunStatus)) return false;
      return 1500;
    }
  });

  const { data: eventsData } = useQuery({
    queryKey: ["run-events", runId],
    queryFn: () => runsApi.getEvents(runId, 0),
    refetchInterval: () => {
      const snap = queryClient.getQueryData<{ run: { status?: string } }>(["run-snapshot", runId]);
      const status = snap?.run?.status;
      if (status == null) return 1500;
      if (isRunTerminal(status as RunStatus)) return false;
      return 1500;
    }
  });

  const [events, setEvents] = useState<RunEvent[]>([]);
  const [nodeStates, setNodeStates] = useState<NodeStateSnapshot[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [monitorWsReconnect, setMonitorWsReconnect] = useState(0);
  const [actionStatusInFlight, setActionStatusInFlight] = useState<
    null | "success" | "failure"
  >(null);
  const [actionStatusToast, setActionStatusToast] = useState<ActionStatusToastState | null>(null);
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const actionStatusSubmittingRef = useRef(false);
  const replayInitializedRef = useRef(false);
  const terminalRefetchDoneRef = useRef<string | null>(null);

  const simulationRef = useRef<{ runId: string; index: number }>({
    runId: "",
    index: 0
  });
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const timelineResolveStatesRef = useRef<NodeStateSnapshot[]>([]);
  const monitorGraphRef = useRef<ReturnType<typeof buildMonitorGraph>>(null);
  const onFailureNamesRef = useRef<Set<string>>(new Set());
  const onFailureEntryEmittedRef = useRef(false);
  const monitorWsMsgCounterRef = useRef(0);

  const debugStateName = useMemo(
    () => (selectedNode ? pathIdToApiStateName(selectedNode) : ""),
    [selectedNode]
  );

  const { data: nodeDebug } = useQuery({
    queryKey: ["node-debug", runId, debugStateName],
    queryFn: () => runsApi.getNodeDebug(runId, debugStateName),
    enabled: Boolean(selectedNode && debugStateName)
  });

  // Workflow draft 가져오기 (DSL에서 엣지 정보 추출용 + Monitor graph)
  const { data: workflowDraft } = useQuery({
    queryKey: ["workflow-draft", snapshot?.run.workflowId],
    queryFn: () => workflowsApi.getDraft(snapshot!.run.workflowId),
    enabled: Boolean(snapshot?.run.workflowId)
  });

  const { data: skillsetsResponse } = useQuery({
    queryKey: ["skillsets"],
    queryFn: () => skillsetsApi.list()
  });

  const baseMonitorGraph = useMemo(
    () => buildMonitorGraph(workflowDraft?.dsl_json),
    [workflowDraft?.dsl_json]
  );

  const graphPatchPayloads = useMemo((): GraphPatchPayload[] => {
    if (!ENABLE_DYNAMIC_GRAPH_PATCH || !events.length) return [];
    return events
      .filter((e) => e.eventType === "GRAPH_PATCH" && e.payload)
      .map((e) => e.payload as GraphPatchPayload)
      .filter((p) => p && (p.nodes_added != null || p.edges_added != null || (p.nodes_removed != null && p.nodes_removed.length > 0)));
  }, [events, ENABLE_DYNAMIC_GRAPH_PATCH]);

  const monitorGraph = useMemo(
    () =>
      ENABLE_DYNAMIC_GRAPH_PATCH && graphPatchPayloads.length > 0
        ? applyGraphPatches(baseMonitorGraph, graphPatchPayloads)
        : baseMonitorGraph,
    [baseMonitorGraph, graphPatchPayloads, ENABLE_DYNAMIC_GRAPH_PATCH]
  );

  const stateNameToPathId = useMemo(
    () => monitorGraph?.stateNameToPathId ?? new Map<string, string>(),
    [monitorGraph]
  );

  const onFailureApiStateNames = useMemo(
    () => collectOnFailureApiStateNames(workflowDraft?.dsl_json ?? null),
    [workflowDraft?.dsl_json]
  );

  useEffect(() => {
    monitorGraphRef.current = monitorGraph;
  }, [monitorGraph]);

  useEffect(() => {
    onFailureNamesRef.current = onFailureApiStateNames;
  }, [onFailureApiStateNames]);

  useEffect(() => {
    onFailureEntryEmittedRef.current = false;
  }, [runId]);

  useEffect(() => {
    setEvents([]);
  }, [runId]);

  useEffect(() => {
    timelineResolveStatesRef.current =
      snapshot?.nodeStates && snapshot.nodeStates.length > 0 ? snapshot.nodeStates : nodeStates;
  }, [snapshot?.nodeStates, nodeStates]);

  useEffect(() => {
    if (!snapshot) return;
    setNodeStates(snapshot.nodeStates);
    setRunStatus(snapshot.run.status);
  }, [snapshot]);

  useEffect(() => {
    if (eventsData === undefined) return;
    setEvents((prev) => mergeServerRunEventsWithLive(eventsData, prev));
  }, [runId, eventsData]);

  useEffect(() => {
    if (isReplayMode) return;
    const workflowId = snapshot?.run?.workflowId;
    if (!workflowId || runStatus == null || !isRunActive(runStatus)) {
      return;
    }

    let cancelled = false;
    let intentionalClose = false;
    monitorWsMsgCounterRef.current = 0;

    let ws: WebSocket;
    try {
      ws = new WebSocket(getMonitorWebSocketUrl());
    } catch {
      return;
    }

    const pushLive = (ev: RunEvent) => {
      setEvents((prev) => {
        if (prev.some((e) => e.eventId === ev.eventId)) return prev;
        const nextSeq = getNextSeq(prev);
        return [...prev, { ...ev, seq: nextSeq }].sort((a, b) => a.seq - b.seq);
      });
    };

    const pingTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* ignore */
        }
      }
    }, MONITOR_PAGE_WS_PING_MS);

    ws.onmessage = (event) => {
      if (cancelled) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(data.type || "").toLowerCase();
      if (type === "pong") return;
      const msgWid = typeof data.workflow_id === "string" ? data.workflow_id : null;
      if (!msgWid || msgWid !== workflowId) return;
      if (type !== "node_status_change") return;

      const nodeName = typeof data.node_name === "string" ? data.node_name : null;
      if (!nodeName) return;

      const resolved = resolveTimelineStateNameFromMiddleware(
        nodeName,
        monitorGraphRef.current,
        timelineResolveStatesRef.current
      );
      const onFailureSet = onFailureNamesRef.current;
      const st = String(data.status || "").toUpperCase();
      const isFailureFlowNode = onFailureSet.size > 0 && onFailureSet.has(resolved);
      const isTerminalStatus =
        st === "SUCCESS" ||
        st === "FAILURE" ||
        st === "FAILED" ||
        st === "SKIPPED" ||
        st === "CANCELED" ||
        st === "CANCELLED";
      const isStartLike = !isTerminalStatus;

      if (isFailureFlowNode && isStartLike && !onFailureEntryEmittedRef.current) {
        onFailureEntryEmittedRef.current = true;
        monitorWsMsgCounterRef.current += 1;
        const entryId = `mw-onfailure-entry-${runId}-${monitorWsMsgCounterRef.current}-${Date.now()}`;
        pushLive({
          eventId: entryId,
          runId,
          seq: 0,
          timestamp: new Date().toISOString(),
          eventType: "ON_FAILURE_FLOW_ENTERED",
          stateName: null,
          payload: { firstNode: resolved }
        });
      }

      monitorWsMsgCounterRef.current += 1;
      const evId = `mw-live-${workflowId}-${monitorWsMsgCounterRef.current}-${nodeName}-${st}-${Date.now()}`;
      pushLive(
        runEventFromMiddlewareNodeStatusChange(runId, workflowId, data, {
          seq: 0,
          eventId: evId
        })
      );
    };

    ws.onclose = () => {
      window.clearInterval(pingTimer);
      if (!cancelled && !intentionalClose) {
        window.setTimeout(() => setMonitorWsReconnect((n) => n + 1), MONITOR_PAGE_WS_RECONNECT_MS);
      }
    };

    return () => {
      cancelled = true;
      intentionalClose = true;
      window.clearInterval(pingTimer);
      ws.close();
    };
  }, [
    isReplayMode,
    snapshot?.run?.workflowId,
    runStatus,
    runId,
    monitorWsReconnect
  ]);

  useEffect(() => {
    if (!snapshot || runStatus !== RunStatus.RUNNING || isReplayMode) return;
    const pending = SIMULATED_EVENTS_BY_RUN[runId] ?? [];
    if (pending.length === 0) return;

    if (simulationRef.current.runId !== runId) {
      simulationRef.current = { runId, index: 0 };
    }

    const interval = setInterval(() => {
      const currentIndex = simulationRef.current.index;
      if (currentIndex >= pending.length) {
        clearInterval(interval);
        return;
      }
      const nextEvent = pending[currentIndex];
      simulationRef.current.index += 1;

      setEvents((prev) => {
        if (prev.some((event) => event.seq === nextEvent.event.seq)) {
          return prev;
        }
        return [...prev, nextEvent.event].sort((a, b) => a.seq - b.seq);
      });

      if (nextEvent.nodeUpdate) {
        setNodeStates((prev) =>
          prev.map((node) =>
            node.stateName === nextEvent.nodeUpdate?.stateName
              ? { ...node, status: nextEvent.nodeUpdate.status }
              : node
          )
        );
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [runId, runStatus, snapshot]);

  useEffect(() => {
    if (!autoScroll || !timelineRef.current) return;
    const el = timelineRef.current;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [events, autoScroll]);

  // Replay: when run is terminal (or replay mode) and events loaded, show end state initially
  useEffect(() => {
    if (runId && events.length > 0 && !replayInitializedRef.current) {
      const terminal = runStatus != null && isRunTerminal(runStatus);
      if (terminal || isReplayMode) {
        setReplayIndex(events.length - 1);
        replayInitializedRef.current = true;
      }
    }
  }, [runId, runStatus, events.length, isReplayMode]);
  useEffect(() => {
    replayInitializedRef.current = false;
    terminalRefetchDoneRef.current = null;
  }, [runId]);

  // Run이 terminal로 바뀐 직후 한 번 더 refetch해서 마지막 NODE_SUCCEEDED 등 누락 방지
  useEffect(() => {
    if (!runId || !runStatus || !isRunTerminal(runStatus)) return;
    if (terminalRefetchDoneRef.current === runId) return;
    terminalRefetchDoneRef.current = runId;
    const t = setTimeout(() => {
      queryClient.refetchQueries({ queryKey: ["run-snapshot", runId] });
      queryClient.refetchQueries({ queryKey: ["run-events", runId] });
    }, 400);
    return () => clearTimeout(t);
  }, [runId, runStatus, queryClient]);

  // stateName -> durationMs 매핑
  // 1순위: snapshot.nodeStates / nodeStates 에 저장된 durationMs (DB 기반, 가장 신뢰도 높음)
  // 2순위: NODE_SUCCEEDED 이벤트 payload.durationMs (middleware가 내려줄 경우 보정용)
  const durationByStateName = useMemo(() => {
    const map = new Map<string, number>();

    // 1) 스냅샷 기반 (RunService.get_run_snapshot → NodeRun.duration_ms)
    (snapshot?.nodeStates ?? nodeStates).forEach((n) => {
      if (typeof n.durationMs === "number" && n.durationMs >= 0) {
        map.set(n.stateName, n.durationMs);
      }
    });

    // 2) 이벤트 payload 기반 보정 (middleware가 NODE_SUCCEEDED에 duration_ms를 넣어줄 때)
    events.forEach((ev) => {
      if (ev.eventType !== "NODE_SUCCEEDED" || !ev.stateName) return;
      const payload = ev.payload as { durationMs?: number } | undefined;
      const d = payload?.durationMs;
      if (typeof d === "number" && d >= 0) {
        map.set(ev.stateName, d);
      }
    });

    return map;
  }, [snapshot?.nodeStates, nodeStates, events]);

  // Replay 재생 속도: timestamp는 완전히 무시하고, sequence + durationMs만으로 계산
  const replayDelays = useMemo(() => {
    if (events.length === 0) return [] as number[];
    // 기본 스텝 딜레이 (노드 실행이 없는 이벤트들)
    const baseDelay = 200;
    const delays = new Array<number>(events.length).fill(baseDelay);

    events.forEach((ev, idx) => {
      const stateName = ev.stateName;
      if (!stateName) return;
      if (ev.eventType === "NODE_STARTED") {
        const duration = durationByStateName.get(stateName);
        if (duration != null) {
          // 이 노드가 RUNNING 상태로 머무는 시간 = durationMs
          // NODE_STARTED → 다음 이벤트로 넘어갈 때까지 duration만큼 대기
          delays[idx] = duration;
        }
      }
    });

    return delays;
  }, [events, durationByStateName]);

  // Replay: advance index on interval when playing
  useEffect(() => {
    if (!replayPlaying || events.length === 0) return;
    if (replayIndex >= events.length - 1) {
      setReplayPlaying(false);
      return;
    }

    const delay = replayDelays[replayIndex] ?? 500;
    const timeout = setTimeout(() => {
      setReplayIndex((i) => {
        if (i >= events.length - 1) {
          setReplayPlaying(false);
          return events.length - 1;
        }
        return i + 1;
      });
    }, delay);

    return () => clearTimeout(timeout);
  }, [replayPlaying, replayIndex, events.length, replayDelays]);

  const handleCancel = async () => {
    if (cancelInFlight) return;
    setCancelInFlight(true);
    const startedAt = snapshot?.run.startedAt ?? new Date().toISOString();
    try {
      try {
        await middlewareApi.runWorkflowCancel();
      } catch (e) {
        console.error("Middleware cancel failed", e);
      }
      try {
        await runsApi.cancelRun(runId);
      } catch (e) {
        console.error("Backend cancel failed", e);
      }
      setRunStatus(RunStatus.CANCELED);
      // 즉시 캐시를 terminal로 갱신해서 refetchInterval이 폴링을 멈추도록 함
      queryClient.setQueryData(["run-snapshot", runId], (old: { run: RunSummary; workflowName: string; nodeStates: NodeStateSnapshot[] } | undefined) => {
        if (!old) return old;
        const updatedNodes = old.nodeStates.map((n) =>
          n.status === NodeStatus.RUNNING || n.status === NodeStatus.WAITING
            ? { ...n, status: NodeStatus.CANCELED }
            : n
        );
        return {
          ...old,
          run: { ...old.run, status: RunStatus.CANCELED },
          nodeStates: updatedNodes
        };
      });
      setNodeStates((prev) =>
        prev.map((n) =>
          n.status === NodeStatus.RUNNING || n.status === NodeStatus.WAITING
            ? { ...n, status: NodeStatus.CANCELED }
            : n
        )
      );
      setEvents((prev) => {
        const nextSeq = getNextSeq(prev);
        return [
          ...prev,
          {
            eventId: `event-cancel-${nextSeq}`,
            runId,
            seq: nextSeq,
            timestamp: getNextTimestamp(prev, startedAt),
            eventType: "RUN_CANCELED",
            payload: { source: "monitor" }
          }
        ];
      });
    } finally {
      setCancelInFlight(false);
    }
  };

  const isTerminal = runStatus ? isRunTerminal(runStatus) : false;
  const workflowName = snapshot?.workflowName ?? "Loading...";
  const runMeta = snapshot?.run;
  const workflowId = runMeta?.workflowId;

  // UI notes: Cancel button only when RUNNING, Replay controls only when finished
  const showCancel = runStatus === RunStatus.RUNNING && !isReplayMode;
  const showReplay = isTerminal || isReplayMode;
  const showRunFromTerminal = isTerminal && !isReplayMode && Boolean(workflowId);

  const rerunMutation = useMutation({
    mutationFn: async () => runsApi.startRun(workflowId!),
    onSuccess: (run) => {
      router.push(`/monitor/${run.runId}`);
    },
    onError: (error) => {
      console.error("Re-run failed", error);
    }
  });

  // DSL에서 엣지 정보 추출
  const edges = useMemo(() => {
    if (!workflowDraft?.dsl_json) {
      return [];
    }

    const dsl = workflowDraft.dsl_json as {
      StartAt?: string;
      States?: Record<
        string,
        { Next?: string; Choices?: Array<{ Next?: string }>; End?: boolean; Type?: string }
      >;
    };

    if (!dsl.States) {
      return [];
    }

    const edgeMap = new Map<string, { from: string; to: string }>();
    let edgeIndex = 0;

    // 모든 state를 순회하며 Next와 Choices에서 엣지 추출
    Object.entries(dsl.States).forEach(([stateName, state]) => {
      // 일반 Next 연결
      if (state.Next && typeof state.Next === "string") {
        const edgeKey = `${stateName}-${state.Next}`;
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            from: stateName,
            to: state.Next
          });
        }
      }

      // Choice (Condition)의 경우 Choices에서 엣지 추출
      // Choices는 객체 배열이며 각각 Next 속성을 가짐
      if (state.Choices && Array.isArray(state.Choices)) {
        state.Choices.forEach((choice) => {
          // Choices가 객체인 경우 (Next 속성 포함)
          if (typeof choice === "object" && choice !== null && "Next" in choice) {
            if (choice.Next && typeof choice.Next === "string") {
              const edgeKey = `${stateName}-${choice.Next}`;
              if (!edgeMap.has(edgeKey)) {
                edgeMap.set(edgeKey, {
                  from: stateName,
                  to: choice.Next
                });
              }
            }
          }
        });
      }
      
      // Condition 노드가 Next를 직접 가지는 경우도 처리 (mock data의 경우)
      if (state.Type === "Condition" && state.Next && typeof state.Next === "string") {
        const edgeKey = `${stateName}-${state.Next}`;
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            from: stateName,
            to: state.Next
          });
        }
      }
    });

    return Array.from(edgeMap.values()).map((edge) => ({
      id: `edge-${edgeIndex++}`,
      from: edge.from,
      to: edge.to
    }));
  }, [workflowDraft]);

  // 스냅샷이 있으면 즉시 사용(폴링 갱신이 한 렌더 지연 없이 DAG에 반영되도록)
  const latestNodeStates = snapshot?.nodeStates ?? nodeStates;

  // 모든 노드가 nodeStates에 있는지 확인하고, 없으면 DSL에서 추가. VLM 동적 노드 포함.
  const allNodes = useMemo(() => {
    if (!workflowDraft?.dsl_json) {
      return latestNodeStates;
    }

    const dsl = workflowDraft.dsl_json as {
      StartAt?: string;
      States?: Record<string, { Label?: string; Type?: string }>;
    };

    if (!dsl.States) {
      return latestNodeStates;
    }

    // DSL의 모든 state를 노드로 변환
    const dslNodes = Object.entries(dsl.States).map(([stateName, state]) => {
      const existingNode = latestNodeStates.find((n) => n.stateName === stateName);
      if (existingNode) return existingNode;
      return {
        stateName,
        nodeName: (state.Label as string) || stateName,
        status: NodeStatus.WAITING,
        durationMs: null
      } as NodeStateSnapshot;
    });

    const nodeMap = new Map<string, NodeStateSnapshot>();
    dslNodes.forEach((node) => nodeMap.set(node.stateName, node));
    latestNodeStates.forEach((node) => nodeMap.set(node.stateName, node));

    // VLM 동적 노드: patched graph에만 있는 노드 추가 (플래그 켜진 경우)
    if (ENABLE_DYNAMIC_GRAPH_PATCH && monitorGraph) {
      for (const n of monitorGraph.nodes) {
        if (nodeMap.has(n.apiStateName)) continue;
        const snap = latestNodeStates.find((s) => s.stateName === n.apiStateName);
        nodeMap.set(n.apiStateName, {
          stateName: n.apiStateName,
          nodeName: n.nodeName,
          status: snap?.status ?? NodeStatus.WAITING,
          durationMs: snap?.durationMs ?? null
        } as NodeStateSnapshot);
      }
    }

    return Array.from(nodeMap.values());
  }, [latestNodeStates, workflowDraft, monitorGraph]);

  const timelineTableNodeStates = useMemo(() => {
    const base = monitorGraph
      ? monitorGraph.nodes.map((n) => ({
          stateName: n.apiStateName,
          nodeName: n.nodeName,
          typeLabel: getNodeTypeCategory(n.dslType, n.containerType)
        }))
      : allNodes.map((n) => ({
          stateName: n.stateName,
          nodeName: n.nodeName
        }));
    const existing = new Set(base.map((b) => b.stateName));
    const extra: Array<{ stateName: string; nodeName: string; typeLabel: string }> = [];
    for (const sn of onFailureApiStateNames) {
      if (existing.has(sn)) continue;
      extra.push({
        stateName: sn,
        nodeName: sn,
        typeLabel: "Failure handling"
      });
    }
    return [...base, ...extra];
  }, [monitorGraph, allNodes, onFailureApiStateNames]);

  const initialReplayNodes = useMemo(
    () =>
      allNodes.map((n) => ({
        ...n,
        // Replay에서는 상태만 WAITING으로 리셋하고, duration은 스냅샷 값(실제 실행 시간)을 기본값으로 유지한다.
        status: NodeStatus.WAITING,
        durationMs: n.durationMs
      })),
    [allNodes]
  );
  const replayNodeStates = useMemo(
    () => applyEventsToNodeStates(initialReplayNodes, events.slice(0, replayIndex + 1)),
    [initialReplayNodes, events, replayIndex]
  );
  const displayEvents = showReplay ? events.slice(0, replayIndex + 1) : events;
  const displayNodeStates = showReplay ? replayNodeStates : allNodes;
  const takenBranchByConditionPathId = useMemo(() => {
    const ev = showReplay ? events.slice(0, replayIndex + 1) : events;
    return computeTakenBranches(monitorGraph, ev);
  }, [monitorGraph, showReplay, events, replayIndex]);

  const selectedMonitorNode = useMemo(() => {
    if (!selectedNode || !monitorGraph) return null;
    return monitorGraph.nodes.find((n) => n.pathId === selectedNode) ?? null;
  }, [selectedNode, monitorGraph]);

  const selectedNodeState = useMemo(() => {
    if (!selectedNode) return null;
    const statesToUse = displayNodeStates;
    if (monitorGraph) {
      const node = selectedMonitorNode;
      if (!node) return null;
      const snap = statesToUse.find((n) => n.stateName === node.apiStateName) ?? statesToUse.find((n) => n.stateName === node.stateName);
      // VLM Planner 컨테이너는 DSL 타입 Repeat 대신 이름으로 표시
      const typeDisplay =
        node.nodeName === "VLM Planner"
          ? "VLM Planner"
          : node.skillName ?? node.dslType ?? "Task";
      return {
        stateName: node.apiStateName,
        nodeName: node.nodeName,
        status: snap?.status ?? NodeStatus.WAITING,
        durationMs: snap?.durationMs ?? null,
        typeDisplay
      } as NodeStateSnapshot & { typeDisplay?: string };
    }
    return statesToUse.find((n) => n.stateName === selectedNode) ?? null;
  }, [selectedNode, monitorGraph, displayNodeStates, selectedMonitorNode]);

  const showExternalStatusActions = useMemo(
    () =>
      selectedMonitorNode
        ? skillNodeAllowsExternalStatusChange(
            selectedMonitorNode.dslType,
            selectedMonitorNode.skillName,
            skillsetsResponse?.skill_sets ?? []
          )
        : false,
    [selectedMonitorNode, skillsetsResponse?.skill_sets]
  );

  const isInRunningContainer = useMemo(() => {
    if (!monitorGraph) return false;
    const containerPathId = selectedMonitorNode?.containerPathId;
    if (!containerPathId) return false;
    const parentContainer = monitorGraph.nodes.find(
      (n) =>
        n.pathId === containerPathId &&
        n.isContainer &&
        (n.containerType === "repeat" || n.containerType === "parallel")
    );
    if (!parentContainer) return false;

    const snap =
      displayNodeStates.find((s) => s.stateName === parentContainer.apiStateName) ??
      displayNodeStates.find((s) => s.stateName === parentContainer.stateName);

    return snap?.status === NodeStatus.RUNNING;
  }, [selectedMonitorNode, monitorGraph, displayNodeStates]);

  const actionStatusPending = actionStatusInFlight !== null;
  const actionStatusEnabled =
    !actionStatusPending &&
    (selectedNodeState?.status === NodeStatus.RUNNING ||
      (selectedNodeState?.status === NodeStatus.WAITING && isInRunningContainer));
  const actionStatusTargetId = selectedMonitorNode?.stateName ?? selectedNodeState?.stateName ?? null;

  const submitActionStatus = async (status: "success" | "failure") => {
    if (!actionStatusTargetId || !selectedNodeState) return;
    if (actionStatusSubmittingRef.current) return;
    actionStatusSubmittingRef.current = true;
    setActionStatusInFlight(status);
    try {
      const response = await middlewareApi.postWorkflowActionStatus({
        statuses: [{ action_id: actionStatusTargetId, status, reason: "" }]
      });
      const first = response.results?.[0];
      const resultRaw = (first?.result ?? "accepted").toLowerCase();
      if (resultRaw === "accepted") {
        setActionStatusToast({
          variant: "success",
          message: `${selectedNodeState.nodeName}: ${first?.result ?? "accepted"}`
        });
      } else if (resultRaw === "rejected") {
        setActionStatusToast({
          variant: "rejected",
          message: `${selectedNodeState.nodeName}: rejected`
        });
      } else {
        setActionStatusToast({
          variant: "error",
          message: `${selectedNodeState.nodeName}: unexpected result (${first?.result ?? "unknown"})`
        });
      }
    } catch (error) {
      if (isFetchAbortError(error)) {
        setActionStatusToast({
          variant: "timeout",
          message: `${selectedNodeState.nodeName}: no response within 10s`
        });
      } else {
        const msg = error instanceof Error ? error.message : "request failed";
        setActionStatusToast({
          variant: "error",
          message: `${selectedNodeState.nodeName}: ${msg}`
        });
      }
    } finally {
      actionStatusSubmittingRef.current = false;
      setActionStatusInFlight(null);
    }
  };

  useEffect(() => {
    if (!actionStatusToast) return;
    const id = window.setTimeout(() => setActionStatusToast(null), ACTION_STATUS_TOAST_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [actionStatusToast]);

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="monitor-run-page">
      {/* Top Bar: Left - Workflow name, Right - Run state + Cancel/Replay controls */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{workflowName}</h1>
          </div>
          <div className="flex items-center gap-3">
            {runStatus && <StatusBadge status={runStatus} />}
            {showCancel && (
              <Button onClick={handleCancel} disabled={cancelInFlight}>
                {cancelInFlight ? "Cancelling…" : "Cancel"}
              </Button>
            )}
            {showReplay && workflowId && (
              <Link href={`/monitor/workflow/${workflowId}`}>
                <Button
                  variant="secondary"
                  className="inline-flex items-center gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="h-4 w-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z"
                    />
                  </svg>
                  Open Workflow
                </Button>
              </Link>
            )}
            {isReplayMode && (
              <Button
                onClick={() => {
                  if (replayIndex >= events.length - 1 && events.length > 0) {
                    setReplayIndex(0);
                  }
                  setReplayPlaying((prev) => !prev);
                }}
                className="inline-flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" />
                </svg>
                {replayPlaying ? "Pause" : "Play"}
              </Button>
            )}
            {showRunFromTerminal && (
              <Button
                onClick={() => rerunMutation.mutate()}
                disabled={rerunMutation.isPending}
                className="inline-flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" />
                </svg>
                {rerunMutation.isPending ? "Starting..." : "Run"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Center: DAG view, Right Panel: Debug Panel */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[2fr_1fr]">
        {/* DAG View - Center: min-h-0 so grid item can shrink and vertical scroll works */}
        <div className="min-h-0 flex flex-col overflow-hidden">
        <Card
          title="DAG View"
          description={
            isReplayMode
              ? "Replay mode: viewing historical execution state"
              : "Live monitoring: node statuses update in real-time"
          }
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col p-6">
            <DagView
              nodeStates={displayNodeStates}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              edges={edges}
              runStatus={runStatus}
              viewJson={workflowDraft?.view_json}
              monitorGraph={monitorGraph ?? undefined}
              shouldAutoFocusRunningNode={runStatus === RunStatus.RUNNING || (showReplay && replayPlaying)}
              takenBranchByConditionPathId={takenBranchByConditionPathId}
            />
          </div>
        </Card>
        </div>

        {/* Debug Panel - Right (appears when node is selected) */}
        {selectedNodeState ? (
          <Card
            title="Debug Panel"
            description="Node execution details"
          >
            <div className="space-y-4 text-xs">
              <div>
                <p className="font-semibold text-slate-900">
                  {selectedNodeState.nodeName}
                </p>
                {(selectedNodeState as NodeStateSnapshot & { typeDisplay?: string }).typeDisplay && (
                  <p className="mt-0.5 text-slate-500">
                    {(selectedNodeState as NodeStateSnapshot & { typeDisplay?: string }).typeDisplay}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={selectedNodeState.status} />
                {selectedNodeState.durationMs !== null && (
                  <span className="text-slate-500">
                    {formatDuration(selectedNodeState.durationMs)}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="mb-1 font-semibold text-slate-900">Input</p>
                  <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600">
                    {JSON.stringify(nodeDebug?.input ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="mb-1 font-semibold text-slate-900">Output</p>
                  <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600">
                    {JSON.stringify(nodeDebug?.output ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="mb-1 font-semibold text-slate-900">Feedback</p>
                  <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600">
                    {JSON.stringify(nodeDebug?.feedback ?? {}, null, 2)}
                  </pre>
                </div>
                {nodeDebug?.decision && (
                  <div className="rounded-md bg-slate-50 p-3">
                    <p className="mb-1 font-semibold text-slate-900">
                      Decision
                    </p>
                    <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600">
                      {JSON.stringify(nodeDebug.decision, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
              {showExternalStatusActions && (
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="mb-1 font-semibold text-slate-900">Change status</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      disabled={!actionStatusEnabled}
                      onClick={() => void submitActionStatus("success")}
                    >
                      {actionStatusInFlight === "success" ? (
                        <>
                          <span
                            className="inline-block size-3.5 shrink-0 rounded-full border-2 border-white/35 border-t-white motion-safe:animate-spin"
                            aria-hidden
                          />
                          Sending…
                        </>
                      ) : (
                        "Success"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700"
                      disabled={!actionStatusEnabled}
                      onClick={() => void submitActionStatus("failure")}
                    >
                      {actionStatusInFlight === "failure" ? (
                        <>
                          <span
                            className="inline-block size-3.5 shrink-0 rounded-full border-2 border-white/35 border-t-white motion-safe:animate-spin"
                            aria-hidden
                          />
                          Sending…
                        </>
                      ) : (
                        "Failure"
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card
            title="Debug Panel"
            description="Select a node to inspect its debug bundle"
          >
            <div className="flex h-[400px] items-center justify-center">
              <p className="text-sm text-slate-500">
                Click a node in the DAG view to inspect debug details.
              </p>
            </div>
          </Card>
        )}
        </div>
      </div>

      {/* Bottom: Timeline - Fixed at bottom */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white p-6">
        <Card
          title="Timeline"
          description={
            isReplayMode
              ? "Replay-only timeline of events."
              : "Live timeline."
          }
          actions={
            !isReplayMode && (
              <button
                type="button"
                onClick={() => setAutoScroll((prev) => !prev)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  autoScroll
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                )}
                aria-pressed={autoScroll}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" aria-hidden />
                Auto-scroll {autoScroll ? "On" : "Off"}
              </button>
            )
          }
        >
          <div
            ref={timelineRef}
            onScroll={() => {
              if (!isReplayMode && autoScroll && timelineRef.current) {
                const el = timelineRef.current;
                const isAtBottom =
                  el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
                if (!isAtBottom) {
                  setAutoScroll(false);
                }
              }
            }}
            className="h-72 overflow-y-auto rounded-lg border border-slate-200"
          >
            <TimelineTable
              events={displayEvents}
              selectedNode={selectedNode}
              selectedStateName={selectedNode ? pathIdToApiStateName(selectedNode) : null}
              onSelectNode={(stateName) =>
                setSelectedNode(stateNameToPathId.get(stateName) ?? stateName)
              }
              nodeStates={timelineTableNodeStates}
              onFailureApiStateNames={onFailureApiStateNames}
            />
          </div>
        </Card>
      </div>
      <ActionStatusToast toast={actionStatusToast} onDismiss={() => setActionStatusToast(null)} />
    </div>
  );
}
