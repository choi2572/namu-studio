"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { ValidationError, WorkflowDraft } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

type EditorPageProps = {
  workflowId: string;
};

type NodeKind =
  | "skill.pick"
  | "skill.place"
  | "flow_control.condition"
  | "event.webhook";

type NodeCategory = "skill" | "flow_control" | "event";

type NodeParamField = {
  key: string;
  label: string;
  placeholder: string;
};

type NodeOutputPort = {
  key: string;
  label: string;
};

type NodeTypeConfig = {
  label: string;
  category: NodeCategory;
  iconText: string;
  colorClass: string;
  paramFields: NodeParamField[];
  outputs: NodeOutputPort[];
};

type EditorNode = {
  id: string;
  name: string;
  kind: NodeKind;
  position: { x: number; y: number };
  isExpanded: boolean;
  params: Record<string, string>;
};

type EditorEdge = {
  id: string;
  from: string;
  fromPort: string;
  to: string;
};

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  height: number;
};

type ConnectingState = {
  nodeId: string;
  portKey: string;
} | null;

type EdgeDragPayload = {
  nodeId: string;
  portKey: string;
};

const NODE_TYPES: NodeKind[] = [
  "skill.pick",
  "skill.place",
  "flow_control.condition",
  "event.webhook"
];

const NODE_CATEGORIES: { id: NodeCategory; label: string }[] = [
  { id: "skill", label: "Skill" },
  { id: "flow_control", label: "Flow Control" },
  { id: "event", label: "Event" }
];

const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  skill: "Skill",
  flow_control: "Flow Control",
  event: "Event"
};

const NODE_TYPE_CONFIG: Record<NodeKind, NodeTypeConfig> = {
  "skill.pick": {
    label: "Pick",
    category: "skill",
    iconText: "PK",
    colorClass: "border-blue-200 bg-blue-100 text-blue-700",
    paramFields: [
      { key: "target", label: "Target", placeholder: "bin-A" },
      { key: "quantity", label: "Quantity", placeholder: "1" }
    ],
    outputs: [{ key: "next", label: "Next" }]
  },
  "skill.place": {
    label: "Place",
    category: "skill",
    iconText: "PL",
    colorClass: "border-emerald-200 bg-emerald-100 text-emerald-700",
    paramFields: [
      { key: "destination", label: "Destination", placeholder: "slot-3" },
      { key: "orientation", label: "Orientation", placeholder: "north" }
    ],
    outputs: [{ key: "next", label: "Next" }]
  },
  "flow_control.condition": {
    label: "Condition",
    category: "flow_control",
    iconText: "IF",
    colorClass: "border-amber-200 bg-amber-100 text-amber-700",
    paramFields: [
      { key: "expression", label: "Expression", placeholder: "payload.ok === true" },
      { key: "trueNext", label: "True ->", placeholder: "next-node-id" },
      { key: "falseNext", label: "False ->", placeholder: "fallback-node-id" }
    ],
    outputs: [
      { key: "true", label: "True" },
      { key: "false", label: "False" }
    ]
  },
  "event.webhook": {
    label: "Webhook",
    category: "event",
    iconText: "WH",
    colorClass: "border-purple-200 bg-purple-100 text-purple-700",
    paramFields: [
      { key: "url", label: "URL", placeholder: "https://hooks.example" },
      { key: "method", label: "Method", placeholder: "POST" }
    ],
    outputs: [{ key: "next", label: "Next" }]
  }
};

const NODE_METRICS = {
  width: 220,
  collapsedHeight: 86,
  expandedHeight: 200
};

const CANVAS_DEFAULT = {
  width: 2000,
  height: 1200
};

