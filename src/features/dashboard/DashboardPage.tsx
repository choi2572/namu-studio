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

  const totalRuns = runs.length;
  const runningRuns = runs.filter((run) => run.status === RunStatus.RUNNING)
    .length;
  const successRuns = runs.filter((run) => run.status === RunStatus.SUCCESS)
    .length;

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200 bg-white">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Total Workflows</p>
            <p className="text-3xl font-bold text-slate-900">
              {workflows.length}
            </p>
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
            <p className="text-xs font-medium text-slate-500">Running Now</p>
            <p className="text-3xl font-bold text-emerald-600">
              {runningRuns}
            </p>
          </div>
        </Card>
        <Card className="border-slate-200 bg-white">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Success Rate</p>
            <p className="text-3xl font-bold text-slate-900">
              {totalRuns > 0
                ? Math.round((successRuns / totalRuns) * 100)
                : 0}
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
          {latestRun ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <h4 className="text-xl font-bold text-slate-900">
                    {latestRun.workflowName}
                  </h4>
                  <p className="text-sm text-slate-600">
                    {latestRun.runId}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <StatusBadge status={latestRun.status} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 rounded-lg border-2 border-slate-200 bg-white p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Started
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {formatDateTime(latestRun.startedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Duration
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {formatDuration(latestRun.durationMs)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push(`/monitor/${latestRun.runId}`)}
                className="w-full rounded-lg border-2 border-slate-900 bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
              >
                View Run Details →
              </button>
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-base font-semibold text-slate-600">
                No runs yet
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Create a workflow to get started
              </p>
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
              className="text-xs font-bold text-slate-600 hover:text-slate-900"
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
                    className="w-full rounded-lg border-2 border-red-300 bg-white p-4 text-left transition-all hover:border-red-400 hover:bg-red-50 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {run.workflowName}
                        </p>
                        <p className="mt-1 text-xs text-slate-600 truncate">
                          {run.runId}
                        </p>
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
              <p className="text-sm font-semibold text-slate-600">
                ✓ All systems operational
              </p>
              <p className="mt-1 text-xs text-slate-400">
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
        className="border-2 border-slate-200"
      >
        {workflows.length > 0 ? (
          <div className="overflow-x-auto">
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
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                  >
                    <TableCell className="px-5 py-4">
                      <div className="space-y-1.5">
                        <p className="text-base font-bold text-slate-900">
                          {workflow.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {workflow.workflowId}
                        </p>
                        {workflow.state === "DRAFT" && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                            Draft
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      {workflow.latestRun ? (
                        <StatusBadge status={workflow.latestRun.status} />
                      ) : (
                        <span className="text-sm font-medium text-slate-400">
                          No runs
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      {workflow.latestRun ? (
                        <span className="text-base font-semibold text-slate-700">
                          {formatDuration(workflow.latestRun.durationMs)}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-4">
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
          </div>
        ) : (
          <div className="py-16 text-center">
            <p className="text-base font-semibold text-slate-600">
              No workflows yet
            </p>
            <p className="mt-2 text-sm text-slate-400">
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
