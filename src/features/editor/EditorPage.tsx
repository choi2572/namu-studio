"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";
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

type NodeParamField = {
  key: string;
  label: string;
  placeholder: string;
};

type NodeTypeConfig = {
  label: string;
  iconText: string;
  colorClass: string;
  paramFields: NodeParamField[];
};

type EditorNode = {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  isExpanded: boolean;
  params: Record<string, string>;
};

type EditorEdge = {
  id: string;
  from: string;
  to: string;
};

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  height: number;
};

const NODE_TYPES: NodeKind[] = [
  "skill.pick",
  "skill.place",
  "flow_control.condition",
  "event.webhook"
];

const NODE_TYPE_CONFIG: Record<NodeKind, NodeTypeConfig> = {
  "skill.pick": {
    label: "Skill - Pick",
    iconText: "PK",
    colorClass: "border-blue-200 bg-blue-100 text-blue-700",
    paramFields: [
      { key: "target", label: "Target", placeholder: "bin-A" },
      { key: "quantity", label: "Quantity", placeholder: "1" }
    ]
  },
  "skill.place": {
    label: "Skill - Place",
    iconText: "PL",
    colorClass: "border-emerald-200 bg-emerald-100 text-emerald-700",
    paramFields: [
      { key: "destination", label: "Destination", placeholder: "slot-3" },
      { key: "orientation", label: "Orientation", placeholder: "north" }
    ]
  },
  "flow_control.condition": {
    label: "Flow Control - Condition",
    iconText: "IF",
    colorClass: "border-amber-200 bg-amber-100 text-amber-700",
    paramFields: [
      { key: "expression", label: "Expression", placeholder: "payload.ok === true" },
      { key: "trueNext", label: "True ->", placeholder: "next-node-id" },
      { key: "falseNext", label: "False ->", placeholder: "fallback-node-id" }
    ]
  },
  "event.webhook": {
    label: "Event - Webhook",
    iconText: "WH",
    colorClass: "border-purple-200 bg-purple-100 text-purple-700",
    paramFields: [
      { key: "url", label: "URL", placeholder: "https://hooks.example" },
      { key: "method", label: "Method", placeholder: "POST" }
    ]
  }
};