const ZOOM_LIMITS = {
  min: 0.6,
  max: 1.6,
  step: 0.1
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNodeHeight(node: EditorNode) {
  return node.isExpanded ? NODE_METRICS.expandedHeight : NODE_METRICS.collapsedHeight;
}

function getNodeTypeLabel(kind: NodeKind) {
  const config = NODE_TYPE_CONFIG[kind];
  return `${NODE_CATEGORY_LABELS[config.category]} - ${config.label}`;
}

function getPortOffsets(nodeHeight: number, count: number) {
  if (count <= 1) {
    return [nodeHeight / 2];
  }
  const gap = nodeHeight / (count + 1);
  return Array.from({ length: count }, (_, index) => gap * (index + 1));
}

function NodeCard({
  node,
  config,
  isSelected,
  inputConnected,
  outputs,
  onSelect,
  onToggleExpand,
  onDragStart,
  onStartConnect,
  onCompleteConnect,
  onParamChange,
  onNameChange,
  onDeleteNode,
  onOutputDragStart,
  onOutputDragEnd,
  onInputDragOver,
  onInputDrop
}: {
  node: EditorNode;
  config: NodeTypeConfig;
  isSelected: boolean;
  inputConnected: boolean;
  outputs: Array<{
    key: string;
    label: string;
    isConnected: boolean;
    isActive: boolean;
  }>;
  onSelect: () => void;
  onToggleExpand: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartConnect: (portKey: string) => void;
  onCompleteConnect: () => void;
  onParamChange: (key: string, value: string) => void;
  onNameChange: (value: string) => void;
  onDeleteNode: () => void;
  onOutputDragStart: (event: DragEvent<HTMLButtonElement>, portKey: string) => void;
  onOutputDragEnd: () => void;
  onInputDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onInputDrop: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const nodeHeight = getNodeHeight(node);
  const outputOffsets = getPortOffsets(nodeHeight, outputs.length);

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-white p-3 shadow-sm",
        isSelected ? "border-slate-900 ring-2 ring-slate-300" : "border-slate-200"
      )}
      data-node-card
      style={{
        width: NODE_METRICS.width,
        height: nodeHeight
      }}
      onClick={onSelect}
    >
      <button
        type="button"
        className={cn(
          "absolute left-0 flex h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-white shadow-sm",
          inputConnected ? "border-slate-400" : "border-slate-200"
        )}
        style={{ top: nodeHeight / 2 }}
        title={inputConnected ? "Input connected" : "Input"}
        onDragOver={(event) => {
          event.stopPropagation();
          onInputDragOver(event);
        }}
        onDrop={(event) => {
          event.stopPropagation();
          onInputDrop(event);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onCompleteConnect();
        }}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            inputConnected ? "bg-slate-600" : "bg-slate-400"
          )}
        />
      </button>

      {outputs.map((output, index) => (
        <div
          key={output.key}
          className="absolute right-0 flex items-center gap-1"
          style={{ top: outputOffsets[index], transform: "translateY(-50%)" }}
        >
          <span
            className={cn(
              "text-[9px]",
              output.isActive ? "text-slate-900" : "text-slate-500"
            )}
          >
            {output.label}
          </span>
          <button
            type="button"
            draggable
            className={cn(
              "flex h-3.5 w-3.5 translate-x-1/2 items-center justify-center rounded-full border bg-white shadow-sm",
              output.isActive
                ? "border-slate-900"
                : output.isConnected
                  ? "border-slate-400"
                  : "border-slate-200"
            )}
            title={`Output ${output.label}`}
            onDragStart={(event) => {
              event.stopPropagation();
              onOutputDragStart(event, output.key);
            }}
            onDragEnd={(event) => {
              event.stopPropagation();
              onOutputDragEnd();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onStartConnect(output.key);
            }}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                output.isActive
                  ? "bg-slate-900"
                  : output.isConnected
                    ? "bg-slate-600"
                    : "bg-slate-400"
              )}
            />
          </button>
        </div>
      ))}

      <div
        className="flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("input") || target.closest("button")) return;
          event.stopPropagation();
          onDragStart(event);
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold",
              config.colorClass
            )}
          >
            {config.iconText}
          </div>
          <div>
            <input
              value={node.name}
              onChange={(event) => onNameChange(event.target.value)}
              className="w-28 rounded border border-transparent bg-transparent text-xs font-semibold text-slate-900 focus:border-slate-300 focus:bg-white focus:outline-none"
            />
            <p className="text-[10px] text-slate-500">{getNodeTypeLabel(node.kind)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <button
            type="button"
            className="text-[10px] text-red-500 hover:text-red-600"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteNode();
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="text-[10px] text-slate-500 hover:text-slate-900"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand();
            }}
          >
            {node.isExpanded ? "Fold" : "Unfold"}
          </button>
        </div>
      </div>

      {!node.isExpanded && (
        <p className="mt-2 text-[10px] text-slate-400">{node.kind}</p>
      )}

      {node.isExpanded && (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          {config.paramFields.map((field) => (
            <label key={field.key} className="block">
              <span className="text-[10px] text-slate-500">{field.label}</span>
              <input
                value={node.params[field.key] ?? ""}
                onChange={(event) => onParamChange(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function EditorPage({ workflowId }: EditorPageProps) {
  const [showPalette, setShowPalette] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<ConnectingState>(null);
  const [selectedCategory, setSelectedCategory] = useState<NodeCategory>("skill");
  const [zoom, setZoom] = useState(1);
  const [canvasBase, setCanvasBase] = useState(CANVAS_DEFAULT);
  const [draftOverride, setDraftOverride] = useState<WorkflowDraft | null>(null);
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<EditorEdge[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nextNodeIndex = useRef(1);
  const nextEdgeIndex = useRef(1);

  const { data: draft } = useQuery({
    queryKey: ["workflow-draft", workflowId],
    queryFn: () => workflowsApi.getDraft(workflowId)
  });

  const activeDraft = draftOverride ?? draft;

  const { data: validationErrors = [] } = useQuery({
    queryKey: ["workflow-validation", workflowId],
    queryFn: () => workflowsApi.validateDraft(workflowId),
    enabled: Boolean(draft)
  });

  const saveMutation = useMutation({
    mutationFn: (payload: WorkflowDraft) =>
      workflowsApi.saveDraft(workflowId, payload),
    onSuccess: (saved) => setDraftOverride(saved)
  });

  const publishMutation = useMutation({
    mutationFn: () => workflowsApi.publish(workflowId)
  });

  const hasErrors = validationErrors.length > 0;

  const nodeMap = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const nodeTypesByCategory = useMemo(() => {
    return NODE_TYPES.reduce(
      (acc, kind) => {
        acc[NODE_TYPE_CONFIG[kind].category].push(kind);
        return acc;
      },
      {
        skill: [],
        flow_control: [],
        event: []
      } as Record<NodeCategory, NodeKind[]>
    );
  }, []);

  const incomingEdges = useMemo(() => {
    const map = new Map<string, EditorEdge>();
    edges.forEach((edge) => {
      map.set(edge.to, edge);
    });
    return map;
  }, [edges]);

  const outgoingEdges = useMemo(() => {
    const map = new Map<string, EditorEdge>();
    edges.forEach((edge) => {
      map.set(`${edge.from}:${edge.fromPort}`, edge);
    });
    return map;
  }, [edges]);

  const getCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom
      };
    },
    [zoom]
  );

  const getViewportCenter = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return {
        x: canvasBase.width / 2 - NODE_METRICS.width / 2,
        y: canvasBase.height / 2 - NODE_METRICS.collapsedHeight / 2
      };
    }
    return {
      x: (container.scrollLeft + container.clientWidth / 2) / zoom - NODE_METRICS.width / 2,
      y:
        (container.scrollTop + container.clientHeight / 2) / zoom -
        NODE_METRICS.collapsedHeight / 2
    };
  }, [canvasBase, zoom]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;

      const nextX = point.x - dragState.offsetX;
      const nextY = point.y - dragState.offsetY;
      const maxX = Math.max(0, canvasBase.width - NODE_METRICS.width);
      const maxY = Math.max(0, canvasBase.height - dragState.height);

      setNodes((prev) =>
        prev.map((item) =>
          item.id === dragState.nodeId
            ? {
                ...item,
                position: {
                  x: clamp(nextX, 0, maxX),
                  y: clamp(nextY, 0, maxY)
                }
              }
            : item
        )
      );
    };

    const handlePointerUp = () => setDragState(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [canvasBase.height, canvasBase.width, dragState, getCanvasPoint]);

  const buildDefaultParams = useCallback((kind: NodeKind) => {
    return NODE_TYPE_CONFIG[kind].paramFields.reduce(
      (acc, field) => ({
        ...acc,
        [field.key]: ""
      }),
      {} as Record<string, string>
    );
  }, []);

  const createNode = useCallback(
    (kind: NodeKind, position?: { x: number; y: number }) => {
      const basePosition = position ?? getViewportCenter();
      const nodeHeight = NODE_METRICS.collapsedHeight;
      const maxX = Math.max(0, canvasBase.width - NODE_METRICS.width);
      const maxY = Math.max(0, canvasBase.height - nodeHeight);
      const clampedPosition = {
        x: clamp(basePosition.x, 0, maxX),
        y: clamp(basePosition.y, 0, maxY)
      };

      const index = nextNodeIndex.current++;
      const id = `node-${index}`;
      const name = `${NODE_TYPE_CONFIG[kind].label} ${index}`;
      setNodes((prev) => [
        ...prev,
        {
          id,
          name,
          kind,
          position: clampedPosition,
          isExpanded: false,
          params: buildDefaultParams(kind)
        }
      ]);
      setSelectedNode(id);
      setSelectedEdgeId(null);
    },
    [buildDefaultParams, canvasBase.height, canvasBase.width, getViewportCenter]
  );

  const handleSave = () => {
    if (!activeDraft) return;
    saveMutation.mutate({
      ...activeDraft,
      updatedAt: activeDraft.updatedAt
    });
  };

  const handleCancel = () => {
    setDraftOverride(draft ?? null);
    setSelectedNode(null);
  };

  const handlePublish = () => {
    if (hasErrors) return;
    publishMutation.mutate();
  };

  const handleToggleExpand = (nodeId: string) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        const nextExpanded = !node.isExpanded;
        const nodeHeight = nextExpanded
          ? NODE_METRICS.expandedHeight
          : NODE_METRICS.collapsedHeight;
        const maxY = Math.max(0, canvasBase.height - nodeHeight);
        return {
          ...node,
          isExpanded: nextExpanded,
          position: { ...node.position, y: clamp(node.position.y, 0, maxY) }
        };
      })
    );
  };

  const handleParamChange = (nodeId: string, key: string, value: string) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? { ...node, params: { ...node.params, [key]: value } }
          : node
      )
    );
  };

  const handleNameChange = (nodeId: string, value: string) => {
    setNodes((prev) =>
      prev.map((node) => (node.id === nodeId ? { ...node, name: value } : node))
    );
  };

  const handleDeleteNode = (nodeId: string) => {
    const connectedEdgeIds = edges
      .filter((edge) => edge.from === nodeId || edge.to === nodeId)
      .map((edge) => edge.id);
    setNodes((prev) => prev.filter((node) => node.id !== nodeId));
    setEdges((prev) =>
      prev.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
    );
    setSelectedNode((prev) => (prev === nodeId ? null : prev));
    setSelectedEdgeId((prev) =>
      prev && connectedEdgeIds.includes(prev) ? null : prev
    );
    setConnectingFrom((prev) =>
      prev && prev.nodeId === nodeId ? null : prev
    );
  };

  const handleDeleteEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((prev) => (prev === edgeId ? null : prev));
  };

  const handleAutoLayout = () => {
    if (nodes.length === 0) return;

    const spacingX = 320;
    const spacingY = NODE_METRICS.expandedHeight + 60;
    const padding = 80;
    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();

    nodes.forEach((node) => {
      inDegree.set(node.id, 0);
      outgoing.set(node.id, []);
    });

    edges.forEach((edge) => {
      if (!inDegree.has(edge.to) || !outgoing.has(edge.from)) return;
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      outgoing.get(edge.from)?.push(edge.to);
    });

    const queue = Array.from(inDegree.entries())
      .filter(([, value]) => value === 0)
      .map(([id]) => id);
    const layers = new Map<string, number>();
    queue.forEach((id) => layers.set(id, 0));

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const nextLayer = (layers.get(current) ?? 0) + 1;
      outgoing.get(current)?.forEach((to) => {
        layers.set(to, Math.max(layers.get(to) ?? 0, nextLayer));
        inDegree.set(to, (inDegree.get(to) ?? 1) - 1);
        if (inDegree.get(to) === 0) {
          queue.push(to);
        }
      });
    }

    nodes.forEach((node) => {
      if (!layers.has(node.id)) layers.set(node.id, 0);
    });

    const grouped = new Map<number, EditorNode[]>();
    nodes.forEach((node) => {
      const layer = layers.get(node.id) ?? 0;
      const group = grouped.get(layer) ?? [];
      group.push(node);
      grouped.set(layer, group);
    });

    let requiredWidth = canvasBase.width;
    let requiredHeight = canvasBase.height;
    const nextPositions = new Map<string, { x: number; y: number }>();

    Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([layer, group]) => {
        const sortedGroup = [...group].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        sortedGroup.forEach((node, index) => {
          const nodeHeight = getNodeHeight(node);
          const x = padding + layer * spacingX;
          const y = padding + index * spacingY;
          nextPositions.set(node.id, { x, y });
          requiredWidth = Math.max(
            requiredWidth,
            x + NODE_METRICS.width + padding
          );
          requiredHeight = Math.max(requiredHeight, y + nodeHeight + padding);
        });
      });

    setCanvasBase((prev) => ({
      width: Math.max(prev.width, requiredWidth),
      height: Math.max(prev.height, requiredHeight)
    }));

    setNodes((prev) =>
      prev.map((node) =>
        nextPositions.has(node.id)
          ? { ...node, position: nextPositions.get(node.id)! }
          : node
      )
    );
  };

  const connectNodes = useCallback(
    (fromNodeId: string, fromPort: string, toNodeId: string) => {
      if (fromNodeId === toNodeId) return;
      if (incomingEdges.has(toNodeId)) return;
      if (outgoingEdges.has(`${fromNodeId}:${fromPort}`)) return;

      setEdges((prev) => [
        ...prev,
        {
          id: `edge-${nextEdgeIndex.current++}`,
          from: fromNodeId,
          fromPort,
          to: toNodeId
        }
      ]);
      setSelectedEdgeId(null);
    },
    [incomingEdges, outgoingEdges]
  );

  const handleStartConnect = (nodeId: string, portKey: string) => {
    if (outgoingEdges.has(`${nodeId}:${portKey}`)) {
      setConnectingFrom(null);
      return;
    }
    setConnectingFrom((prev) => {
      if (prev && prev.nodeId === nodeId && prev.portKey === portKey) {
        return null;
      }
      return { nodeId, portKey };
    });
    setSelectedEdgeId(null);
  };

  const handleCompleteConnect = (nodeId: string) => {
    if (!connectingFrom || connectingFrom.nodeId === nodeId) {
      setConnectingFrom(null);
      return;
    }
    if (incomingEdges.has(nodeId)) {
      setConnectingFrom(null);
      return;
    }
    connectNodes(connectingFrom.nodeId, connectingFrom.portKey, nodeId);
    setConnectingFrom(null);
  };

  const handleOutputDragStart = (
    event: DragEvent<HTMLButtonElement>,
    nodeId: string,
    portKey: string
  ) => {
    event.dataTransfer.setData(
      "application/x-edge-from",
      JSON.stringify({ nodeId, portKey } as EdgeDragPayload)
    );
    event.dataTransfer.effectAllowed = "link";
    setConnectingFrom({ nodeId, portKey });
    setSelectedEdgeId(null);
  };

  const handleOutputDragEnd = () => {
    setConnectingFrom(null);
  };

  const handleInputDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "link";
  };

  const handleInputDrop = (event: DragEvent<HTMLButtonElement>, nodeId: string) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-edge-from");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as EdgeDragPayload;
      if (!payload.nodeId || !payload.portKey) return;
      connectNodes(payload.nodeId, payload.portKey, nodeId);
    } catch {
      return;
    }
    setConnectingFrom(null);
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rawKind = event.dataTransfer.getData("application/x-node-kind");
    if (!rawKind) return;
    if (!NODE_TYPES.includes(rawKind as NodeKind)) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) return;

    const dropX = point.x - NODE_METRICS.width / 2;
    const dropY = point.y - NODE_METRICS.collapsedHeight / 2;
    createNode(rawKind as NodeKind, { x: dropX, y: dropY });
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-card]")) return;
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setConnectingFrom(null);
  };

  const edgesToRender = useMemo(() => {
    return edges.filter((edge) => {
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      if (!fromNode || !toNode) return false;
      const outputs = NODE_TYPE_CONFIG[fromNode.kind].outputs;
      return outputs.some((output) => output.key === edge.fromPort);
    });
  }, [edges, nodeMap]);

  const connectingLabel = useMemo(() => {
    if (!connectingFrom) return null;
    const node = nodeMap.get(connectingFrom.nodeId);
    if (!node) return null;
    const output = NODE_TYPE_CONFIG[node.kind].outputs.find(
      (item) => item.key === connectingFrom.portKey
    );
    return `${node.name} - ${output?.label ?? connectingFrom.portKey}`;
  }, [connectingFrom, nodeMap]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500">Workflow Editor</p>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">
              {activeDraft?.workflowId ?? "Loading..."}
            </h1>
            <StatusBadge status="DRAFT" />
          </div>
          {activeDraft && (
            <p className="text-xs text-slate-500">
              Draft mode · Publish creates an immutable version · Last updated{" "}
              {formatDateTime(activeDraft.updatedAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleAutoLayout}>
            Auto Layout
          </Button>
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleSave}>
            Save
          </Button>
          <Button onClick={handlePublish} disabled={hasErrors}>
            Publish
          </Button>
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPalette((prev) => !prev)}
          className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg"
        >
          +
        </button>
        {showPalette && (
          <div className="absolute left-16 top-4 z-10 flex rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="w-32 border-r border-slate-200 p-3">
              <p className="text-[10px] font-semibold text-slate-500">Category</p>
              <div className="mt-2 space-y-1">
                {NODE_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                    className={cn(
                      "w-full rounded-md px-2 py-1 text-left text-xs",
                      selectedCategory === category.id
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-72 p-3">
              <p className="text-xs font-semibold text-slate-700">
                {NODE_CATEGORY_LABELS[selectedCategory]}
              </p>
              <div className="mt-3 space-y-2">
                {nodeTypesByCategory[selectedCategory].map((kind) => {
                  const config = NODE_TYPE_CONFIG[kind];
                  return (
                    <button
                      key={kind}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-node-kind", kind);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => createNode(kind)}
                      className="flex w-full items-center gap-3 rounded-md border border-slate-200 px-2 py-2 text-left text-xs text-slate-700 hover:border-slate-300"
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold",
                          config.colorClass
                        )}
                      >
                        {config.iconText}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold">{config.label}</p>
                        <p className="text-[10px] text-slate-500">{kind}</p>
                      </div>
                      <span className="text-[10px] text-slate-400">Drag</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[10px] text-slate-400">
                Drag onto the canvas or click to add at center.
              </p>
            </div>
          </div>
        )}

        <Card className="border-dashed">
          <div className="relative h-[560px] w-full overflow-hidden rounded-md bg-slate-50">
            <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] text-slate-600 shadow">
              <button
                type="button"
                className="rounded px-1 text-slate-600 hover:text-slate-900"
                onClick={() =>
                  setZoom((prev) =>
                    clamp(prev - ZOOM_LIMITS.step, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
                  )
                }
              >
                -
              </button>
              <span className="min-w-[36px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="rounded px-1 text-slate-600 hover:text-slate-900"
                onClick={() =>
                  setZoom((prev) =>
                    clamp(prev + ZOOM_LIMITS.step, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
                  )
                }
              >
                +
              </button>
              <button
                type="button"
                className="rounded px-1 text-slate-500 hover:text-slate-900"
                onClick={() => setZoom(1)}
              >
                Reset
              </button>
            </div>

            {selectedEdgeId && (
              <div className="absolute bottom-4 right-4 z-10 rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-700 shadow">
                <button
                  type="button"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => handleDeleteEdge(selectedEdgeId)}
                >
                  Delete edge
                </button>
              </div>
            )}

            <div ref={scrollRef} className="h-full w-full overflow-auto">
              <div
                className="relative"
                style={{
                  width: canvasBase.width * zoom,
                  height: canvasBase.height * zoom
                }}
              >
                <div
                  ref={canvasRef}
                  className="absolute inset-0"
                  style={{
                    width: canvasBase.width,
                    height: canvasBase.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left"
                  }}
                  onDragOver={handleCanvasDragOver}
                  onDrop={handleCanvasDrop}
                  onClick={handleCanvasClick}
                >
                  <svg
                    className="absolute inset-0"
                    width={canvasBase.width}
                    height={canvasBase.height}
                    viewBox={`0 0 ${canvasBase.width} ${canvasBase.height}`}
                    preserveAspectRatio="xMinYMin meet"
                  >
                    <defs>
                      <marker
                        id="arrow"
                        markerWidth="10"
                        markerHeight="10"
                        refX="8"
                        refY="5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
                      </marker>
                    </defs>
                    {edgesToRender.map((edge) => {
                      const fromNode = nodeMap.get(edge.from);
                      const toNode = nodeMap.get(edge.to);
                      if (!fromNode || !toNode) return null;
                      const outputs = NODE_TYPE_CONFIG[fromNode.kind].outputs;
                      const outputIndex = outputs.findIndex(
                        (output) => output.key === edge.fromPort
                      );
                      if (outputIndex < 0) return null;
                      const outputOffsets = getPortOffsets(
                        getNodeHeight(fromNode),
                        outputs.length
                      );
                      const start = {
                        x: fromNode.position.x + NODE_METRICS.width,
                        y: fromNode.position.y + outputOffsets[outputIndex]
                      };
                      const end = {
                        x: toNode.position.x,
                        y: toNode.position.y + getNodeHeight(toNode) / 2
                      };
                      const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
                      const controlX1 =
                        start.x + (end.x >= start.x ? curve : -curve);
                      const controlX2 =
                        end.x + (end.x >= start.x ? -curve : curve);
                      const path = `M ${start.x} ${start.y} C ${controlX1} ${start.y}, ${controlX2} ${end.y}, ${end.x} ${end.y}`;
                      return (
                        <path
                          key={edge.id}
                          d={path}
                          stroke={
                            selectedEdgeId === edge.id ? "#0f172a" : "#94a3b8"
                          }
                          strokeWidth={selectedEdgeId === edge.id ? "2.5" : "2"}
                          fill="none"
                          markerEnd="url(#arrow)"
                          className="cursor-pointer"
                          style={{ pointerEvents: "stroke" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedEdgeId(edge.id);
                            setSelectedNode(null);
                          }}
                        />
                      );
                    })}
                  </svg>

                  {nodes.map((node) => {
                    const config = NODE_TYPE_CONFIG[node.kind];
                    const outputStates = config.outputs.map((output) => ({
                      key: output.key,
                      label: output.label,
                      isConnected: outgoingEdges.has(`${node.id}:${output.key}`),
                      isActive:
                        connectingFrom?.nodeId === node.id &&
                        connectingFrom.portKey === output.key
                    }));
                    return (
                      <div
                        key={node.id}
                        className="absolute"
                        style={{ left: node.position.x, top: node.position.y }}
                      >
                        <NodeCard
                          node={node}
                          config={config}
                          isSelected={selectedNode === node.id}
                          inputConnected={incomingEdges.has(node.id)}
                          outputs={outputStates}
                          onSelect={() => {
                            setSelectedNode(node.id);
                            setSelectedEdgeId(null);
                          }}
                          onToggleExpand={() => handleToggleExpand(node.id)}
                          onDragStart={(event) => {
                            const point = getCanvasPoint(
                              event.clientX,
                              event.clientY
                            );
                            if (!point) return;
                            const offsetX = point.x - node.position.x;
                            const offsetY = point.y - node.position.y;
                            setSelectedNode(node.id);
                            setSelectedEdgeId(null);
                            setConnectingFrom(null);
                            setDragState({
                              nodeId: node.id,
                              offsetX,
                              offsetY,
                              height: getNodeHeight(node)
                            });
                          }}
                          onStartConnect={(portKey) =>
                            handleStartConnect(node.id, portKey)
                          }
                          onCompleteConnect={() => handleCompleteConnect(node.id)}
                          onParamChange={(key, value) =>
                            handleParamChange(node.id, key, value)
                          }
                          onNameChange={(value) => handleNameChange(node.id, value)}
                          onDeleteNode={() => handleDeleteNode(node.id)}
                          onOutputDragStart={(event, portKey) =>
                            handleOutputDragStart(event, node.id, portKey)
                          }
                          onOutputDragEnd={handleOutputDragEnd}
                          onInputDragOver={handleInputDragOver}
                          onInputDrop={(event) => handleInputDrop(event, node.id)}
                        />
                      </div>
                    );
                  })}

                  {nodes.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-sm text-slate-400">
                      <p>Drag a node here or click in the palette.</p>
                      <p className="text-xs">
                        Use output ports to connect nodes with arrows.
                      </p>
                    </div>
                  )}

                  {connectingFrom && (
                    <div className="absolute bottom-4 left-4 rounded-full bg-slate-900 px-3 py-1 text-[10px] text-white shadow">
                      Connecting: {connectingLabel ?? "Output"} -&gt; select target input.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {hasErrors && (
        <div className="fixed bottom-6 right-6 z-20">
          <button
            type="button"
            className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
            onClick={() => setShowValidation((prev) => !prev)}
          >
            {validationErrors.length} Validation Errors
          </button>
          {showValidation && (
            <div className="mt-3 w-72 rounded-lg border border-red-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
              <p className="font-semibold text-red-600">Errors</p>
              <ul className="mt-2 space-y-2">
                {validationErrors.map((error: ValidationError) => (
                  <li key={error.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedNode(error.nodeId ?? null)}
                      className="text-left text-slate-700 hover:text-slate-900"
                    >
                      {error.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
