"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { runsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { NodeStateSnapshot } from "@/api/interfaces";
import { NodeStatus, RunEvent, RunStatus } from "@/domain/types";
import { formatDuration } from "@/lib/format";
import { pathIdToApiStateName } from "@/lib/ids";
import { isRunTerminal } from "@/domain/types";
import { SIMULATED_EVENTS_BY_RUN } from "@/features/monitor/simulatedEvents";
import { buildMonitorGraph } from "@/features/monitor/monitorGraph";
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


export function MonitorPage({ runId }: MonitorPageProps) {
  const searchParams = useSearchParams();
  const isReplayMode = searchParams.get("mode") === "replay";
  const { data: snapshot } = useQuery({
    queryKey: ["run-snapshot", runId],
    queryFn: () => runsApi.getSnapshot(runId)
  });

  const { data: eventsData } = useQuery({
    queryKey: ["run-events", runId],
    queryFn: () => runsApi.getEvents(runId, 0)
  });

  const [events, setEvents] = useState<RunEvent[]>([]);
  const [nodeStates, setNodeStates] = useState<NodeStateSnapshot[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayPosition, setReplayPosition] = useState(30);

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

  // Workflow draft 가져오기 (DSL에서 엣지 정보 추출용 + Monitor graph)
  const { data: workflowDraft } = useQuery({
    queryKey: ["workflow-draft", snapshot?.run.workflowId],
    queryFn: () => workflowsApi.getDraft(snapshot!.run.workflowId),
    enabled: Boolean(snapshot?.run.workflowId)
  });

  const monitorGraph = useMemo(
    () => buildMonitorGraph(workflowDraft?.dsl_json),
    [workflowDraft?.dsl_json]
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
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [events, autoScroll]);

  const handleCancel = () => {
    if (!snapshot) return;
    setRunStatus(RunStatus.CANCELED);
    setEvents((prev) => {
      const nextSeq = getNextSeq(prev);
      return [
        ...prev,
        {
          eventId: `event-cancel-${nextSeq}`,
          runId,
          seq: nextSeq,
          timestamp: getNextTimestamp(prev, snapshot.run.startedAt),
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

  // 모든 노드가 nodeStates에 있는지 확인하고, 없으면 DSL에서 추가
  const allNodes = useMemo(() => {
    if (!workflowDraft?.dsl_json) {
      return nodeStates;
    }

    const dsl = workflowDraft.dsl_json as {
      StartAt?: string;
      States?: Record<string, { Label?: string; Type?: string }>;
    };

    if (!dsl.States) {
      return nodeStates;
    }

    // DSL의 모든 state를 노드로 변환
    const dslNodes = Object.entries(dsl.States).map(([stateName, state]) => {
      // nodeStates에서 이미 존재하는 노드 찾기
      const existingNode = nodeStates.find((n) => n.stateName === stateName);
      
      if (existingNode) {
        return existingNode;
      }

      // 존재하지 않으면 기본 노드 생성 (아직 실행되지 않은 노드)
      return {
        stateName,
        nodeName: (state.Label as string) || stateName,
        status: NodeStatus.WAITING,
        durationMs: null
      } as NodeStateSnapshot;
    });

    // nodeStates에 있는 노드와 DSL 노드를 병합 (nodeStates 우선)
    const nodeMap = new Map<string, NodeStateSnapshot>();
    dslNodes.forEach((node) => {
      nodeMap.set(node.stateName, node);
    });
    nodeStates.forEach((node) => {
      nodeMap.set(node.stateName, node);
    });

    return Array.from(nodeMap.values());
  }, [nodeStates, workflowDraft]);

  const selectedNodeState = useMemo(() => {
    if (!selectedNode) return null;
    if (monitorGraph) {
      const node = monitorGraph.nodes.find((n) => n.pathId === selectedNode);
      if (!node) return null;
      const snap = nodeStates.find((n) => n.stateName === node.apiStateName);
      const typeDisplay = node.skillName ?? node.dslType ?? "Task";
      return {
        stateName: node.apiStateName,
        nodeName: node.nodeName,
        status: snap?.status ?? NodeStatus.WAITING,
        durationMs: snap?.durationMs ?? null,
        typeDisplay
      } as NodeStateSnapshot & { typeDisplay?: string };
    }
    return allNodes.find((n) => n.stateName === selectedNode) ?? null;
  }, [selectedNode, monitorGraph, nodeStates, allNodes]);

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
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setReplayPlaying((prev) => !prev)}
                >
                  {replayPlaying ? "Pause" : "Play"}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={replayPosition}
                  onChange={(event) =>
                    setReplayPosition(Number(event.target.value))
                  }
                  className="w-32"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Center: DAG view, Right Panel: Debug Panel */}
      <div className="flex-1 overflow-hidden p-6">
        <div className="grid h-full gap-6 lg:grid-cols-[2fr_1fr]">
        {/* DAG View - Center */}
        <Card
          title="DAG View"
          description={
            isReplayMode
              ? "Replay mode: viewing historical execution state"
              : "Live monitoring: node statuses update in real-time"
          }
          className="flex flex-col overflow-hidden h-full"
        >
          <div className="flex min-h-0 flex-1 flex-col p-6">
            <DagView
              nodeStates={allNodes}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              edges={edges}
              runStatus={runStatus}
              viewJson={workflowDraft?.view_json}
              monitorGraph={monitorGraph ?? undefined}
            />
          </div>
        </Card>

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
              : "Live timeline (auto-scroll enabled)."
          }
          actions={
            !isReplayMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAutoScroll((prev) => !prev)}
              >
                {autoScroll ? "Pause auto-scroll" : "Resume auto-scroll"}
              </Button>
            )
          }
        >
          <div
            ref={timelineRef}
            onScroll={() => {
              if (!isReplayMode) {
                setAutoScroll(false);
              }
            }}
            className="h-72 overflow-y-auto rounded-lg border border-slate-200"
          >
            <TimelineTable
              events={events}
              selectedNode={selectedNode}
              onSelectNode={(stateName) =>
                setSelectedNode(stateNameToPathId.get(stateName) ?? stateName)
              }
              nodeStates={
                monitorGraph
                  ? monitorGraph.nodes.map((n) => ({
                      stateName: n.apiStateName,
                      nodeName: n.nodeName,
                      typeLabel: getNodeTypeCategory(n.dslType, n.containerType)
                    }))
                  : allNodes.map((n) => ({
                      stateName: n.stateName,
                      nodeName: n.nodeName
                    }))
              }
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
