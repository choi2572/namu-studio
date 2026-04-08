"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { runsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Popover } from "@/components/Popover";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableCell, TableHead, TableRow } from "@/components/Table";
import { RunStatus } from "@/domain/types";
import { formatDateTime, formatDuration } from "@/lib/format";

const RUNS_PAGE_SIZE = 10;

export function HistoryPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | RunStatus>("all");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d" | "all">("all");
  const [runsPage, setRunsPage] = useState(1);

  useEffect(() => {
    setRunsPage(1);
  }, [statusFilter, workflowFilter, timeRange]);

  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["runs", statusFilter, workflowFilter, timeRange],
    queryFn: () =>
      runsApi.list({
        status: statusFilter === "all" ? undefined : statusFilter,
        workflowId: workflowFilter === "all" ? undefined : workflowFilter,
        timeRange
      })
  });

  const workflowOptions = useMemo(
    () => [
      { id: "all", name: "All Workflows" },
      ...workflows.map((wf) => ({
        id: wf.workflowId,
        name: wf.name
      }))
    ],
    [workflows]
  );

  const runsTotalPages = Math.max(1, Math.ceil(runs.length / RUNS_PAGE_SIZE));
  const paginatedRuns = useMemo(() => {
    const start = (runsPage - 1) * RUNS_PAGE_SIZE;
    return runs.slice(start, start + RUNS_PAGE_SIZE);
  }, [runs, runsPage]);

  return (
    <div className="space-y-6" data-testid="run-history-page">
      <div>
        <p className="text-xs text-slate-500">Run History</p>
        <h1 className="text-xl font-semibold">All Runs</h1>
      </div>

      <Card title="Filters" description="Filter by status, workflow, time">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | RunStatus)}
            className="cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Status</option>
            <option value={RunStatus.RUNNING}>RUNNING</option>
            <option value={RunStatus.SUCCESS}>SUCCESS</option>
            <option value={RunStatus.FAILED}>FAILED</option>
            <option value={RunStatus.CANCELED}>CANCELED</option>
          </select>
          <select
            value={workflowFilter}
            onChange={(event) => setWorkflowFilter(event.target.value)}
            className="cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {workflowOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <select
            value={timeRange}
            onChange={(event) => setTimeRange(event.target.value as "24h" | "7d" | "30d" | "all")}
            className="cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Time</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatusFilter("all");
              setWorkflowFilter("all");
              setTimeRange("all");
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      <Card title="Runs" description="Click a row to replay">
        <Table>
          <TableHead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Run ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                Workflow Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                Start Time
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Result</th>
            </tr>
          </TableHead>
          <tbody>
            {paginatedRuns.map((run) => (
              <TableRow
                key={run.runId}
                onClick={() => router.push(`/monitor/${run.runId}?mode=replay`)}
              >
                <TableCell>{run.runId}</TableCell>
                <TableCell>{run.workflowName}</TableCell>
                <TableCell>{formatDateTime(run.startedAt)}</TableCell>
                <TableCell>{formatDuration(run.durationMs)}</TableCell>
                <TableCell>
                  {run.status === RunStatus.FAILED ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      <Popover trigger={<StatusBadge status={run.status} />} align="right">
                        <p className="font-semibold text-slate-900">Failure</p>
                        <p className="mt-1 text-slate-600">Code: {run.failureCode ?? "UNKNOWN"}</p>
                        <p className="mt-1 text-slate-600">
                          {run.failureMessage ?? "No message provided."}
                        </p>
                      </Popover>
                    </div>
                  ) : (
                    <StatusBadge status={run.status} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
        {runsTotalPages > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">
              {runs.length} run{runs.length !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRunsPage((p) => Math.max(1, p - 1))}
                disabled={runsPage <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {runsPage} of {runsTotalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRunsPage((p) => Math.min(runsTotalPages, p + 1))}
                disabled={runsPage >= runsTotalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
