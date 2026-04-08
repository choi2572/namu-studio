"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { middlewareApi, workflowsApi, runsApi } from "@/api";
import { downloadJsonFile, sanitizeDownloadFileBaseName } from "@/lib/downloadJsonFile";
import { pickDuplicateWorkflowName } from "@/lib/workflowDuplicateName";
import { dslJsonHasOnFailureKey, mergeDslOnFailureIfServerDropped } from "@/lib/dslOnFailure";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableCell, TableHead, TableRow } from "@/components/Table";
import { formatDateTime, formatDuration } from "@/lib/format";
import { RunStatus, NodeStatus } from "@/domain/types";
import type { RunSummary, WorkflowListItem } from "@/domain/types";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";

const WORKFLOWS_PAGE_SIZE = 10;

export function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [workflowPage, setWorkflowPage] = useState(1);
  const [workflowToDelete, setWorkflowToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    workflowId: string;
    x: number;
    y: number;
  } | null>(null);

  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: () => runsApi.list()
  });

  const latestRunsByWorkflow = useMemo(() => {
    const map = new Map<string, RunSummary>();
    runs.forEach((run) => {
      const existing = map.get(run.workflowId);
      if (!existing) {
        map.set(run.workflowId, run);
        return;
      }
      const existingTime = new Date(existing.startedAt).getTime();
      const nextTime = new Date(run.startedAt).getTime();
      if (Number.isNaN(existingTime) || (!Number.isNaN(nextTime) && nextTime > existingTime)) {
        map.set(run.workflowId, run);
      }
    });
    return map;
  }, [runs]);

  const workflowTotalPages = Math.max(1, Math.ceil(workflows.length / WORKFLOWS_PAGE_SIZE));
  const paginatedWorkflows = useMemo(() => {
    const start = (workflowPage - 1) * WORKFLOWS_PAGE_SIZE;
    return workflows.slice(start, start + WORKFLOWS_PAGE_SIZE);
  }, [workflows, workflowPage]);

  useEffect(() => {
    if (workflowPage > workflowTotalPages) {
      setWorkflowPage(workflowTotalPages);
    }
  }, [workflowPage, workflowTotalPages]);

  const latestRun = [...runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  const failedRuns = [...runs]
    .filter((run) => run.status === RunStatus.FAILED)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 3);

  const totalRuns = runs.length;
  const successRuns = runs.filter((run) => run.status === RunStatus.SUCCESS).length;

  // Runner가 running일 때 Latest Run 카드에 미들웨어 정보 표시용
  const { data: runnerStatus } = useQuery({
    queryKey: ["middleware-runner-status"],
    queryFn: () => middlewareApi.getRunnerStatus()
  });
  const runnerWorkflow =
    runnerStatus?.runner_status === "running" ? (runnerStatus.workflow ?? null) : null;
  const isRunnerRunning = Boolean(runnerWorkflow);
  const runnerCurrentNode =
    isRunnerRunning &&
    (runnerWorkflow?.progress?.current_state ?? runnerWorkflow?.current_node ?? null);
  const runnerStartedAt = isRunnerRunning ? (runnerWorkflow?.started_at ?? null) : null;
  const runnerElapsedMs = (() => {
    if (!isRunnerRunning) return null;
    const started = new Date(runnerWorkflow?.started_at ?? "").getTime();
    const updated = new Date(runnerWorkflow?.updated_at ?? "").getTime();
    if (Number.isNaN(started) || Number.isNaN(updated)) return null;
    return Math.max(0, updated - started);
  })();

  // Get snapshot for latest run if it's running
  const isLatestRunActive =
    latestRun && (latestRun.status === RunStatus.RUNNING || latestRun.status === RunStatus.WAITING);
  const { data: latestRunSnapshot } = useQuery({
    queryKey: ["run-snapshot", latestRun?.runId],
    queryFn: () => runsApi.getSnapshot(latestRun!.runId),
    enabled: Boolean(latestRun && isLatestRunActive)
  });

  // Find current running node
  const currentRunningNode = latestRunSnapshot?.nodeStates.find(
    (node) => node.status === NodeStatus.RUNNING
  );

  const duplicateMutation = useMutation({
    mutationFn: async (workflow: WorkflowListItem) => {
      const names = new Set(workflows.map((w) => w.name));
      const newName = pickDuplicateWorkflowName(workflow.name, names);
      const created = await workflowsApi.create({ name: newName });
      const source = await workflowsApi.getDraft(workflow.workflowId);
      const sentDsl = JSON.parse(JSON.stringify(source.dsl_json ?? {})) as Record<string, unknown>;
      let saved = await workflowsApi.saveDraft(created.workflowId, {
        workflowId: created.workflowId,
        dsl_json: sentDsl,
        view_json: {},
        updatedAt: new Date().toISOString()
      });
      const fixedDsl = mergeDslOnFailureIfServerDropped(
        (saved.dsl_json ?? {}) as Record<string, unknown>,
        sentDsl
      );
      if (
        dslJsonHasOnFailureKey(sentDsl) &&
        !dslJsonHasOnFailureKey(saved.dsl_json as Record<string, unknown>)
      ) {
        saved = await workflowsApi.saveDraft(created.workflowId, {
          workflowId: created.workflowId,
          dsl_json: fixedDsl,
          view_json: {},
          updatedAt: new Date().toISOString()
        });
      }
      return created;
    },
    onSuccess: () => {
      setRowMenu(null);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (error: unknown) => {
      console.error("Failed to duplicate workflow", error);
      if (typeof window !== "undefined") {
        window.alert("Failed to duplicate workflow.");
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (workflowId: string) => workflowsApi.delete(workflowId),
    onSuccess: () => {
      setWorkflowToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (error: unknown) => {
      console.error("Failed to delete workflow", error);
      if (typeof window !== "undefined") {
        window.alert("Failed to delete workflow. The backend delete API may not be available yet.");
      }
    }
  });

  const handleConfirmDelete = () => {
    if (!workflowToDelete) return;
    deleteMutation.mutate(workflowToDelete.id);
  };

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {rowMenu ? (
        <>
          <div className="fixed inset-0 z-20" aria-hidden onClick={() => setRowMenu(null)} />
          {(() => {
            const menuWorkflow = workflows.find((w) => w.workflowId === rowMenu.workflowId);
            if (!menuWorkflow) return null;
            return (
              <div
                className="fixed z-30 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                style={{ left: rowMenu.x, top: rowMenu.y }}
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full cursor-pointer px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={async (event) => {
                    event.stopPropagation();
                    setRowMenu(null);
                    try {
                      const draft = await workflowsApi.getDraft(menuWorkflow.workflowId);
                      const base = sanitizeDownloadFileBaseName(menuWorkflow.name);
                      downloadJsonFile(`${base}.json`, draft.dsl_json ?? {});
                    } catch (error) {
                      console.error("Failed to export workflow", error);
                      window.alert("Failed to export workflow.");
                    }
                  }}
                >
                  Export
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full cursor-pointer px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  disabled={duplicateMutation.isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    duplicateMutation.mutate(menuWorkflow);
                  }}
                >
                  {duplicateMutation.isPending ? "Duplicating…" : "Duplicate"}
                </button>
              </div>
            );
          })()}
        </>
      ) : null}
      {/* Stats Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-slate-200 bg-white">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Total Workflows</p>
            <p className="text-3xl font-bold text-slate-900">{workflows.length}</p>
          </div>
        </Card>
        <Card className="border-slate-200 bg-white">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Total Runs</p>
            <p className="text-3xl font-bold text-slate-900">{totalRuns}</p>
          </div>
        </Card>
        <Card className="border-slate-200 bg-white">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Success Rate</p>
            <p className="text-3xl font-bold text-slate-900">
              {totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0}
              <span className="text-lg text-slate-500">%</span>
            </p>
          </div>
        </Card>
      </div>

      {/* Top Section: Overview & Failures */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Overview Card */}
        <Card
          title="Latest Run"
          description="Current or most recent run"
          className="border-2 border-slate-300 bg-gradient-to-br from-white to-slate-50"
        >
          {latestRun || isRunnerRunning ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <h4 className="text-xl font-bold text-slate-900">
                    {latestRun?.workflowName ?? runnerStatus?.workflow?.workflow_id ?? "—"}
                  </h4>
                  <p className="text-sm text-slate-600">
                    {latestRun?.runId ??
                      (isRunnerRunning ? runnerStatus?.workflow?.workflow_id : null) ??
                      "—"}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  {latestRun && <StatusBadge status={latestRun.status} />}
                  {!latestRun && isRunnerRunning && <StatusBadge status={RunStatus.RUNNING} />}
                </div>
              </div>

              {/* Current node: runner running이면 미들웨어 값, 아니면 기존 snapshot */}
              {(isRunnerRunning && runnerCurrentNode) ||
              (isLatestRunActive && currentRunningNode) ? (
                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
                    Currently Running
                  </p>
                  <p className="mt-2 text-lg font-bold text-blue-900">
                    {isRunnerRunning && runnerCurrentNode
                      ? runnerCurrentNode
                      : currentRunningNode?.nodeName}
                  </p>
                </div>
              ) : latestRun && !isLatestRunActive ? (
                <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Status
                  </p>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {latestRun.status === RunStatus.SUCCESS && "✓ Completed"}
                    {latestRun.status === RunStatus.FAILED && "✗ Failed"}
                    {latestRun.status === RunStatus.CANCELED && "⊘ Canceled"}
                    {latestRun.status === RunStatus.CREATED && "○ Created"}
                    {!["SUCCESS", "FAILED", "CANCELED", "CREATED"].includes(latestRun.status) &&
                      latestRun.status}
                  </p>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-4 rounded-lg border-2 border-slate-200 bg-white p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Started
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {formatDateTime(
                      isRunnerRunning && runnerStartedAt
                        ? runnerStartedAt
                        : (latestRun?.startedAt ?? "")
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {isRunnerRunning ? "Elapsed" : "Duration"}
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {isRunnerRunning && runnerElapsedMs !== null
                      ? formatDuration(runnerElapsedMs)
                      : formatDuration(latestRun?.durationMs)}
                  </p>
                </div>
              </div>
              {latestRun && (
                <button
                  type="button"
                  onClick={() => router.push(`/monitor/${latestRun.runId}`)}
                  className="cursor-pointer w-full rounded-lg border-2 border-slate-900 bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                >
                  View Run Details →
                </button>
              )}
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-base font-semibold text-slate-600">No runs yet</p>
              <p className="mt-2 text-sm text-slate-400">Create a workflow to get started</p>
            </div>
          )}
        </Card>

        {/* Recent Failures Card */}
        <Card
          title={
            <div className="flex items-center gap-2">
              <span>Recent Failures</span>
              {failedRuns.length > 0 && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                  {failedRuns.length}
                </span>
              )}
            </div>
          }
          description="Runs that need attention"
          actions={
            <Link
              href="/history"
              className="cursor-pointer text-xs font-bold text-slate-600 hover:text-slate-900"
            >
              View all
            </Link>
          }
          className={cn(
            "border-2",
            failedRuns.length > 0
              ? "border-red-300 bg-gradient-to-br from-red-50 to-red-100/50"
              : "border-slate-200"
          )}
        >
          {failedRuns.length > 0 ? (
            <ul className="space-y-3">
              {failedRuns.map((run) => (
                <li key={run.runId}>
                  <button
                    type="button"
                    onClick={() => router.push(`/monitor/${run.runId}`)}
                    className="cursor-pointer w-full rounded-lg border-2 border-red-300 bg-white p-4 text-left transition-all hover:border-red-400 hover:bg-red-50 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {run.workflowName}
                        </p>
                        <p className="mt-1 text-xs text-slate-600 truncate">{run.runId}</p>
                        <p className="mt-2 text-xs font-medium text-slate-500">
                          {formatDateTime(run.startedAt)}
                        </p>
                      </div>
                      <StatusBadge status={run.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-slate-600">✓ All systems operational</p>
              <p className="mt-1 text-xs text-slate-400">No failed runs in recent history</p>
            </div>
          )}
        </Card>
      </div>

      {/* Workflow List Table */}
      <Card
        title="Workflows"
        description="Registered workflows and latest run information"
        className="border-2 border-slate-200"
      >
        {workflows.length > 0 ? (
          <>
            <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
              <Table>
                <TableHead>
                  <tr className="border-b-2 border-slate-200">
                    <th className="px-5 py-4 text-left text-sm font-bold text-slate-700">
                      Workflow Name
                    </th>
                    <th className="px-5 py-4 text-left text-sm font-bold text-slate-700">
                      Latest Run State
                    </th>
                    <th className="px-5 py-4 text-left text-sm font-bold text-slate-700">
                      Latest Run Duration
                    </th>
                    <th className="px-5 py-4 text-left text-sm font-bold text-slate-700">
                      Actions
                    </th>
                    <th className="w-12 px-2 py-4 text-left text-sm font-bold text-slate-700">
                      <span className="sr-only">More</span>
                    </th>
                  </tr>
                </TableHead>
                <tbody>
                  {paginatedWorkflows.map((workflow) => {
                    const latestRunForWorkflow =
                      workflow.latestRun ?? latestRunsByWorkflow.get(workflow.workflowId) ?? null;
                    return (
                      <TableRow
                        key={workflow.workflowId}
                        onClick={() => {
                          if (workflow.state === "DRAFT") {
                            router.push(`/editor/${workflow.workflowId}`);
                            return;
                          }
                          // PUBLISHED: 무조건 Run 화면 (여기서 Run 클릭 시 monitor로 이동)
                          router.push(`/monitor/workflow/${workflow.workflowId}`);
                        }}
                        className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                      >
                        <TableCell className="px-5 py-4">
                          <div className="space-y-1.5">
                            <p className="text-base font-bold text-slate-900">{workflow.name}</p>
                            <p className="text-xs text-slate-500">{workflow.workflowId}</p>
                            {workflow.state === "DRAFT" && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                                Draft
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-middle px-5 py-4">
                          {latestRunForWorkflow ? (
                            <StatusBadge status={latestRunForWorkflow.status} />
                          ) : (
                            <span className="text-sm font-medium text-slate-400">No runs</span>
                          )}
                        </TableCell>
                        <TableCell className="align-middle px-5 py-4">
                          {latestRunForWorkflow ? (
                            <span className="text-base font-semibold text-slate-700">
                              {formatDuration(latestRunForWorkflow.durationMs)}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="align-middle px-5 py-4">
                          <div className="flex h-9 items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/editor/${workflow.workflowId}`);
                              }}
                              className="cursor-pointer flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                              title="Edit workflow"
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
                                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setWorkflowToDelete({
                                  id: workflow.workflowId,
                                  name: workflow.name
                                });
                              }}
                              className="cursor-pointer flex items-center justify-center rounded-md border border-red-100 bg-white p-2 text-red-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              title="Delete workflow"
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
                                  d="M9.75 9.75v7.5M14.25 9.75v7.5M4.5 5.25h15M6.75 5.25l.75-1.5A1.5 1.5 0 0 1 8.88 3h6.24a1.5 1.5 0 0 1 1.35.75l.75 1.5m-12.47 0h12.47M6.75 5.25h10.5M8.25 5.25v-.75A1.5 1.5 0 0 1 9.75 3h4.5a1.5 1.5 0 0 1 1.5 1.5v.75"
                                />
                              </svg>
                            </button>
                          </div>
                        </TableCell>
                        <TableCell
                          className="w-12 align-middle px-2 py-4"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="inline-flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            aria-label="More actions"
                            aria-haspopup="menu"
                            aria-expanded={rowMenu?.workflowId === workflow.workflowId}
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setRowMenu((prev) =>
                                prev?.workflowId === workflow.workflowId
                                  ? null
                                  : {
                                      workflowId: workflow.workflowId,
                                      x: rect.left,
                                      y: rect.bottom + 4
                                    }
                              );
                            }}
                          >
                            <svg
                              className="h-5 w-5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                              aria-hidden
                            >
                              <circle cx="10" cy="5" r="2" />
                              <circle cx="10" cy="10" r="2" />
                              <circle cx="10" cy="15" r="2" />
                            </svg>
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            {workflowTotalPages > 1 && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500">
                  {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setWorkflowPage((p) => Math.max(1, p - 1))}
                    disabled={workflowPage <= 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-slate-600">
                    Page {workflowPage} of {workflowTotalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setWorkflowPage((p) => Math.min(workflowTotalPages, p + 1))}
                    disabled={workflowPage >= workflowTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-16 text-center">
            <p className="text-base font-semibold text-slate-600">No workflows yet</p>
            <p className="mt-2 text-sm text-slate-400">Create your first workflow to get started</p>
          </div>
        )}
      </Card>

      {workflowToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Delete workflow</h2>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{workflowToDelete.name}</span> will be
              deleted.
              <br />
              This action cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="cursor-pointer rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setWorkflowToDelete(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-md border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Button */}
      <Link
        href="/editor/new"
        className="cursor-pointer fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-2xl font-light text-white shadow-lg transition-all hover:bg-slate-800 hover:shadow-xl"
        title="Create new workflow"
      >
        +
      </Link>
    </div>
  );
}
