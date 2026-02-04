"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { middlewareApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { buildMonitorGraph } from "@/features/monitor/monitorGraph";
import { DagView } from "@/features/monitor/DagView";
import { NodeStatus, RunStatus } from "@/domain/types";
import type { NodeStateSnapshot } from "@/api/interfaces";
import type { WorkflowRunValidationError } from "@/api/interfaces";

type ExecutionState = {
  workflow_id: string;
  status: "running" | "cancelled";
} | null;

function getValidationMessage(err: unknown): string {
  const e = err as Error & { body?: WorkflowRunValidationError };
  if (e?.body?.message) return e.body.message;
  if (e?.body?.details?.reason) return `${e.body.message || "Validation error"}: ${e.body.details.reason}`;
  if (e?.body?.details?.state) return `${e.body?.message || "Validation error"} (state: ${e.body.details.state})`;
  return err instanceof Error ? err.message : "Failed to start execution";
}

export default function MonitorWorkflowPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.workflowId as string;
  const [executionState, setExecutionState] = useState<ExecutionState>(null);

  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });
  const workflowName =
    workflows.find((w) => w.workflowId === workflowId)?.name ?? workflowId;

  const { data: workflowDraft, isLoading: draftLoading } = useQuery({
    queryKey: ["workflow-draft", workflowId],
    queryFn: () => workflowsApi.getDraft(workflowId)
  });

  const { data: runnerStatus } = useQuery({
    queryKey: ["runner-status"],
    queryFn: () => middlewareApi.getRunnerStatus(),
    refetchInterval: executionState?.status === "running" ? 2000 : false,
    enabled: executionState?.status === "running"
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!workflowDraft?.dsl_json || typeof workflowDraft.dsl_json !== "object") {
        throw new Error("Workflow draft or DSL is missing");
      }
      return middlewareApi.runWorkflowStart(workflowDraft.dsl_json as Record<string, unknown>);
    },
    onSuccess: (res) => {
      setExecutionState({ workflow_id: res.workflow_id, status: res.status });
    },
    onError: (err) => {
      console.error("Execute failed", err);
      if (typeof window !== "undefined") {
        window.alert(getValidationMessage(err));
      }
    }
  });

  const cancelMutation = useMutation({
    mutationFn: () => middlewareApi.runWorkflowCancel(),
    onSuccess: (res) => {
      setExecutionState({ workflow_id: res.workflow_id, status: "cancelled" });
    },
    onError: (err) => {
      console.error("Cancel failed", err);
      if (typeof window !== "undefined") {
        window.alert(err instanceof Error ? err.message : "Failed to cancel");
      }
    }
  });

  const isRunning = executionState?.status === "running";
  const isCancelled = executionState?.status === "cancelled";

  const monitorGraph = workflowDraft
    ? buildMonitorGraph(workflowDraft.dsl_json)
    : null;

  const edges =
    workflowDraft?.dsl_json && typeof workflowDraft.dsl_json === "object"
      ? (() => {
          const dsl = workflowDraft.dsl_json as {
            States?: Record<string, { Next?: string; Choices?: Array<{ Next?: string }> }>;
          };
          if (!dsl.States) return [];
          const edgeMap = new Map<string, { from: string; to: string }>();
          let edgeIndex = 0;
          Object.entries(dsl.States).forEach(([stateName, state]) => {
            if (state.Next && typeof state.Next === "string") {
              const key = `${stateName}-${state.Next}`;
              if (!edgeMap.has(key))
                edgeMap.set(key, { from: stateName, to: state.Next! });
            }
            (state.Choices ?? []).forEach((c) => {
              if (c?.Next && typeof c.Next === "string") {
                const key = `${stateName}-${c.Next}`;
                if (!edgeMap.has(key))
                  edgeMap.set(key, { from: stateName, to: c.Next! });
              }
            });
          });
          return Array.from(edgeMap.values()).map((e) => ({
            id: `edge-${edgeIndex++}`,
            from: e.from,
            to: e.to
          }));
        })()
      : [];

  const progress = runnerStatus && "workflow" in runnerStatus ? runnerStatus.workflow?.progress : null;

  const allNodes: NodeStateSnapshot[] = useMemo(() => {
    if (!workflowDraft?.dsl_json || typeof workflowDraft.dsl_json !== "object") return [];
    const dsl = workflowDraft.dsl_json as { States?: Record<string, { Label?: string }> };
    if (!dsl.States) return [];
    const completedSet = new Set(progress?.completed_states ?? []);
    const currentState = progress?.current_state ?? null;
    return Object.entries(dsl.States).map(([stateName, state]) => {
      let status = NodeStatus.WAITING;
      if (completedSet.has(stateName)) status = NodeStatus.SUCCEEDED;
      else if (currentState === stateName && isRunning) status = NodeStatus.RUNNING;
      return {
        stateName,
        nodeName: (state.Label as string) || stateName,
        status,
        durationMs: null
      };
    });
  }, [workflowDraft?.dsl_json, progress, isRunning]);

  if (draftLoading || !workflowId) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        Loading...
      </div>
    );
  }

  if (!workflowDraft) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-slate-600">Workflow not found.</p>
        <Button variant="secondary" onClick={() => router.push("/")}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{workflowName}</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push(`/editor/${workflowId}`)}
              className="inline-flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
              Edit
            </Button>
            {!isRunning && (
              <Button
                onClick={() => executeMutation.mutate()}
                disabled={executeMutation.isPending}
                className="inline-flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" />
                </svg>
                {executeMutation.isPending ? "Starting..." : "Execute"}
              </Button>
            )}
            {isRunning && (
              <Button
                variant="secondary"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="inline-flex items-center gap-2"
              >
                {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {executionState && (
            <>
              <span className="text-slate-500">
                {isRunning && "Execution running."}
                {isCancelled && "Execution cancelled."}
                {executionState.workflow_id && (
                  <span className="ml-1 font-mono text-slate-600">{executionState.workflow_id}</span>
                )}
              </span>
              {runnerStatus && "workflow" in runnerStatus && runnerStatus.workflow && (
                <span className="text-slate-500">
                  Current: <span className="font-medium text-slate-700">{runnerStatus.workflow.current_node}</span>
                </span>
              )}
            </>
          )}
          {!executionState && (
            <p className="text-slate-500">
              Click Execute to run this workflow via the middleware runner. Use Cancel to stop a running execution.
            </p>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <Card
          title="DAG View"
          description={
            isRunning
              ? "Live execution: node status updates from runner."
              : isCancelled
                ? "Execution was cancelled."
                : "Workflow structure. Click Execute to run."
          }
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col p-6">
            <DagView
              nodeStates={allNodes}
              selectedNode={null}
              onSelectNode={() => {}}
              edges={edges}
              runStatus={isRunning ? RunStatus.RUNNING : isCancelled ? RunStatus.CANCELED : null}
              viewJson={workflowDraft.view_json}
              monitorGraph={monitorGraph ?? undefined}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
