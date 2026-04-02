"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { middlewareApi, runsApi, skillsetsApi, workflowsApi } from "@/api";
import type {
  MiddlewareNodeHistoryItem,
  RunnerStatusResponse,
  RunnerWorkflowInfo
} from "@/api/interfaces";
import type { NodeStateSnapshot } from "@/api/interfaces";
import type { WorkflowListItem } from "@/domain/types";
import type { NodeDebugBundle } from "@/domain/types";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/cn";
import { getMiddlewareHttpBaseForBrowser, getMonitorWebSocketUrl } from "@/lib/middlewareWsUrl";
import { pathIdToApiStateName } from "@/lib/ids";
import { formatDuration } from "@/lib/format";
import { NodeStatus, RunEvent, RunStatus, isRunTerminal } from "@/domain/types";
import {
  pickInputOutputFromMiddlewareMessage,
  resolveMiddlewareDebugStateKey
} from "@/features/monitor/middlewareLiveDebug";
import { skillNodeAllowsExternalStatusChange } from "@/features/monitor/skillsetExternalStatus";
import {
  buildMonitorGraph,
  applyGraphPatches,
  collectOnFailureApiStateNames,
  type GraphPatchPayload,
  type MonitorGraph
} from "@/features/monitor/monitorGraph";
import { ENABLE_DYNAMIC_GRAPH_PATCH } from "@/lib/featureFlags";
import { DagView } from "@/features/monitor/DagView";
import {
  ActionStatusToast,
  ACTION_STATUS_TOAST_DISMISS_MS,
  isFetchAbortError,
  type ActionStatusToastState
} from "@/features/monitor/ActionStatusToast";
import {
  applyNodeStatusChangeMessage,
  applyTerminalWorkflowToNodeStates,
  applyRunnerPollToNodeStates,
  buildLiveNodeStatesFromInitial,
  extractNodeHistoryFromInitialPayload,
  parseGraphPatchMessage,
  parseInitialWorkflow,
  runEventFromMiddlewareNodeStatusChange,
  runnerStatusIndicatesActiveWorkflow,
  workflowCompletedRunStatus
} from "@/features/monitor/middlewareLiveMonitorModel";

const POLL_MS = 500;
const PING_MS = 25_000;
const WS_RECONNECT_MS = 3000;
const WS_DISCONNECTED_DEBOUNCE_MS = 2000;
const WS_ERROR_DEBOUNCE_MS = 2000;

type MiddlewareLiveDebugPatch = {
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  feedback?: Record<string, unknown> | null;
};

