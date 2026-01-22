"use client";

import { useMemo, useState } from "react";
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

const NODE_TYPE_LABELS: Record<string, string> = {
  Skill: "Skill",
  Condition: "Flow Control",
  Parallel: "Flow Control",
  Event: "Event",
  Wait: "Event"
};

function getNodeTypeLabel(rawType: string | undefined) {
  if (!rawType) return "Skill";
  return NODE_TYPE_LABELS[rawType] ?? rawType;
}

function NodeCard({
  nodeId,
  nodeType,
  isExpanded,
  isSelected,
  onToggle
}: {
  nodeId: string;
  nodeType: string;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-4 shadow-sm",
        isSelected ? "border-slate-900 ring-2 ring-slate-300" : "border-slate-200"
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{nodeId}</p>
          <p className="text-xs text-slate-500">{nodeType}</p>
        </div>
        <button
          type="button"
          className="text-xs text-slate-500 hover:text-slate-900"
          onClick={onToggle}
        >
          {isExpanded ? "Fold" : "Unfold"}
        </button>
      </div>
      {isExpanded && (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <div className="rounded-md bg-slate-50 p-2">
            <p className="font-semibold">Parameters</p>
            <p className="text-slate-500">Editable in Editor mode.</p>
          </div>
          <div className="rounded-md border border-dashed border-slate-200 p-2">
            Placeholder fields for node configuration.
          </div>
        </div>
      )}
    </div>
  );
}

export function EditorPage({ workflowId }: EditorPageProps) {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [showPalette, setShowPalette] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draftOverride, setDraftOverride] = useState<WorkflowDraft | null>(null);

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

  const nodeList = useMemo(() => {
    if (!activeDraft || typeof activeDraft.dsl_json !== "object") {
      return [];
    }
    const dsl = activeDraft.dsl_json as {
      StartAt?: string;
      States?: Record<string, { Type?: string }>;
    };
    const startNode = dsl.StartAt;
    const states = dsl.States ?? {};
    return Object.entries(states).map(([nodeId, def]) => ({
      nodeId,
      nodeType: getNodeTypeLabel(def.Type),
      isStart: nodeId === startNode
    }));
  }, [activeDraft]);

  const hasErrors = validationErrors.length > 0;

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
          <div className="absolute left-16 top-4 z-10 w-40 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            <p className="text-xs font-semibold text-slate-700">Node Palette</p>
            <div className="mt-2 space-y-2 text-xs text-slate-600">
              <button className="w-full rounded-md border border-slate-200 px-2 py-1 text-left">
                Skill
              </button>
              <button className="w-full rounded-md border border-slate-200 px-2 py-1 text-left">
                Flow Control
              </button>
              <button className="w-full rounded-md border border-slate-200 px-2 py-1 text-left">
                Event
              </button>
            </div>
          </div>
        )}

        <Card className="min-h-[420px] border-dashed">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {nodeList.map((node) => (
              <div key={node.nodeId} className="space-y-2">
                <div className="flex items-center gap-2">
                  {node.isStart && (
                    <StatusBadge
                      status="START"
                      className="bg-slate-900 text-white"
                    />
                  )}
                </div>
                <div
                  onClick={() => setSelectedNode(node.nodeId)}
                  className="cursor-pointer"
                >
                  <NodeCard
                    nodeId={node.nodeId}
                    nodeType={node.nodeType}
                    isExpanded={Boolean(expandedNodes[node.nodeId])}
                    isSelected={selectedNode === node.nodeId}
                    onToggle={() =>
                      setExpandedNodes((prev) => ({
                        ...prev,
                        [node.nodeId]: !prev[node.nodeId]
                      }))
                    }
                  />
                </div>
              </div>
            ))}
            {nodeList.length === 0 && (
              <div className="text-sm text-slate-500">
                Canvas placeholder. Nodes will appear here once defined.
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
