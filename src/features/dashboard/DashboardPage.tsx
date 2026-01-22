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
  const failedRuns = runs.filter((run) => run.status === RunStatus.FAILED);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Overview" description="Latest run status snapshot">
          {latestRun ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">
                  {latestRun.workflowName}
                </p>
                <p className="text-xs text-slate-500">
                  Started {formatDateTime(latestRun.startedAt)} · Duration{" "}
                  {formatDuration(latestRun.durationMs)}
                </p>
              </div>
              <StatusBadge status={latestRun.status} />
            </div>
          ) : (
            <p className="text-sm text-slate-500">No runs yet.</p>
          )}
        </Card>
        <Card
          title="Recent Failures"
          description="Runs that need attention"
          actions={
            <Link
              href="/history"
              className="text-xs font-semibold text-slate-600"
            >
              View history
            </Link>
          }
        >
          {failedRuns.length > 0 ? (
            <ul className="space-y-3">
              {failedRuns.slice(0, 3).map((run) => (
                <li
                  key={run.runId}
                  className="flex items-center justify-between text-xs"
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/monitor/${run.runId}`)}
                    className="text-left text-slate-700 hover:text-slate-900"
                  >
                    {run.workflowName} · {run.runId}
                  </button>
                  <StatusBadge status={run.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              No failed runs in the recent window.
            </p>
          )}
        </Card>
      </div>

      <Card
        title="Workflows"
        description="Registered workflows and latest run info"
      >
        <Table>
          <TableHead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                Workflow
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                State
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                Latest Run
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                Duration
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
              >
                <TableCell>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{workflow.name}</p>
                    <p className="text-xs text-slate-500">
                      {workflow.workflowId}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={workflow.state} />
                </TableCell>
                <TableCell>
                  {workflow.latestRun ? (
                    <StatusBadge status={workflow.latestRun.status} />
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {workflow.latestRun ? (
                    formatDuration(workflow.latestRun.durationMs)
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
      </Card>

      <Link
        href="/editor/new"
        className="fixed bottom-8 right-10 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800"
      >
        +
      </Link>
    </div>
  );
}
