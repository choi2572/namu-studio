"use client";

import { RunEvent } from "@/domain/types";
import { Table, TableCell, TableHead, TableRow } from "@/components/Table";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

// 노드 타입 정보 (DagView와 동일)
const NODE_TYPE_COLORS: Record<string, { border: string; bg: string; text: string; indicator: string }> = {
  skill: {
    border: "border-blue-200",
    bg: "bg-blue-50",
    text: "text-blue-700",
    indicator: "bg-blue-500"
  },
  flow_control: {
    border: "border-cyan-200",
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    indicator: "bg-cyan-500"
  },
  event: {
    border: "border-purple-200",
    bg: "bg-purple-50",
    text: "text-purple-700",
    indicator: "bg-purple-500"
  },
  condition: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-700",
    indicator: "bg-amber-500"
  }
};

function getNodeTypeInfo(nodeName: string, stateName: string): { type: string; colors: { border: string; bg: string; text: string; indicator: string } } {
  const name = (nodeName || stateName || "").toLowerCase();
  if (name.includes("condition") || name.includes("if")) {
    return { type: "Condition", colors: NODE_TYPE_COLORS.condition };
  }
  if (name.includes("skill") || name.includes("pick") || name.includes("place")) {
    return { type: "Skill", colors: NODE_TYPE_COLORS.skill };
  }
  if (name.includes("event") || name.includes("wait") || name.includes("webhook")) {
    return { type: "Event", colors: NODE_TYPE_COLORS.event };
  }
  return { type: "Flow Control", colors: NODE_TYPE_COLORS.flow_control };
}

// SVG 아이콘 컴포넌트
function EventIcon({ type }: { type: string }) {
  const iconProps = {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    viewBox: "0 0 24 24"
  };

  if (type.includes("CREATED") || type.includes("STARTED")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type.includes("SUCCEEDED")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type.includes("FAILED")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type.includes("CANCELED") || type.includes("STOP")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l6 6m0-6l-6 6" />
      </svg>
    );
  }
  if (type.includes("WAITING")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type.includes("SKIPPED")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
      </svg>
    );
  }
  if (type.includes("STATUS_CHANGED") || type.includes("REFRESH")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    );
  }
  if (type.includes("EXTERNAL_EVENT") || type.includes("RECEIVED")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  }
  if (type.includes("SAFETY") || type.includes("WARNING")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    );
  }
  if (type.includes("GRAPH_PATCH")) {
    return (
      <svg {...iconProps}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M4 16h8" />
      </svg>
    );
  }
  // 기본 아이콘
  return (
    <svg {...iconProps}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

type TimelineTableProps = {
  events: RunEvent[];
  /** pathId (DAG 선택용); 행 하이라이트는 selectedStateName으로 비교 */
  selectedNode: string | null;
  /** 이벤트 행 하이라이트용 stateName (pathId에서 추출한 apiStateName) */
  selectedStateName?: string | null;
  onSelectNode: (stateName: string) => void;
  nodeStates?: Array<{ stateName: string; nodeName: string; typeLabel?: string }>;
  /** 있으면 Node 컬럼 표시명을 이걸로만 사용 (DAG와 동일 소스 보장) */
  getNodeDisplayName?: (stateName: string) => string;
};

// 이벤트 타입별 색상 (아이콘은 SVG로 대체)
const EVENT_TYPE_CONFIG: Record<
  string,
  { color: string; bgColor: string }
> = {
  RUN_CREATED: {
    color: "text-blue-600",
    bgColor: "bg-blue-50"
  },
  RUN_STARTED: {
    color: "text-green-600",
    bgColor: "bg-green-50"
  },
  RUN_SUCCEEDED: {
    color: "text-emerald-600",
    bgColor: "bg-emerald-50"
  },
  RUN_FAILED: {
    color: "text-red-600",
    bgColor: "bg-red-50"
  },
  RUN_CANCELED: {
    color: "text-slate-600",
    bgColor: "bg-slate-50"
  },
  RUN_STATUS_CHANGED: {
    color: "text-amber-600",
    bgColor: "bg-amber-50"
  },
  NODE_STARTED: {
    color: "text-blue-600",
    bgColor: "bg-blue-50"
  },
  NODE_WAITING: {
    color: "text-amber-600",
    bgColor: "bg-amber-50"
  },
  NODE_SUCCEEDED: {
    color: "text-emerald-600",
    bgColor: "bg-emerald-50"
  },
  NODE_FAILED: {
    color: "text-red-600",
    bgColor: "bg-red-50"
  },
  NODE_SKIPPED: {
    color: "text-slate-500",
    bgColor: "bg-slate-50"
  },
  NODE_CANCELED: {
    color: "text-slate-600",
    bgColor: "bg-slate-50"
  },
  EXTERNAL_EVENT_RECEIVED: {
    color: "text-purple-600",
    bgColor: "bg-purple-50"
  },
  SAFETY_INTERRUPT: {
    color: "text-orange-600",
    bgColor: "bg-orange-50"
  },
  GRAPH_PATCH: {
    color: "text-violet-600",
    bgColor: "bg-violet-50"
  }
};

function getEventConfig(eventType: string) {
  return (
    EVENT_TYPE_CONFIG[eventType] ?? {
      color: "text-slate-600",
      bgColor: "bg-slate-50"
    }
  );
}

export function TimelineTable({
  events,
  selectedNode,
  selectedStateName = null,
  onSelectNode,
  nodeStates = [],
  getNodeDisplayName
}: TimelineTableProps) {
  const highlightStateName = selectedStateName ?? selectedNode;
  if (events.length === 0) {
    return (
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
          <tr>
            <TableCell colSpan={4} className="text-center text-slate-500">
              No events yet
            </TableCell>
          </tr>
        </tbody>
      </Table>
    );
  }

  return (
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
        {events.map((event) => {
          const config = getEventConfig(event.eventType);
          const nodeInfo = event.stateName
            ? nodeStates.find((n) => n.stateName === event.stateName)
            : null;
          const nodeTypeInfo = nodeInfo
            ? nodeInfo.typeLabel
              ? (() => {
                  const key = nodeInfo.typeLabel.toLowerCase().replace(/\s+/g, "_");
                  const colors = NODE_TYPE_COLORS[key] ?? NODE_TYPE_COLORS.flow_control;
                  return { type: nodeInfo.typeLabel, colors };
                })()
              : getNodeTypeInfo(nodeInfo.nodeName, event.stateName || "")
            : null;

          return (
            <TableRow
              key={event.eventId}
              onClick={() => {
                if (event.stateName) {
                  onSelectNode(event.stateName);
                }
              }}
              className={cn(
                "cursor-pointer transition-colors",
                event.stateName && highlightStateName === event.stateName && "bg-blue-50"
              )}
            >
              <TableCell className="font-mono text-slate-600">
                {event.seq}
              </TableCell>
              <TableCell className="text-slate-600">
                {formatDateTime(event.timestamp)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className={cn("flex items-center justify-center", config.color)}>
                    <EventIcon type={event.eventType} />
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      config.color,
                      config.bgColor
                    )}
                  >
                    {event.eventType}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                {event.stateName ? (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">
                      {getNodeDisplayName
                        ? getNodeDisplayName(event.stateName)
                        : nodeInfo?.nodeName || event.stateName}
                    </span>
                    {nodeTypeInfo && (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          nodeTypeInfo.colors.bg,
                          nodeTypeInfo.colors.text,
                          "border border-current"
                        )}
                      >
                        {nodeTypeInfo.type}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </tbody>
    </Table>
  );
}
