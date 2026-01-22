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

const STATUS_STYLE_MAP: Record<NodeStatus, string> = {
  [NodeStatus.RUNNING]: "border-status-running bg-blue-50",
  [NodeStatus.WAITING]: "border-status-waiting bg-amber-50",
  [NodeStatus.SUCCEEDED]: "border-status-success bg-emerald-50",
  [NodeStatus.FAILED]: "border-status-failed bg-red-50",
  [NodeStatus.SKIPPED]: "border-status-skipped bg-slate-100",
  [NodeStatus.CANCELED]: "border-status-canceled bg-slate-100"
};

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

  const selectedNodeState = useMemo(
    () => nodeStates.find((node) => node.stateName === selectedNode),
    [nodeStates, selectedNode]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500">Run Monitor</p>
          <h1 className="text-xl font-semibold">{workflowName}</h1>
          {runMeta && (
            <p className="text-xs text-slate-500">
              {runMeta.runId} · Started {formatDateTime(runMeta.startedAt)} ·{" "}
              {formatDuration(runMeta.durationMs)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {runStatus && <StatusBadge status={runStatus} />}
          {runStatus === RunStatus.RUNNING && !isReplayMode && (
            <Button onClick={handleCancel}>Cancel</Button>
          )}
          {runStatus && showReplayControls && (
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
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card
          title="DAG Snapshot"
          description="Node statuses update during live monitoring"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nodeStates.map((node) => (
              <button
                key={node.stateName}
                type="button"
                onClick={() => setSelectedNode(node.stateName)}
                className={cn(
                  "rounded-lg border-2 p-3 text-left text-sm font-medium transition",
                  STATUS_STYLE_MAP[node.status],
                  selectedNode === node.stateName
                    ? "ring-2 ring-slate-400"
                    : "hover:border-slate-300"
                )}
              >
                <p>{node.nodeName}</p>
                <p className="text-xs text-slate-500">{node.stateName}</p>
                <div className="mt-2">
                  <StatusBadge status={node.status} />
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card
          title="Debug Panel"
          description="Select a node to inspect its debug bundle"
        >
          {selectedNodeState ? (
            <div className="space-y-3 text-xs">
              <div>
                <p className="font-semibold text-slate-900">
                  {selectedNodeState.nodeName}
                </p>
                <p className="text-slate-500">{selectedNodeState.stateName}</p>
              </div>
              <StatusBadge status={selectedNodeState.status} />
              <p>Duration: {formatDuration(selectedNodeState.durationMs)}</p>
              <div className="space-y-2">
                <div className="rounded-md bg-slate-50 p-2">
                  <p className="font-semibold">Input</p>
                  <pre className="whitespace-pre-wrap text-[11px] text-slate-600">
                    {JSON.stringify(nodeDebug?.input ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="rounded-md bg-slate-50 p-2">
                  <p className="font-semibold">Output</p>
                  <pre className="whitespace-pre-wrap text-[11px] text-slate-600">
                    {JSON.stringify(nodeDebug?.output ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="rounded-md bg-slate-50 p-2">
                  <p className="font-semibold">Feedback</p>
                  <pre className="whitespace-pre-wrap text-[11px] text-slate-600">
                    {JSON.stringify(nodeDebug?.feedback ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Click a node to inspect debug details.
            </p>
          )}
        </Card>
      </div>

      <Card
        title="Timeline"
        description={
          showReplayControls
            ? "Replay-only timeline of events."
            : "Live timeline (auto-scroll enabled)."
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoScroll((prev) => !prev)}
          >
            {autoScroll ? "Pause auto-scroll" : "Resume auto-scroll"}
          </Button>
        }
      >
        <div
          ref={timelineRef}
          onScroll={() => setAutoScroll(false)}
          className="max-h-72 overflow-y-auto rounded-lg border border-slate-200"
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
              {events.map((event) => (
                <TableRow
                  key={event.eventId}
                  onClick={() =>
                    event.stateName ? setSelectedNode(event.stateName) : null
                  }
                >
                  <TableCell>{event.seq}</TableCell>
                  <TableCell>{formatDateTime(event.timestamp)}</TableCell>
                  <TableCell>{event.eventType}</TableCell>
                  <TableCell>{event.stateName ?? "-"}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
