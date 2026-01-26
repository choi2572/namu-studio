"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { runsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableCell, TableHead, TableRow } from "@/components/Table";
import { NodeStateSnapshot } from "@/api/interfaces";
import { NodeStatus, RunEvent, RunStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDateTime, formatDuration } from "@/lib/format";
import { isRunTerminal } from "@/domain/types";
import { SIMULATED_EVENTS_BY_RUN } from "@/features/monitor/simulatedEvents";
import { DagView } from "@/features/monitor/DagView";

type MonitorPageProps = {
  runId: string;
};

function getNextSeq(events: RunEvent[]) {
  if (events.length === 0) {
    return 1;
  }
  return Math.max(...events.map((event) => event.seq)) + 1;
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

  const { data: initialEvents = [] } = useQuery({
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

  const { data: nodeDebug } = useQuery({
    queryKey: ["node-debug", runId, selectedNode],
    queryFn: () => runsApi.getNodeDebug(runId, selectedNode ?? ""),
    enabled: Boolean(selectedNode)
  });

  useEffect(() => {
    if (!snapshot) return;
    setNodeStates(snapshot.nodeStates);
    setRunStatus(snapshot.run.status);
  }, [snapshot]);

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

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

  const selectedNodeState = useMemo(
    () => nodeStates.find((node) => node.stateName === selectedNode),
    [nodeStates, selectedNode]
  );

  // 이벤트에서 엣지 정보 추출 (NODE_STARTED, NODE_SUCCEEDED 이벤트의 순서를 보고 연결 추정)
  const edges = useMemo(() => {
    const edgeMap = new Map<string, { from: string; to: string }>();
    const nodeOrder: string[] = [];
    
    // 이벤트 순서대로 노드 추적
    events.forEach((event) => {
      if (event.stateName && event.eventType === "NODE_STARTED") {
        if (!nodeOrder.includes(event.stateName)) {
          nodeOrder.push(event.stateName);
        }
      }
    });

    // 순차 연결 생성 (간단한 추정)
    for (let i = 0; i < nodeOrder.length - 1; i++) {
      const from = nodeOrder[i];
      const to = nodeOrder[i + 1];
      if (from && to) {
        edgeMap.set(`${from}-${to}`, { from, to });
      }
    }

    return Array.from(edgeMap.values()).map((edge, index) => ({
      id: `edge-${index}`,
      from: edge.from,
      to: edge.to
    }));
  }, [events]);

  return (
    <div className="flex h-screen flex-col">
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
      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* DAG View - Center */}
        <Card
          title="DAG View"
          description={
            isReplayMode
              ? "Replay mode: viewing historical execution state"
              : "Live monitoring: node statuses update in real-time"
          }
        >
          <div className="h-[600px] p-6">
            <DagView
              nodeStates={nodeStates}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              edges={edges}
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
                <p className="text-slate-500">{selectedNodeState.stateName}</p>
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
            <Table className="text-xs">
              <TableHead>
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
                    Seq
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
                    Time
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
                    Event
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
                    Node
                  </th>
                </tr>
              </TableHead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      No events yet
                    </TableCell>
                  </tr>
                ) : (
                  events.map((event) => (
                    <TableRow
                      key={event.eventId}
                      onClick={() => {
                        if (event.stateName) {
                          setSelectedNode(event.stateName);
                        }
                      }}
                      className={cn(
                        "cursor-pointer transition-colors",
                        event.stateName &&
                          selectedNode === event.stateName &&
                          "bg-blue-50"
                      )}
                    >
                      <TableCell>{event.seq}</TableCell>
                      <TableCell>{formatDateTime(event.timestamp)}</TableCell>
                      <TableCell>{event.eventType}</TableCell>
                      <TableCell>{event.stateName ?? "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
