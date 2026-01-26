"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { workflowsApi, runsApi } from "@/api";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableCell, TableHead, TableRow } from "@/components/Table";
import { formatDateTime, formatDuration } from "@/lib/format";
import { RunStatus } from "@/domain/types";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";

export function DashboardPage() {
  const router = useRouter();
  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: () => runsApi.list()
  });

  const latestRun = [...runs].sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : -1
  )[0];
  const failedRuns = [...runs]
    .filter((run) => run.status === RunStatus.FAILED)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Top Section: Overview & Failures */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Overview Card */}
        <Card
          title="Overview"
          description="Current or most recent run"
          className="border-slate-200"
        >
          {latestRun ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-1">
                  <h4 className="text-base font-semibold text-slate-900">
                    {latestRun.workflowName}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Run ID: {latestRun.runId}
                  </p>
                </div>
                <StatusBadge status={latestRun.status} />
              </div>
              <div className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Started
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {formatDateTime(latestRun.startedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Elapsed Time
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {formatDuration(latestRun.durationMs)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push(`/monitor/${latestRun.runId}`)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                View Run Details →
              </button>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-slate-500">
                No runs yet
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Create a workflow to get started
              </p>
            </div>
          )}
        </Card>

        {/* Recent Failures Card */}
        <Card
          title="Recent Failures"
          description="Runs that need attention"
          actions={
            <Link
              href="/history"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              View all
            </Link>
          }
          className={cn(
            "border",
            failedRuns.length > 0
              ? "border-red-200 bg-red-50/30"
              : "border-slate-200"
          )}
        >
          {failedRuns.length > 0 ? (
            <ul className="space-y-2">
              {failedRuns.map((run) => (
                <li key={run.runId}>
                  <button
                    type="button"
                    onClick={() => router.push(`/monitor/${run.runId}`)}
                    className="w-full rounded-md border border-red-200 bg-white p-3 text-left transition-colors hover:border-red-300 hover:bg-red-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {run.workflowName}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500 truncate">
                          {run.runId}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-400">
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
            <div className="py-6 text-center">
              <p className="text-xs text-slate-500">
                No failed runs in recent history
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Workflow List Table */}
      <Card
        title="Workflows"
        description="Registered workflows and latest run information"
        className="border-slate-200"
      >
        {workflows.length > 0 ? (
          <Table>
            <TableHead>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                  Workflow Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                  Latest Run State
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                  Latest Run Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                  Actions
                </th>
              </tr>
            </TableHead>
            <tbody>
              {workflows.map((workflow) => (
                <TableRow
                  key={workflow.workflowId}
                  onClick={() => {
                    if (workflow.state === "DRAFT") {
                      router.push(`/editor/${workflow.workflowId}`);
                      return;
                    }
                    if (workflow.latestRun) {
                      router.push(`/monitor/${workflow.latestRun.runId}`);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-slate-900">
                        {workflow.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {workflow.workflowId}
                      </p>
                      {workflow.state === "DRAFT" && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Draft
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {workflow.latestRun ? (
                      <StatusBadge status={workflow.latestRun.status} />
                    ) : (
                      <span className="text-xs text-slate-400">No runs</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {workflow.latestRun ? (
                      <span className="text-sm text-slate-700">
                        {formatDuration(workflow.latestRun.durationMs)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(`/editor/${workflow.workflowId}`);
                      }}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-slate-500">
              No workflows yet
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Create your first workflow to get started
            </p>
          </div>
        )}
      </Card>

      {/* Floating Action Button */}
      <Link
        href="/editor/new"
        className="fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-2xl font-light text-white shadow-lg transition-all hover:bg-slate-800 hover:shadow-xl"
        title="Create new workflow"
      >
        +
      </Link>
    </div>
  );
}
