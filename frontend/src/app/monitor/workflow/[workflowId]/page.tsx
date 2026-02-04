"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";

import { runsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { buildMonitorGraph } from "@/features/monitor/monitorGraph";
import { DagView } from "@/features/monitor/DagView";
import { NodeStatus } from "@/domain/types";
import type { NodeStateSnapshot } from "@/api/interfaces";

export default function MonitorWorkflowPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.workflowId as string;

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

  const startRunMutation = useMutation({
    mutationFn: () => runsApi.startRun(workflowId),
    onSuccess: (run) => {
      router.push(`/monitor/${run.runId}`);
    },
    onError: (err) => {
      console.error("Failed to start run", err);
      if (typeof window !== "undefined") {
        window.alert(err instanceof Error ? err.message : "Failed to start run");
      }
    }
  });

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

  const allNodes: NodeStateSnapshot[] =
    workflowDraft?.dsl_json && typeof workflowDraft.dsl_json === "object"
      ? (() => {
          const dsl = workflowDraft.dsl_json as {
            States?: Record<string, { Label?: string }>;
          };
          if (!dsl.States) return [];
          return Object.entries(dsl.States).map(([stateName, state]) => ({
            stateName,
            nodeName: (state.Label as string) || stateName,
            status: NodeStatus.WAITING,
            durationMs: null
          }));
        })()
      : [];

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
            <Button
              onClick={() => startRunMutation.mutate()}
              disabled={startRunMutation.isPending}
              className="inline-flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 0 1 0 1.971l-11.54 6.347a1.125 1.125 0 0 1-1.667-.985V5.653Z" />
              </svg>
              {startRunMutation.isPending ? "Starting..." : "Run"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          No run yet. Click Run to start execution and monitor live.
        </p>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <Card
          title="DAG View"
          description="Workflow structure. Start a run to see live status."
          className="flex h-full flex-col overflow-hidden"
        >
          <div className="flex-1 min-h-0 p-6">
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
    </div>
  );
}
