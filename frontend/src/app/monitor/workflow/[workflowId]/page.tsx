"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { runsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { buildMonitorGraph } from "@/features/monitor/monitorGraph";
import { DagView } from "@/features/monitor/DagView";
import { NodeStatus, RunStatus } from "@/domain/types";
import type { NodeStateSnapshot } from "@/api/interfaces";

function getRunErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Failed to start run";
  if (msg.includes("published version") || msg.includes("no published")) {
    return "This workflow is not published yet. Publish from the editor and try again.";
  }
  if (msg.includes("already active") || msg.includes("another run")) {
    return "Another run is in progress. Wait for it to finish or cancel it first.";
  }
  return msg;
}

export default function MonitorWorkflowPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.workflowId as string;
  const [runErrorToast, setRunErrorToast] = useState<string | null>(null);

  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });
  const workflowName =
    workflows.find((w) => w.workflowId === workflowId)?.name ?? workflowId;
  const workflowState = workflows.find((w) => w.workflowId === workflowId)?.state;
  const isPublished = workflowState === "PUBLISHED";

  const { data: workflowDraft, isLoading: draftLoading } = useQuery({
    queryKey: ["workflow-draft", workflowId],
    queryFn: () => workflowsApi.getDraft(workflowId)
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const run = await runsApi.startRun(workflowId);
      return run;
    },
    onSuccess: (run) => {
      router.push(`/monitor/${run.runId}`);
    },
    onError: (err) => {
      console.error("Start run failed", err);
      setRunErrorToast(getRunErrorMessage(err));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (targetWorkflowId: string) => workflowsApi.delete(targetWorkflowId),
    onSuccess: () => {
      router.push("/");
    },
    onError: (err) => {
      console.error("Delete workflow failed", err);
    }
  });

  useEffect(() => {
    if (!runErrorToast) return;
    const id = window.setTimeout(() => setRunErrorToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [runErrorToast]);

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

  const allNodes: NodeStateSnapshot[] = useMemo(() => {
    if (!workflowDraft?.dsl_json || typeof workflowDraft.dsl_json !== "object") return [];
    const dsl = workflowDraft.dsl_json as { States?: Record<string, { Label?: string }> };
    if (!dsl.States) return [];
    return Object.entries(dsl.States).map(([stateName, state]) => ({
      stateName,
      nodeName: (state.Label as string) || stateName,
      status: NodeStatus.WAITING,
      durationMs: null
    }));
  }, [workflowDraft?.dsl_json]);

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
    <div className="flex h-full flex-col overflow-hidden" data-testid="monitor-workflow-page">
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
            <Button
              variant="secondary"
              onClick={() => deleteMutation.mutate(workflowId)}
              className="inline-flex items-center gap-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-4 w-4 text-red-500"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 9.75v7.5M14.25 9.75v7.5M4.5 5.25h15M6.75 5.25l.75-1.5A1.5 1.5 0 0 1 8.88 3h6.24a1.5 1.5 0 0 1 1.35.75l.75 1.5m-12.47 0h12.47M6.75 5.25h10.5M8.25 5.25v-.75A1.5 1.5 0 0 1 9.75 3h4.5a1.5 1.5 0 0 1 1.5 1.5v.75"
                />
              </svg>
              Delete
            </Button>
            <Button
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending || !isPublished}
              className="inline-flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" />
              </svg>
              {executeMutation.isPending ? "Starting..." : "Run"}
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {!isPublished && (
            <p className="text-amber-700">
              This workflow is in Draft. Publish from the editor to run.
            </p>
          )}
          {isPublished && (
            <p className="text-slate-500">
              Click Run to start execution; you will be redirected to the monitor.
            </p>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <Card
          title="DAG View"
          description="Workflow structure. Click Run to start and open the monitor."
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col p-6">
            <DagView
              nodeStates={allNodes}
              selectedNode={null}
              onSelectNode={() => {}}
              edges={edges}
              runStatus={null}
              viewJson={workflowDraft.view_json}
              monitorGraph={monitorGraph ?? undefined}
            />
          </div>
        </Card>
      </div>
      {runErrorToast && (
        <div className="pointer-events-none fixed right-6 top-6 z-50">
          <div className="max-w-sm rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg">
            <p className="font-semibold">Run failed</p>
            <p className="mt-1">{runErrorToast}</p>
          </div>
        </div>
      )}
    </div>
  );
}
