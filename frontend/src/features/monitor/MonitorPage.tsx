"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { middlewareApi, runsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { NodeStateSnapshot } from "@/api/interfaces";
import { NodeStatus, RunEvent, RunStatus, RunSummary } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { pathIdToApiStateName } from "@/lib/ids";
import { isRunTerminal } from "@/domain/types";
import { SIMULATED_EVENTS_BY_RUN } from "@/features/monitor/simulatedEvents";
import { buildMonitorGraph, applyGraphPatches, type GraphPatchPayload } from "@/features/monitor/monitorGraph";
import { ENABLE_DYNAMIC_GRAPH_PATCH } from "@/lib/featureFlags";
import { DagView } from "@/features/monitor/DagView";
import { TimelineTable } from "@/features/monitor/TimelineTable";

type MonitorPageProps = {
  runId: string;
};

function getNextSeq(events: RunEvent[]) {
  if (events.length === 0) {
    return 1;
  }
  return Math.max(...events.map((event) => event.seq)) + 1;
}

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
  const replayInitializedRef = useRef(false);
  const terminalRefetchDoneRef = useRef<string | null>(null);

  const simulationRef = useRef<{ runId: string; index: number }>({
    runId: "",
    index: 0
  });
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const debugStateName = useMemo(
    () => (selectedNode ? pathIdToApiStateName(selectedNode) : ""),
    [selectedNode]
  );

  const { data: nodeDebug } = useQuery({
    queryKey: ["node-debug", runId, debugStateName],
    queryFn: () => runsApi.getNodeDebug(runId, debugStateName),
    enabled: Boolean(selectedNode && debugStateName)
  });

  // Workflow draft 가져오기 (DSL에서 엣지 정보 추출용 + Monitor graph). 에디터에서 수정 후 돌아왔을 때 최신 반영
  const { data: workflowDraft } = useQuery({
    queryKey: ["workflow-draft", snapshot?.run.workflowId],
    queryFn: () => workflowsApi.getDraft(snapshot!.run.workflowId),
    enabled: Boolean(snapshot?.run.workflowId),
    refetchOnWindowFocus: true
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
      .filter((p) => p && (p.nodes_added != null || p.edges_added != null));
  }, [events]);

  const monitorGraph = useMemo(
    () =>
      ENABLE_DYNAMIC_GRAPH_PATCH && graphPatchPayloads.length > 0
        ? applyGraphPatches(baseMonitorGraph, graphPatchPayloads)
        : baseMonitorGraph,
    [baseMonitorGraph, graphPatchPayloads]
  );

  const stateNameToPathId = useMemo(
    () => monitorGraph?.stateNameToPathId ?? new Map<string, string>(),
    [monitorGraph]
  );

  useEffect(() => {
    if (!snapshot) return;
    setNodeStates(snapshot.nodeStates);
    setRunStatus(snapshot.run.status);
  }, [snapshot]);

  useEffect(() => {
    if (eventsData === undefined) return;
    setEvents(eventsData);
  }, [runId, eventsData]);

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

  // Replay: advance index on interval when playing
  useEffect(() => {
    if (!replayPlaying || events.length === 0) return;
    const interval = setInterval(() => {
      setReplayIndex((i: number) => {
        if (i >= events.length - 1) {
          setReplayPlaying(false);
          return events.length - 1;
        }
        return i + 1;
      });
    }, 700);
    return () => clearInterval(interval);
  }, [replayPlaying, events.length]);

  const handleCancel = async () => {
    const startedAt = snapshot?.run.startedAt ?? new Date().toISOString();
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
  };

  const isTerminal = runStatus ? isRunTerminal(runStatus) : false;
  const showReplayControls = isReplayMode || isTerminal;
  const workflowName = snapshot?.workflowName ?? "Loading...";
  const runMeta = snapshot?.run;

  // UI notes: Cancel button only when RUNNING, Replay controls only when finished
  const showCancel = runStatus === RunStatus.RUNNING && !isReplayMode;
  const showReplay = isTerminal || isReplayMode;

  // DSL에서 엣지 정보 추출
  const edges = useMemo(() => {
    if (!workflowDraft?.dsl_json) {
      return [];
    }

    const dsl = workflowDraft.dsl_json as {
      StartAt?: string;
      States?: Record<string, { Next?: string; Choices?: Array<{ Next?: string }>; End?: boolean }>;
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

    // DSL의 모든 state를 노드로 변환. 표시명(nodeName)은 항상 현재 DSL Label 기준으로 유지.
    const dslNodes = Object.entries(dsl.States).map(([stateName, state]) => {
      const existingNode = latestNodeStates.find((n) => n.stateName === stateName);
      const nodeName = (state.Label as string) || stateName;
      if (existingNode)
        return { ...existingNode, nodeName } as NodeStateSnapshot;
      return {
        stateName,
        nodeName,
        status: NodeStatus.WAITING,
        durationMs: null
      } as NodeStateSnapshot;
    });

    const nodeMap = new Map<string, NodeStateSnapshot>();
    dslNodes.forEach((node) => nodeMap.set(node.stateName, node));
    // 스냅샷은 status/durationMs만 반영하고, 표시명은 위에서 쓴 현재 DSL 유지
    latestNodeStates.forEach((node) => {
      const existing = nodeMap.get(node.stateName);
      nodeMap.set(node.stateName, {
        ...node,
        nodeName: existing?.nodeName ?? node.nodeName,
        status: node.status,
        durationMs: node.durationMs
      } as NodeStateSnapshot);
    });

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

  const initialReplayNodes = useMemo(
    () => allNodes.map((n) => ({ ...n, status: NodeStatus.WAITING, durationMs: null })),
    [allNodes]
  );
  const replayNodeStates = useMemo(
    () => applyEventsToNodeStates(initialReplayNodes, events.slice(0, replayIndex + 1)),
    [initialReplayNodes, events, replayIndex]
  );
  const displayEvents = showReplay ? events.slice(0, replayIndex + 1) : events;
  const displayNodeStates = showReplay ? replayNodeStates : allNodes;

  // 타임라인용: DAG와 동일하게 monitorGraph에서 표시명 가져옴 (같은 소스 = 같은 이름 보장). graph 없을 때만 DSL fallback
  const timelineNodeStates = useMemo(() => {
    const byState = new Map<string, { stateName: string; nodeName: string; typeLabel?: string }>();
    const dslLabels = new Map<string, string>();
    const dsl = workflowDraft?.dsl_json as { States?: Record<string, { Label?: string }> } | undefined;
    if (dsl?.States) {
      Object.entries(dsl.States).forEach(([k, v]) => dslLabels.set(k, v?.Label ?? k));
    }
    displayEvents.forEach((e) => {
      if (!e.stateName) return;
      const graphNode = monitorGraph?.nodes.find(
        (n) => n.apiStateName === e.stateName || n.stateName === e.stateName
      );
      const nodeName = graphNode?.nodeName ?? dslLabels.get(e.stateName) ?? e.stateName;
      byState.set(e.stateName, {
        stateName: e.stateName,
        nodeName,
        typeLabel: graphNode
          ? getNodeTypeCategory(graphNode.dslType, graphNode.containerType)
          : undefined
      });
    });
    if (monitorGraph) {
      monitorGraph.nodes.forEach((n) => {
        if (!byState.has(n.apiStateName)) {
          byState.set(n.apiStateName, {
            stateName: n.apiStateName,
            nodeName: n.nodeName,
            typeLabel: getNodeTypeCategory(n.dslType, n.containerType)
          });
        }
      });
    }
    return Array.from(byState.values());
  }, [monitorGraph, displayEvents, workflowDraft?.dsl_json]);

  // 타임라인 Node 컬럼: DAG와 완전히 동일한 소스(monitorGraph → draft)로 표시명 조회
  const getNodeDisplayName = useCallback(
    (stateName: string): string => {
      const graphNode = monitorGraph?.nodes.find(
        (n) => n.apiStateName === stateName || n.stateName === stateName
      );
      if (graphNode) return graphNode.nodeName;
      const dsl = workflowDraft?.dsl_json as { States?: Record<string, { Label?: string }> } | undefined;
      const label = dsl?.States?.[stateName]?.Label;
      return label ?? stateName;
    },
    [monitorGraph, workflowDraft?.dsl_json]
  );

  const takenBranchByConditionPathId = useMemo(() => {
    const ev = showReplay ? events.slice(0, replayIndex + 1) : events;
    return computeTakenBranches(monitorGraph, ev);
  }, [monitorGraph, showReplay, events, replayIndex]);

  const selectedNodeState = useMemo(() => {
    if (!selectedNode) return null;
    const statesToUse = displayNodeStates;
    if (monitorGraph) {
      const node = monitorGraph.nodes.find((n) => n.pathId === selectedNode);
      if (!node) return null;
      const snap = statesToUse.find((n) => n.stateName === node.apiStateName) ?? statesToUse.find((n) => n.stateName === node.stateName);
      const typeDisplay = node.skillName ?? node.dslType ?? "Task";
      return {
        stateName: node.apiStateName,
        nodeName: node.nodeName,
        status: snap?.status ?? NodeStatus.WAITING,
        durationMs: snap?.durationMs ?? null,
        typeDisplay
      } as NodeStateSnapshot & { typeDisplay?: string };
    }
    return statesToUse.find((n) => n.stateName === selectedNode) ?? null;
  }, [selectedNode, monitorGraph, displayNodeStates]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top Bar: Left - Workflow name, Right - Run state + Cancel/Replay controls */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{workflowName}</h1>
          </div>
          <div className="flex items-center gap-3">
            {runStatus && <StatusBadge status={runStatus} />}
            {showCancel && (
              <Button onClick={handleCancel}>Cancel</Button>
            )}
            {showReplay && (
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
              nodeStates={timelineNodeStates}
              getNodeDisplayName={getNodeDisplayName}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