const NODE_METRICS = {
  width: 220,
  collapsedHeight: 86,
  expandedHeight: 200
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getNodeHeight(node: EditorNode) {
  return node.isExpanded ? NODE_METRICS.expandedHeight : NODE_METRICS.collapsedHeight;
}

function NodeCard({
  node,
  config,
  isSelected,
  isConnectingSource,
  onSelect,
  onToggleExpand,
  onDragStart,
  onStartConnect,
  onCompleteConnect,
  onParamChange
}: {
  node: EditorNode;
  config: NodeTypeConfig;
  isSelected: boolean;
  isConnectingSource: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onDragStart: (event: PointerEvent<HTMLDivElement>) => void;
  onStartConnect: () => void;
  onCompleteConnect: () => void;
  onParamChange: (key: string, value: string) => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg border bg-white p-3 shadow-sm",
        isSelected ? "border-slate-900 ring-2 ring-slate-300" : "border-slate-200"
      )}
      style={{
        width: NODE_METRICS.width,
        height: node.isExpanded ? NODE_METRICS.expandedHeight : NODE_METRICS.collapsedHeight
      }}
      onClick={onSelect}
    >
      <button
        type="button"
        className={cn(
          "absolute left-0 top-1/2 flex h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-white shadow-sm",
          isConnectingSource ? "border-slate-400" : "border-slate-200"
        )}
        title="Input"
        onClick={(event) => {
          event.stopPropagation();
          onCompleteConnect();
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      </button>
      <button
        type="button"
        className={cn(
          "absolute right-0 top-1/2 flex h-3.5 w-3.5 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-white shadow-sm",
          isConnectingSource ? "border-slate-900" : "border-slate-200"
        )}
        title="Output"
        onClick={(event) => {
          event.stopPropagation();
          onStartConnect();
        }}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isConnectingSource ? "bg-slate-900" : "bg-slate-400"
          )}
        />
      </button>

      <div
        className="flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
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
            <p className="text-xs font-semibold">{node.id}</p>
            <p className="text-[10px] text-slate-500">{config.label}</p>
          </div>
        </div>
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
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [draftOverride, setDraftOverride] = useState<WorkflowDraft | null>(null);
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<EditorEdge[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLDivElement | null>(null);
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

  const updateCanvasSize = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCanvasSize({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => {
    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);
    return () => window.removeEventListener("resize", updateCanvasSize);
  }, [updateCanvasSize]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const nextX = event.clientX - rect.left - dragState.offsetX;
      const nextY = event.clientY - rect.top - dragState.offsetY;
      const maxX = Math.max(0, rect.width - NODE_METRICS.width);
      const maxY = Math.max(0, rect.height - dragState.height);

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
  }, [dragState]);

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
      const rect = canvasRef.current?.getBoundingClientRect();
      const basePosition = position ?? {
        x: rect ? rect.width / 2 - NODE_METRICS.width / 2 : 0,
        y: rect ? rect.height / 2 - NODE_METRICS.collapsedHeight / 2 : 0
      };
      const nodeHeight = NODE_METRICS.collapsedHeight;
      const maxX = rect ? Math.max(0, rect.width - NODE_METRICS.width) : 0;
      const maxY = rect ? Math.max(0, rect.height - nodeHeight) : 0;
      const clampedPosition = {
        x: clamp(basePosition.x, 0, maxX),
        y: clamp(basePosition.y, 0, maxY)
      };

      const id = `node-${nextNodeIndex.current++}`;
      setNodes((prev) => [
        ...prev,
        {
          id,
          kind,
          position: clampedPosition,
          isExpanded: false,
          params: buildDefaultParams(kind)
        }
      ]);
      setSelectedNode(id);
    },
    [buildDefaultParams]
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
    const rect = canvasRef.current?.getBoundingClientRect();
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        const nextExpanded = !node.isExpanded;
        const nodeHeight = nextExpanded
          ? NODE_METRICS.expandedHeight
          : NODE_METRICS.collapsedHeight;
        if (!rect) {
          return { ...node, isExpanded: nextExpanded };
        }
        const maxY = Math.max(0, rect.height - nodeHeight);
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

  const handleStartConnect = (nodeId: string) => {
    setConnectingFrom((prev) => (prev === nodeId ? null : nodeId));
  };

  const handleCompleteConnect = (nodeId: string) => {
    if (!connectingFrom || connectingFrom === nodeId) {
      setConnectingFrom(null);
      return;
    }
    setEdges((prev) => {
      const exists = prev.some(
        (edge) => edge.from === connectingFrom && edge.to === nodeId
      );
      if (exists) return prev;
      return [
        ...prev,
        { id: `edge-${nextEdgeIndex.current++}`, from: connectingFrom, to: nodeId }
      ];
    });
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
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dropX = event.clientX - rect.left - NODE_METRICS.width / 2;
    const dropY = event.clientY - rect.top - NODE_METRICS.collapsedHeight / 2;
    createNode(rawKind as NodeKind, { x: dropX, y: dropY });
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setSelectedNode(null);
    setConnectingFrom(null);
  };

  const edgesToRender = useMemo(() => {
    return edges.filter(
      (edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to)
    );
  }, [edges, nodeMap]);

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
          <div className="absolute left-16 top-4 z-10 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            <p className="text-xs font-semibold text-slate-700">Node Palette</p>
            <div className="mt-3 space-y-2">
              {NODE_TYPES.map((kind) => {
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
        )}

        <Card className="border-dashed">
          <div
            ref={canvasRef}
            className="relative h-[560px] w-full overflow-hidden rounded-md bg-slate-50"
            onDragOver={handleCanvasDragOver}
            onDrop={handleCanvasDrop}
            onClick={handleCanvasClick}
          >
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
              preserveAspectRatio="none"
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
                const start = {
                  x: fromNode.position.x + NODE_METRICS.width,
                  y: fromNode.position.y + getNodeHeight(fromNode) / 2
                };
                const end = {
                  x: toNode.position.x,
                  y: toNode.position.y + getNodeHeight(toNode) / 2
                };
                const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
                const controlX1 = start.x + (end.x >= start.x ? curve : -curve);
                const controlX2 = end.x + (end.x >= start.x ? -curve : curve);
                const path = `M ${start.x} ${start.y} C ${controlX1} ${start.y}, ${controlX2} ${end.y}, ${end.x} ${end.y}`;
                return (
                  <path
                    key={edge.id}
                    d={path}
                    stroke="#94a3b8"
                    strokeWidth="2"
                    fill="none"
                    markerEnd="url(#arrow)"
                  />
                );
              })}
            </svg>

            {nodes.map((node) => {
              const config = NODE_TYPE_CONFIG[node.kind];
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
                    isConnectingSource={connectingFrom === node.id}
                    onSelect={() => setSelectedNode(node.id)}
                    onToggleExpand={() => handleToggleExpand(node.id)}
                    onDragStart={(event) => {
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const offsetX = event.clientX - rect.left - node.position.x;
                      const offsetY = event.clientY - rect.top - node.position.y;
                      setSelectedNode(node.id);
                      setDragState({
                        nodeId: node.id,
                        offsetX,
                        offsetY,
                        height: getNodeHeight(node)
                      });
                    }}
                    onStartConnect={() => handleStartConnect(node.id)}
                    onCompleteConnect={() => handleCompleteConnect(node.id)}
                    onParamChange={(key, value) =>
                      handleParamChange(node.id, key, value)
                    }
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
                Select a target input to connect.
              </div>
            )}
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
