import type { MutableRefObject } from "react";

import type { WorkflowDraft } from "@/domain/types";

import type {
  EditorEdge,
  EditorNode,
  FailureHandlingGraph
} from "./editorTypes";

/** Import 실패 시 `confirmImportOverwrite`의 try 블록 이전에 캡처하던 스냅샷과 동일한 형태. */
type EditorImportRollbackSnapshot = {
  nodes: EditorNode[];
  edges: EditorEdge[];
  failureGraph: FailureHandlingGraph;
  canvasBase: { width: number; height: number };
  zoom: number;
  workflowName: string;
  originalWorkflowName: string;
  draftOverride: WorkflowDraft | null;
  preservedOnFailureDsl: Record<string, unknown> | null;
  nextNodeIndex: number;
  nextEdgeIndex: number;
  nextConditionIndex: number;
  nextVariableRowIndex: number;
  nextFailureNodeIndex: number;
  hasUnsavedChanges: boolean;
  selectedNode: string | null;
  selectedEdgeId: string | null;
};

export function buildEditorImportRollbackSnapshot(p: {
  nodes: EditorNode[];
  edges: EditorEdge[];
  failureGraph: FailureHandlingGraph;
  canvasBase: { width: number; height: number };
  zoom: number;
  workflowName: string;
  originalWorkflowName: string;
  draftOverride: WorkflowDraft | null;
  preservedOnFailureDsl: Record<string, unknown> | null;
  nextNodeIndex: number;
  nextEdgeIndex: number;
  nextConditionIndex: number;
  nextVariableRowIndex: number;
  nextFailureNodeIndex: number;
  hasUnsavedChanges: boolean;
  selectedNode: string | null;
  selectedEdgeId: string | null;
}): EditorImportRollbackSnapshot {
  return {
    nodes: structuredClone(p.nodes),
    edges: structuredClone(p.edges),
    failureGraph: structuredClone(p.failureGraph),
    canvasBase: { ...p.canvasBase },
    zoom: p.zoom,
    workflowName: p.workflowName,
    originalWorkflowName: p.originalWorkflowName,
    draftOverride: p.draftOverride ? structuredClone(p.draftOverride) : null,
    preservedOnFailureDsl: p.preservedOnFailureDsl
      ? structuredClone(p.preservedOnFailureDsl)
      : null,
    nextNodeIndex: p.nextNodeIndex,
    nextEdgeIndex: p.nextEdgeIndex,
    nextConditionIndex: p.nextConditionIndex,
    nextVariableRowIndex: p.nextVariableRowIndex,
    nextFailureNodeIndex: p.nextFailureNodeIndex,
    hasUnsavedChanges: p.hasUnsavedChanges,
    selectedNode: p.selectedNode,
    selectedEdgeId: p.selectedEdgeId
  };
}

type ImportRollbackRefs = {
  setNodes: (value: EditorNode[]) => void;
  setEdges: (value: EditorEdge[]) => void;
  setFailureGraph: (value: FailureHandlingGraph) => void;
  setCanvasBase: (value: { width: number; height: number }) => void;
  setZoom: (value: number) => void;
  setWorkflowName: (value: string) => void;
  setOriginalWorkflowName: (value: string) => void;
  setDraftOverride: (value: WorkflowDraft | null) => void;
  preservedOnFailureDslRef: MutableRefObject<Record<string, unknown> | null>;
  nextNodeIndex: MutableRefObject<number>;
  nextEdgeIndex: MutableRefObject<number>;
  nextConditionIndex: MutableRefObject<number>;
  nextVariableRowIndex: MutableRefObject<number>;
  nextFailureNodeIndex: MutableRefObject<number>;
  setHasUnsavedChanges: (value: boolean) => void;
  setSelectedNode: (value: string | null) => void;
  setSelectedEdgeId: (value: string | null) => void;
};

/** catch 블록에서의 setter/ref 복원 순서를 그대로 유지한다. */
export function restoreEditorFromImportRollbackSnapshot(
  snapshot: EditorImportRollbackSnapshot,
  a: ImportRollbackRefs
) {
  a.setNodes(snapshot.nodes);
  a.setEdges(snapshot.edges);
  a.setFailureGraph(snapshot.failureGraph);
  a.setCanvasBase(snapshot.canvasBase);
  a.setZoom(snapshot.zoom);
  a.setWorkflowName(snapshot.workflowName);
  a.setOriginalWorkflowName(snapshot.originalWorkflowName);
  a.setDraftOverride(snapshot.draftOverride);
  a.preservedOnFailureDslRef.current = snapshot.preservedOnFailureDsl;
  a.nextNodeIndex.current = snapshot.nextNodeIndex;
  a.nextEdgeIndex.current = snapshot.nextEdgeIndex;
  a.nextConditionIndex.current = snapshot.nextConditionIndex;
  a.nextVariableRowIndex.current = snapshot.nextVariableRowIndex;
  a.nextFailureNodeIndex.current = snapshot.nextFailureNodeIndex;
  a.setHasUnsavedChanges(snapshot.hasUnsavedChanges);
  a.setSelectedNode(snapshot.selectedNode);
  a.setSelectedEdgeId(snapshot.selectedEdgeId);
}

export function mergePreservedOnFailureIntoDraftDsl(
  dsl_json: Record<string, unknown>,
  dslHasOnFailure: boolean,
  hasFailureStartEdge: boolean,
  preservedOnFailureDsl: Record<string, unknown> | null
): { dsl_json: Record<string, unknown>; dslHasOnFailure: boolean } {
  if (!dslHasOnFailure && !hasFailureStartEdge && preservedOnFailureDsl) {
    return {
      dsl_json: { ...dsl_json, OnFailure: preservedOnFailureDsl },
      dslHasOnFailure: true
    };
  }
  return { dsl_json, dslHasOnFailure };
}

export function collectChildNodeIdsForContainer(
  nodes: EditorNode[],
  containerId: string
): Set<string> {
  return new Set(
    nodes.filter((node) => node.containerId === containerId).map((node) => node.id)
  );
}

export function clampEditorNodePositionToCanvas(
  canvasBase: { width: number; height: number },
  basePosition: { x: number; y: number },
  nodeHeight: number,
  getCanvasBounds: (
    canvasBaseArg: { width: number; height: number },
    height: number
  ) => { minX: number; minY: number; maxX: number; maxY: number },
  clamp: (value: number, min: number, max: number) => number
): { x: number; y: number } {
  const { minX, minY, maxX, maxY } = getCanvasBounds(canvasBase, nodeHeight);
  return {
    x: clamp(basePosition.x, minX, maxX),
    y: clamp(basePosition.y, minY, maxY)
  };
}