function computeTakenBranches(
  monitorGraph: MonitorGraph | null,
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

export function LiveRunnerMonitorPage() {
  const queryClient = useQueryClient();
  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });

  const [wsReadyState, setWsReadyState] = useState<number | null>(null);
  const [displayWsReadyState, setDisplayWsReadyState] = useState<number | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsErrorShown, setWsErrorShown] = useState<string | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [initialBootstrapDone, setInitialBootstrapDone] = useState(false);
  const [lastRunnerStatus, setLastRunnerStatus] = useState<RunnerStatusResponse | null>(null);

  const [loadedWorkflowId, setLoadedWorkflowId] = useState<string | null>(null);
  const [dslJson, setDslJson] = useState<Record<string, unknown> | null>(null);
  const [viewJson, setViewJson] = useState<Record<string, unknown> | null>(null);
  const [nodeStates, setNodeStates] = useState<NodeStateSnapshot[]>([]);
  const [graphPatches, setGraphPatches] = useState<GraphPatchPayload[]>([]);
  const [runStatusForDag, setRunStatusForDag] = useState<RunStatus | null>(null);
  const [dslFetchInProgress, setDslFetchInProgress] = useState(false);
  const [dslFetchError, setDslFetchError] = useState<string | null>(null);

  const [feedEvents, setFeedEvents] = useState<RunEvent[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [actionStatusInFlight, setActionStatusInFlight] = useState<
    null | "success" | "failure"
  >(null);
  const [actionStatusToast, setActionStatusToast] = useState<ActionStatusToastState | null>(null);
  const actionStatusSubmittingRef = useRef(false);
  const [middlewareWsDebug, setMiddlewareWsDebug] = useState<
    Record<string, MiddlewareLiveDebugPatch>
  >({});

  const loadGenRef = useRef(0);
  const loadedWorkflowIdRef = useRef<string | null>(null);
  const feedSeqRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const dslJsonRef = useRef<Record<string, unknown> | null>(null);
  const graphPatchesRef = useRef<GraphPatchPayload[]>([]);
  const lastRunnerStatusRef = useRef<RunnerStatusResponse | null>(null);
  const runStatusForDagRef = useRef<RunStatus | null>(null);

  const disconnectedTimerRef = useRef<number | null>(null);
  const wsErrorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    loadedWorkflowIdRef.current = loadedWorkflowId;
  }, [loadedWorkflowId]);

  useEffect(() => {
    dslJsonRef.current = dslJson;
  }, [dslJson]);

  useEffect(() => {
    graphPatchesRef.current = graphPatches;
  }, [graphPatches]);

  useEffect(() => {
    lastRunnerStatusRef.current = lastRunnerStatus;
  }, [lastRunnerStatus]);

  useEffect(() => {
    runStatusForDagRef.current = runStatusForDag;
  }, [runStatusForDag]);

  useEffect(() => {
    // UI 깜빡임 방지: connected 상태였다가 잠깐 끊기면 disconnected를 바로 표시하지 않습니다.
    if (wsReadyState === WebSocket.OPEN) {
      if (disconnectedTimerRef.current) window.clearTimeout(disconnectedTimerRef.current);
      disconnectedTimerRef.current = null;
      setDisplayWsReadyState(WebSocket.OPEN);
      setWsErrorShown(null);
      if (wsErrorTimerRef.current) window.clearTimeout(wsErrorTimerRef.current);
      wsErrorTimerRef.current = null;
      return;
    }

    // 처음 연결 전이라면 그대로 반영
    if (displayWsReadyState !== WebSocket.OPEN) {
      setDisplayWsReadyState(wsReadyState);
      setWsErrorShown(null);
      return;
    }

    // connected였던 상태가 지속적으로 끊겼을 때만 disconnected 표시
    if (disconnectedTimerRef.current) window.clearTimeout(disconnectedTimerRef.current);
    disconnectedTimerRef.current = window.setTimeout(() => {
      if (wsReadyState !== WebSocket.OPEN) {
        setDisplayWsReadyState(WebSocket.CLOSED);
      }
    }, WS_DISCONNECTED_DEBOUNCE_MS);

    return () => {
      if (disconnectedTimerRef.current) window.clearTimeout(disconnectedTimerRef.current);
      disconnectedTimerRef.current = null;
    };
  }, [wsReadyState, displayWsReadyState]);

  useEffect(() => {
    // error도 끊김이 "확정"됐을 때만 표시
    if (displayWsReadyState === WebSocket.OPEN) {
      setWsErrorShown(null);
      if (wsErrorTimerRef.current) window.clearTimeout(wsErrorTimerRef.current);
      wsErrorTimerRef.current = null;
      return;
    }
    if (!wsError) {
      setWsErrorShown(null);
      return;
    }
    if (wsErrorTimerRef.current) window.clearTimeout(wsErrorTimerRef.current);
    wsErrorTimerRef.current = window.setTimeout(() => {
      setWsErrorShown(wsError);
    }, WS_ERROR_DEBOUNCE_MS);
    return () => {
      if (wsErrorTimerRef.current) window.clearTimeout(wsErrorTimerRef.current);
      wsErrorTimerRef.current = null;
    };
  }, [wsError, displayWsReadyState]);

  useEffect(() => {
    setMiddlewareWsDebug({});
  }, [loadedWorkflowId]);

  const resetToEmpty = useCallback(() => {
    loadGenRef.current += 1;
    loadedWorkflowIdRef.current = null;
    setLoadedWorkflowId(null);
    setDslJson(null);
    setViewJson(null);
    setNodeStates([]);
    setGraphPatches([]);
    setRunStatusForDag(null);
    setFeedEvents([]);
    feedSeqRef.current = 0;
    setDslFetchError(null);
    setSelectedNode(null);
    setMiddlewareWsDebug({});
  }, []);

  const appendFeed = useCallback((ev: RunEvent) => {
    setFeedEvents((prev) => [...prev, ev].sort((a, b) => a.seq - b.seq));
  }, []);

  const resolveViewJson = useCallback(
    async (workflowId: string): Promise<Record<string, unknown> | null> => {
      const list =
        (queryClient.getQueryData(["workflows"]) as WorkflowListItem[] | undefined) ?? workflows;
      const hit = list.some((w) => w.workflowId === workflowId);
      if (!hit) return null;
      try {
        const draft = await workflowsApi.getDraft(workflowId);
        return draft.view_json ?? null;
      } catch {
        return null;
      }
    },
    [queryClient, workflows]
  );

  const applyDslAndNodes = useCallback(
    (
      wid: string,
      dsl: Record<string, unknown>,
      view: Record<string, unknown> | null,
      nodes: NodeStateSnapshot[]
    ) => {
      setLoadedWorkflowId(wid);
      loadedWorkflowIdRef.current = wid;
      setDslJson(dsl);
      setViewJson(view);
      setGraphPatches([]);
      setNodeStates(nodes);
      setRunStatusForDag(RunStatus.RUNNING);
      setDslFetchError(null);
    },
    []
  );

  const loadWorkflowDsl = useCallback(
    async (
      workflowId: string,
      options?: {
        fromInitial?: { wf: RunnerWorkflowInfo; history: MiddlewareNodeHistoryItem[] };
        fromPoll?: RunnerWorkflowInfo;
      }
    ) => {
      const gen = ++loadGenRef.current;
      setDslFetchInProgress(true);
      setDslFetchError(null);
      try {
        const dsl = await middlewareApi.getWorkflowDslJson(workflowId);
        if (gen !== loadGenRef.current) return;

        const view = await resolveViewJson(workflowId);
        if (gen !== loadGenRef.current) return;

        const mg = buildMonitorGraph(dsl);
        let nodes: NodeStateSnapshot[];
        if (options?.fromInitial) {
          const { wf, history } = options.fromInitial;
          nodes = buildLiveNodeStatesFromInitial(dsl, wf, history, mg);
        } else if (options?.fromPoll) {
          const base = buildLiveNodeStatesFromInitial(dsl, options.fromPoll, [], mg);
          nodes = applyRunnerPollToNodeStates(base, options.fromPoll);
        } else {
          nodes = buildLiveNodeStatesFromInitial(dsl, null, [], mg);
        }

        applyDslAndNodes(workflowId, dsl, view, nodes);
        setFeedEvents([]);
        feedSeqRef.current = 0;
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        const msg = e instanceof Error ? e.message : "Failed to load workflow DSL";
        setDslFetchError(msg);
      } finally {
        if (gen === loadGenRef.current) {
          setDslFetchInProgress(false);
        }
      }
    },
    [applyDslAndNodes, resolveViewJson]
  );

  const reconcileWorkflowCompletion = useCallback(
    async (workflowId: string, finalRunStatusOverride?: RunStatus) => {
      // terminal 시점에는 middleware가 node_status_change를 보내지 않는 스펙이라,
      // REST fallback이 실패해도 최소한 "현재 RUNNING 노드"는 즉시 마감한다.
      if (finalRunStatusOverride) {
        const lastWf = lastRunnerStatusRef.current?.workflow;
        const immediateWf: RunnerWorkflowInfo =
          lastWf && lastWf.workflow_id === workflowId
            ? lastWf
            : {
                workflow_id: workflowId,
                started_at: "",
                updated_at: "",
                progress: {
                  completed_states: [],
                  current_state: "",
                  pending_states: []
                },
                node_history: [],
                execution_stats: {}
              };

        setRunStatusForDag(finalRunStatusOverride);
        setNodeStates((prev) =>
          applyTerminalWorkflowToNodeStates(prev, immediateWf, finalRunStatusOverride)
        );
      }

      try {
        const base = getMiddlewareHttpBaseForBrowser();
        const url = `${base}/api/v1/workflows/${encodeURIComponent(workflowId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          return;
        }
        const info = (await res.json()) as {
          workflow_id?: string;
          status?: string;
          current_node?: string;
          progress?: RunnerWorkflowInfo["progress"];
          started_at?: string;
          updated_at?: string;
          node_history?: MiddlewareNodeHistoryItem[];
        };
        const s = String(info.status || "").toLowerCase();
        let finalStatus: RunStatus;
        if (s === "failed" || s === "failure" || s === "error") {
          finalStatus = RunStatus.FAILED;
        } else if (s === "cancelled" || s === "canceled") {
          finalStatus = RunStatus.CANCELED;
        } else {
          finalStatus = RunStatus.SUCCESS;
        }
        if (finalRunStatusOverride) {
          finalStatus = finalRunStatusOverride;
        }
        setRunStatusForDag(finalStatus);

        const wfInfo: RunnerWorkflowInfo = {
          workflow_id: info.workflow_id ?? workflowId,
          current_node: info.current_node,
          progress: info.progress,
          started_at: info.started_at ?? "",
          updated_at: info.updated_at ?? "",
          node_history: info.node_history ?? [],
          execution_stats: {}
        };

        setNodeStates((prev) => applyTerminalWorkflowToNodeStates(prev, wfInfo, finalStatus));
      } catch {
        // 모니터 UI 보정용이므로 실패 시 무시
      }
    },
    []
  );

  const loadWorkflowDslRef = useRef(loadWorkflowDsl);
  useEffect(() => {
    loadWorkflowDslRef.current = loadWorkflowDsl;
  }, [loadWorkflowDsl]);

  const appendFeedRef = useRef(appendFeed);
  useEffect(() => {
    appendFeedRef.current = appendFeed;
  }, [appendFeed]);

  // --- WebSocket (deps: reconnectNonce only; handlers use refs) ---
  useEffect(() => {
    intentionalCloseRef.current = false;
    setWsError(null);
    setWsReadyState(WebSocket.CONNECTING);

    let ws: WebSocket;
    try {
      ws = new WebSocket(getMonitorWebSocketUrl());
    } catch (e) {
      setWsReadyState(WebSocket.CLOSED);
      setWsError(e instanceof Error ? e.message : "WebSocket init failed");
      return;
    }

    const pingTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* ignore */
        }
      }
    }, PING_MS);

    ws.onopen = () => {
      setWsReadyState(ws.readyState);
      setWsError(null);
    };
    ws.onerror = () => {
      setWsError("WebSocket error");
    };
    ws.onclose = () => {
      window.clearInterval(pingTimer);
      setWsReadyState(WebSocket.CLOSED);
      if (!intentionalCloseRef.current) {
        window.setTimeout(() => setReconnectNonce((n) => n + 1), WS_RECONNECT_MS);
      }
    };

    ws.onmessage = (ev) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(data.type || "").toLowerCase();

      if (type === "initial") {
        setInitialBootstrapDone(true);
        const wf = parseInitialWorkflow(data);
        const history = extractNodeHistoryFromInitialPayload(data);
        if (wf?.workflow_id) {
          const wid = wf.workflow_id;
          if (wid !== loadedWorkflowIdRef.current) {
            void loadWorkflowDslRef.current(wid, { fromInitial: { wf, history } });
          } else {
            const dsl = dslJsonRef.current;
            if (dsl) {
              const mg = buildMonitorGraph(dsl);
              setNodeStates(buildLiveNodeStatesFromInitial(dsl, wf, history, mg));
            }
          }
        }
        return;
      }

      if (type === "pong") return;

      const msgWid = typeof data.workflow_id === "string" ? data.workflow_id : null;
      const currentId = loadedWorkflowIdRef.current;

      if (type === "feedback") {
        if (msgWid && msgWid !== loadedWorkflowIdRef.current) return;
        const nodeName = typeof data.node_name === "string" ? data.node_name : null;
        if (!nodeName) return;
        const dsl = dslJsonRef.current;
        const patches = graphPatchesRef.current;
        const baseGraph =
          ENABLE_DYNAMIC_GRAPH_PATCH && patches.length > 0 && dsl
            ? applyGraphPatches(buildMonitorGraph(dsl), patches)
            : dsl
              ? buildMonitorGraph(dsl)
              : null;
        const key = resolveMiddlewareDebugStateKey(nodeName, baseGraph);
        const fb = data.feedback;
        const feedback =
          fb && typeof fb === "object" && !Array.isArray(fb)
            ? (fb as Record<string, unknown>)
            : null;
        if (feedback) {
          setMiddlewareWsDebug((prevDbg) => ({
            ...prevDbg,
            [key]: { ...prevDbg[key], feedback }
          }));
        }
        return;
      }

      if (type === "node_status_change") {
        // spec상 terminal 시점엔 node_status_change가 없더라도,
        // 네트워크/스레드 지연으로 "늦게 도착한" node_status_change가
        // terminal 보정을 덮어쓰지 않도록 방어한다.
        if (runStatusForDagRef.current && isRunTerminal(runStatusForDagRef.current)) {
          return;
        }

        if (msgWid && msgWid !== currentId) {
          const pollWf = lastRunnerStatusRef.current?.workflow;
          void loadWorkflowDslRef.current(msgWid, pollWf ? { fromPoll: pollWf } : undefined);
          return;
        }
        if (!msgWid || msgWid === loadedWorkflowIdRef.current) {
          const dsl = dslJsonRef.current;
          const patches = graphPatchesRef.current;
          const baseGraph =
            ENABLE_DYNAMIC_GRAPH_PATCH && patches.length > 0 && dsl
              ? applyGraphPatches(buildMonitorGraph(dsl), patches)
              : dsl
                ? buildMonitorGraph(dsl)
                : null;
          setNodeStates((prev) => applyNodeStatusChangeMessage(prev, data, baseGraph));
          const nodeName = typeof data.node_name === "string" ? data.node_name : null;
          if (nodeName && baseGraph) {
            const key = resolveMiddlewareDebugStateKey(nodeName, baseGraph);
            const io = pickInputOutputFromMiddlewareMessage(data);
            if (io.input !== undefined || io.output !== undefined) {
              setMiddlewareWsDebug((prevDbg) => ({
                ...prevDbg,
                [key]: {
                  ...prevDbg[key],
                  ...(io.input !== undefined ? { input: io.input } : {}),
                  ...(io.output !== undefined ? { output: io.output } : {})
                }
              }));
            }
          }
          const widForFeed = msgWid || loadedWorkflowIdRef.current || "runner";
          feedSeqRef.current += 1;
          appendFeedRef.current(
            runEventFromMiddlewareNodeStatusChange(widForFeed, widForFeed, data, {
              seq: feedSeqRef.current,
              eventId: `mw-${feedSeqRef.current}`
            })
          );
        }
        return;
      }

      if (type === "workflow_completed" || type === "workflow_cancelled") {
        if (msgWid && currentId && msgWid !== currentId) return;
        const wid = msgWid ?? currentId;
        const finalStatus =
          type === "workflow_cancelled" ? RunStatus.CANCELED : workflowCompletedRunStatus(data);
        if (wid) {
          setRunStatusForDag(finalStatus);
          void reconcileWorkflowCompletion(wid, finalStatus);
        }
        return;
      }

      if (type === "graph_patch" && ENABLE_DYNAMIC_GRAPH_PATCH) {
        const p = parseGraphPatchMessage(data);
        if (p && msgWid === loadedWorkflowIdRef.current) {
          setGraphPatches((prev) => [...prev, p]);
        }
      }
    };

    return () => {
      intentionalCloseRef.current = true;
      window.clearInterval(pingTimer);
      ws.close();
    };
  }, [reconnectNonce]);

  // --- Poll runner status (workflow detection / idle — node updates come from WebSocket) ---
  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      void middlewareApi
        .getRunnerStatus()
        .then((rs) => {
          if (cancelled) return;
          setLastRunnerStatus(rs);

          const prev = lastRunnerStatusRef.current;
          const prevActive = runnerStatusIndicatesActiveWorkflow(prev);
          const prevWid = prev?.workflow?.workflow_id;
          const currentActive = runnerStatusIndicatesActiveWorkflow(rs);
          const currentWid = rs.workflow?.workflow_id;

          if (
            prevActive &&
            prevWid &&
            (!currentActive || currentWid !== prevWid) &&
            runStatusForDagRef.current === RunStatus.RUNNING
          ) {
            void reconcileWorkflowCompletion(prevWid);
          }

          if (!currentActive) {
            // Idle after having run something: keep the last loaded graph on screen.
            // Only reset when user hasn't loaded any workflow yet.
            return;
          }

          const wf = rs.workflow!;
          const wid = wf.workflow_id;
          if (!wid) return;

          if (wid !== loadedWorkflowIdRef.current) {
            void loadWorkflowDslRef.current(wid, { fromPoll: wf });
          }
        })
        .catch(() => {
          /* ignore transient poll errors */
        });
    };

    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const baseMonitorGraph = useMemo(
    () => buildMonitorGraph(dslJson ?? undefined),
    [dslJson]
  );

  const monitorGraph = useMemo(() => {
    if (!ENABLE_DYNAMIC_GRAPH_PATCH || graphPatches.length === 0) return baseMonitorGraph;
    return applyGraphPatches(baseMonitorGraph, graphPatches);
  }, [baseMonitorGraph, graphPatches]);

  const takenBranchByConditionPathId = useMemo(
    () => computeTakenBranches(monitorGraph, feedEvents),
    [monitorGraph, feedEvents]
  );

  const onFailureApiStateNames = useMemo(
    () => collectOnFailureApiStateNames(dslJson),
    [dslJson]
  );

  const displayNodeStates = useMemo(() => {
    if (!dslJson || !monitorGraph) return nodeStates;
    const latest = nodeStates;
    const fromGraph: NodeStateSnapshot[] = monitorGraph.nodes.map((mn) => {
      const snap =
        latest.find((s) => s.stateName === mn.apiStateName) ??
        latest.find((s) => s.stateName === mn.stateName);
      return {
        stateName: mn.apiStateName,
        nodeName: mn.nodeName,
        status: snap?.status ?? NodeStatus.WAITING,
        durationMs: snap?.durationMs ?? null
      };
    });
    const map = new Map(fromGraph.map((n) => [n.stateName, n]));
    latest.forEach((n) => {
      if (!map.has(n.stateName)) map.set(n.stateName, n);
    });
    return Array.from(map.values());
  }, [dslJson, monitorGraph, nodeStates]);

  const failureHandlingFlowActive = useMemo(() => {
    if (onFailureApiStateNames.size === 0) return false;
    return displayNodeStates.some(
      (n) => onFailureApiStateNames.has(n.stateName) && n.status === NodeStatus.RUNNING
    );
  }, [displayNodeStates, onFailureApiStateNames]);

  const debugStateName = useMemo(
    () => (selectedNode ? pathIdToApiStateName(selectedNode) : ""),
    [selectedNode]
  );

  const { data: skillsetsResponse } = useQuery({
    queryKey: ["skillsets"],
    queryFn: () => skillsetsApi.list()
  });

  const { data: runsForWorkflow = [] } = useQuery({
    queryKey: ["runs", "by-workflow", loadedWorkflowId],
    queryFn: () => runsApi.list({ workflowId: loadedWorkflowId! }),
    enabled: Boolean(loadedWorkflowId)
  });

  const resolvedRunId = useMemo(() => {
    const active = runsForWorkflow.find(
      (r) => r.status === RunStatus.RUNNING || r.status === RunStatus.WAITING
    );
    if (active) return active.runId;
    const sorted = [...runsForWorkflow].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    return sorted[0]?.runId ?? null;
  }, [runsForWorkflow]);

  const { data: studioNodeDebug } = useQuery({
    queryKey: ["node-debug", resolvedRunId, debugStateName],
    queryFn: () => runsApi.getNodeDebug(resolvedRunId!, debugStateName),
    enabled: Boolean(resolvedRunId && selectedNode && debugStateName),
    retry: false
  });

  const historyDebugByState = useMemo(() => {
    const hist = lastRunnerStatus?.workflow?.node_history ?? [];
    const map = new Map<string, { input?: Record<string, unknown> | null; output?: Record<string, unknown> | null }>();
    for (const h of hist) {
      const name = h.node_name || h.name;
      if (!name) continue;
      if (!monitorGraph) {
        map.set(name, { input: h.input ?? null, output: h.output ?? null });
        continue;
      }
      const mn = monitorGraph.nodes.find((m) => m.stateName === name || m.apiStateName === name);
      const key = mn?.apiStateName ?? name;
      map.set(key, { input: h.input ?? null, output: h.output ?? null });
    }
    return map;
  }, [lastRunnerStatus?.workflow?.node_history, monitorGraph]);

  const selectedMonitorNode = useMemo(() => {
    if (!selectedNode || !monitorGraph) return null;
    return monitorGraph.nodes.find((n) => n.pathId === selectedNode) ?? null;
  }, [selectedNode, monitorGraph]);

  const selectedNodeState = useMemo(() => {
    if (!selectedNode) return null;
    if (monitorGraph) {
      const node = selectedMonitorNode;
      if (!node) return null;
      const snap =
        displayNodeStates.find((n) => n.stateName === node.apiStateName) ??
        displayNodeStates.find((n) => n.stateName === node.stateName);
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
    return displayNodeStates.find((n) => n.stateName === selectedNode) ?? null;
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

  const displayNodeDebug = useMemo((): NodeDebugBundle | null => {
    if (!debugStateName || !selectedNodeState) return null;
    const hist = historyDebugByState.get(debugStateName);
    const ws = middlewareWsDebug[debugStateName];
    const studio = studioNodeDebug;
    if (!studio && !hist && !ws) return null;
    return {
      runId: studio?.runId ?? "",
      stateName: studio?.stateName ?? debugStateName,
      nodeName: studio?.nodeName ?? selectedNodeState.nodeName,
      status: studio?.status ?? selectedNodeState.status,
      durationMs: studio?.durationMs ?? selectedNodeState.durationMs ?? null,
      input: (ws?.input ?? hist?.input ?? studio?.input) ?? null,
      output: (ws?.output ?? hist?.output ?? studio?.output) ?? null,
      feedback: (ws?.feedback ?? studio?.feedback) ?? null,
      decision: studio?.decision
    };
  }, [
    debugStateName,
    selectedNodeState,
    historyDebugByState,
    middlewareWsDebug,
    studioNodeDebug
  ]);

  const wsConnected = displayWsReadyState === WebSocket.OPEN;
  const showGraph = Boolean(dslJson && monitorGraph && loadedWorkflowId);
  const showEmpty =
    initialBootstrapDone &&
    !dslFetchInProgress &&
    !showGraph &&
    !loadedWorkflowId &&
    !dslJson &&
    !runnerStatusIndicatesActiveWorkflow(lastRunnerStatus);

  const connectionLabel =
    displayWsReadyState === WebSocket.CONNECTING || displayWsReadyState === null
      ? "Connecting…"
      : wsConnected
        ? "Connected"
        : "Disconnected";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Monitor</h1>
            <p className="mt-1 text-sm text-slate-500">
              Live middleware runner — independent of dashboard run detail.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                wsConnected ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
              )}
            >
              {connectionLabel}
            </span>
            {lastRunnerStatus && (
              <span className="text-slate-600">
                Runner: <code className="text-xs">{lastRunnerStatus.runner_status}</code>
              </span>
            )}
            {loadedWorkflowId && (
              <span className="text-slate-600">
                Workflow: <code className="text-xs">{loadedWorkflowId}</code>
              </span>
            )}
            {runStatusForDag && <StatusBadge status={runStatusForDag} />}
          </div>
        </div>
        {(wsErrorShown || dslFetchError) && (
          <p className="mt-3 text-sm text-red-600">{wsErrorShown ?? dslFetchError}</p>
        )}
      </div>

      {failureHandlingFlowActive && (
        <div
          className="flex-shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-medium text-amber-900">Failure-handling flow in progress</p>
          <p className="mt-0.5 text-amber-800/90">
            The workflow entered the OnFailure branch. Recovery steps are executing — the graph may look idle for main
            states while this path runs.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        {!initialBootstrapDone ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            Waiting for monitor connection…
          </div>
        ) : showGraph ? (
          <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="min-h-0 flex flex-col overflow-hidden">
              <Card
                title="DAG View"
                description="Live node updates from middleware WebSocket"
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <div className="flex min-h-0 flex-1 flex-col p-6">
                  <DagView
                    nodeStates={displayNodeStates}
                    selectedNode={selectedNode}
                    onSelectNode={setSelectedNode}
                    edges={[]}
                    runStatus={runStatusForDag}
                    viewJson={viewJson ?? undefined}
                    monitorGraph={monitorGraph ?? undefined}
                    shouldAutoFocusRunningNode={runStatusForDag === RunStatus.RUNNING}
                    takenBranchByConditionPathId={takenBranchByConditionPathId}
                  />
                </div>
              </Card>
            </div>
            {selectedNodeState ? (
              <Card title="Debug Panel" description="Node execution details">
                <div className="space-y-4 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">{selectedNodeState.nodeName}</p>
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
                        {JSON.stringify(displayNodeDebug?.input ?? {}, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-md bg-slate-50 p-3">
                      <p className="mb-1 font-semibold text-slate-900">Output</p>
                      <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600">
                        {JSON.stringify(displayNodeDebug?.output ?? {}, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-md bg-slate-50 p-3">
                      <p className="mb-1 font-semibold text-slate-900">Feedback</p>
                      <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600">
                        {JSON.stringify(displayNodeDebug?.feedback ?? {}, null, 2)}
                      </pre>
                    </div>
                    {displayNodeDebug?.decision && (
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="mb-1 font-semibold text-slate-900">Decision</p>
                        <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600">
                          {JSON.stringify(displayNodeDebug.decision, null, 2)}
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
              <Card title="Debug Panel" description="Select a node to inspect its debug bundle">
                <div className="flex min-h-[280px] items-center justify-center lg:min-h-0">
                  <p className="text-sm text-slate-500">
                    Click a node in the DAG view to inspect debug details.
                  </p>
                </div>
              </Card>
            )}
          </div>
        ) : dslFetchInProgress && !loadedWorkflowId ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            Loading workflow definition…
          </div>
        ) : showEmpty ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            No workflow is currently running
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            Loading…
          </div>
        )}
      </div>
      <ActionStatusToast toast={actionStatusToast} onDismiss={() => setActionStatusToast(null)} />
    </div>
  );
}
