"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeEvent, DragEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { skillsetsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  ContainerFrame,
  type ContainerFrameRegion,
  type ResizeHandle
} from "@/components/ContainerFrame";
import { StatusBadge } from "@/components/StatusBadge";
import { ValidationError, type Skillset, WorkflowDraft } from "@/domain/types";
import { cn } from "@/lib/cn";
import { computeStartEndForScope, type ScopeGraph } from "@/lib/startEndDetection";
import { ENABLE_VLM_NODES } from "@/lib/featureFlags";
import { downloadJsonFile, sanitizeDownloadFileBaseName } from "@/lib/downloadJsonFile";
import {
  cloneDslOnFailureBlock,
  dslJsonHasOnFailureKey,
  mergeDslOnFailureIfServerDropped
} from "@/lib/dslOnFailure";

import {
  CANVAS_DEFAULT,
  CANVAS_PADDING,
  CONTAINER_FRAME_DEFAULTS,
  CONTAINER_FRAME_METRICS,
  CONTAINER_LAYOUT,
  DEFAULT_PARALLEL_BRANCHES,
  FAILURE_CANVAS_BASE,
  NODE_METRICS,
  RETRY_THEME_COLORS,
  RIBBON_EXTRA_HEIGHT,
  STATIC_NODE_TYPE_CONFIG,
  ZOOM_LIMITS
} from "./editorConstants";
import {
  canvasPointToNewNodeTopLeft,
  clientToUnscaledCanvasSpace,
  failureCanvasLocalDropPosition,
  parentLocalPositionFromPointer,
  scrollViewportCenterToUnscaledCanvasPosition
} from "./editorCanvasCoordinates";
import {
  buildEditorImportRollbackSnapshot,
  clampEditorNodePositionToCanvas,
  collectChildNodeIdsForContainer,
  mergePreservedOnFailureIntoDraftDsl,
  restoreEditorFromImportRollbackSnapshot
} from "./editorPageOrchestration";
import { createInitialFailureGraph } from "./editorFailureGraphInit";
import { getEffectiveNodeHeight, getNodeHeight, getPortOffsets } from "./editorNodeLayout";
import {
  applyImportedLayout,
  filterEdgesByContainerRules,
  getCanvasBounds,
  getCanvasSizeForNodes,
  getContainerBranchCount,
  getContainerFrameLayout,
  getContainerHeaderLabel,
  getContainerType,
  getContainerTypeById,
  getDefaultContainerFrameSize,
  getNodeContainerKey,
  isContainerNode,
  normalizeContainerAssignments,
  normalizeContainerFrames
} from "./editorContainerLayout";
import { buildDslJson, buildStateNameMap, buildViewJson } from "./editorDslBuild";
import {
  failureGraphFromOnFailureDsl,
  parseDslToEditor,
  validateImportedDslForEditor
} from "./editorDslParse";
import {
  assignEditorCountersAfterDraftLoad,
  clamp,
  getNextIndexFromIds,
  isRecord,
  parseEditorNodeClipboard,
  serializeEditorNodeClipboard
} from "./editorPureUtils";
import { parseEditorView } from "./editorViewJson";
import {
  getRetryScopeNodeIds,
  isForbiddenInRetryScope,
  recomputeRetryScopeMembership
} from "./editorRetryScope";
import {
  createNodeTypeConfigFromSkillsets,
  getSkillDisplayType,
  getSkillNodeKind
} from "./editorSkillset";
import type {
  ConditionExpression,
  ConditionOperator,
  ConnectingState,
  ContainerFrameData,
  ContainerType,
  DragState,
  EditorEdge,
  EditorNode,
  EditorViewJson,
  EdgeDragPayload,
  FailureHandlingGraph,
  NodeCategory,
  NodeKind,
  NodeTypeConfig,
  ResizeState,
  VariableRow,
  VariableValueType
} from "./editorTypes";
import { EditorNoticeToasts } from "./components/EditorNoticeToasts";
import { EditorPalette } from "./components/EditorPalette";
import { ImportOverwriteDialog } from "./components/dialogs/ImportOverwriteDialog";
import { ImportValidationFailDialog } from "./components/dialogs/ImportValidationFailDialog";
import { PublishConfirmDialog } from "./components/dialogs/PublishConfirmDialog";
import { NodeCard } from "./components/NodeCard";
import {
  applyAddConditionExpression,
  applyConditionExpressionFieldChange,
  applyRemoveConditionExpression
} from "./state/conditionMutations";
import {
  applyAddVariableRow,
  applyRemoveVariableRow,
  applyVariableRowChange
} from "./state/variableMutations";
import {
  applyNameChangeToNodes,
  applyParamChangeToNodes,
  applyRetryScopeEndChangeToNodes,
  mapNodesForToggleExpand,
  reduceMainGraphNodesAfterDelete
} from "./state/nodeMutations";
import { useFailureGraphCanvasHandlers } from "./useFailureGraphCanvasHandlers";

type EditorPageProps = {
  workflowId: string;
};

/** 노드 단축키와 충돌하지 않도록, 실제 키보드 포커스가 폼/편집 필드에 있는지 판별한다. */
function isEditableKeyboardTarget(event: KeyboardEvent): boolean {
  const isEditableElement = (el: HTMLElement): boolean => {
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return true;
    }
    if (el.isContentEditable) {
      return true;
    }
    return el.getAttribute("contenteditable") === "true";
  };

  const active = document.activeElement;
  if (active instanceof HTMLElement && isEditableElement(active)) {
    return true;
  }

  return event
    .composedPath()
    .some((node) => node instanceof HTMLElement && isEditableElement(node));
}

export function EditorPage({ workflowId }: EditorPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isNewWorkflow = workflowId === "new";
  const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<ConnectingState>(null);
  const [selectedCategory, setSelectedCategory] = useState<NodeCategory>("skill");
  const [zoom, setZoom] = useState(1);
  const [canvasBase, setCanvasBase] = useState(() => {
    // 초기값은 CANVAS_DEFAULT로 설정, 마운트 후 뷰포트 크기로 업데이트
    return CANVAS_DEFAULT;
  });
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftOverride, setDraftOverride] = useState<WorkflowDraft | null>(null);
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<EditorEdge[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [isEditingWorkflowName, setIsEditingWorkflowName] = useState(false);
  const [workflowName, setWorkflowName] = useState<string>("");
  const [originalWorkflowName, setOriginalWorkflowName] = useState<string>("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishToast, setPublishToast] = useState(false);
  const [failureFlowToastMessage, setFailureFlowToastMessage] = useState<string | null>(null);
  const [failureGraph, setFailureGraph] = useState<FailureHandlingGraph>(() =>
    createInitialFailureGraph(false)
  );
  const [importOverwriteConfirmOpen, setImportOverwriteConfirmOpen] = useState(false);
  const [importValidationFailOpen, setImportValidationFailOpen] = useState(false);
  const [importFailMessages, setImportFailMessages] = useState<string[]>([]);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImportRef = useRef<{
    dsl: Record<string, unknown>;
    fileBaseName: string;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const edgeErrorTimerRef = useRef<number | null>(null);
  const nextNodeIndex = useRef(1);
  const nextEdgeIndex = useRef(1);
  const nextConditionIndex = useRef(1);
  const nextVariableRowIndex = useRef(1);
  const nextRetryThemeIndex = useRef(0);
  const nextFailureNodeIndex = useRef(1);
  const loadedWorkflowId = useRef<string | null>(null);
  const preservedOnFailureDslRef = useRef<Record<string, unknown> | null>(null);

  /** 실패 캔버스에서 연결 시작 중인 (nodeId, portKey). null이면 메인 캔버스 연결. */
  const [failureConnectingFrom, setFailureConnectingFrom] = useState<{
    nodeId: string;
    portKey: string;
  } | null>(null);

  const { data: draft } = useQuery({
    queryKey: ["workflow-draft", workflowId],
    queryFn: () => workflowsApi.getDraft(workflowId),
    enabled: !isNewWorkflow
  });

  const { data: workflows, isLoading: isLoadingWorkflows } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });

  // Skillset 가져오기 (초기화 시 한 번만)
  const { data: skillsetsResponse } = useQuery({
    queryKey: ["skill_sets"],
    queryFn: () => skillsetsApi.list()
  });

  // Skillset 기반으로 동적 노드 타입 생성 (ENABLE_VLM_NODES 시 VLM 노드 포함)
  const nodeTypeConfig = useMemo(() => {
    const base = skillsetsResponse
      ? createNodeTypeConfigFromSkillsets(skillsetsResponse.skill_sets)
      : (STATIC_NODE_TYPE_CONFIG as Record<NodeKind, NodeTypeConfig>);
    if (!ENABLE_VLM_NODES) return base;
    return { ...base, "flow_control.vlm": STATIC_NODE_TYPE_CONFIG["flow_control.vlm"]! };
  }, [skillsetsResponse]);

  // Skillset 정보를 노드 kind로 매핑 (key: skill.namespace.name). 레거시 kind "skill.name"도 name으로 조회 가능하도록 보조 맵 사용
  const skillsetMap = useMemo(() => {
    if (!skillsetsResponse) return new Map<string, Skillset>();
    const map = new Map<string, Skillset>();
    skillsetsResponse.skill_sets.forEach((skillset) => {
      const key = getSkillNodeKind(skillset);
      map.set(key, skillset);
      // 레거시: skill.name 형태로 저장된 드래프트도 조회 가능
      const legacyKey = `skill.${skillset.name}`;
      if (!map.has(legacyKey)) map.set(legacyKey, skillset);
    });
    return map;
  }, [skillsetsResponse]);

  // 노드 id → DSL state name (변수 참조 자동완성용)
  const stateNameMap = useMemo(() => buildStateNameMap(nodes), [nodes]);

  // 노드 타입 목록 생성 (ENABLE_VLM_NODES 시 flow_control.vlm 포함)
  const nodeTypes = useMemo(() => {
    const staticTypes: NodeKind[] = [
      "flow_control.input",
      "flow_control.condition",
      "flow_control.output",
      "flow_control.repeat",
      "flow_control.parallel",
      "flow_control.retry",
      "event.webhook"
    ];
    if (ENABLE_VLM_NODES) {
      staticTypes.push("flow_control.vlm");
    }
    const skillTypes: NodeKind[] =
      skillsetsResponse?.skill_sets.map((s) => getSkillNodeKind(s)) ?? [];
    return [...skillTypes, ...staticTypes];
  }, [skillsetsResponse]);

  const activeDraft = draftOverride ?? draft;

  // 현재 workflow의 이름 가져오기
  useEffect(() => {
    if (!workflows) return;
    const currentWorkflow = workflows.find((w) => w.workflowId === workflowId);
    if (!currentWorkflow) return;
    // 이미 에디터에서 이름을 설정한 경우에는 리스트 refetch로 덮어쓰지 않음
    if (workflowName || originalWorkflowName) return;
    setWorkflowName(currentWorkflow.name);
    setOriginalWorkflowName(currentWorkflow.name);
  }, [workflows, workflowId, workflowName, originalWorkflowName]);

  const getViewportCanvasSize = useCallback(() => {
    if (!containerRef.current) return CANVAS_DEFAULT;
    const rect = containerRef.current.getBoundingClientRect();
    // 뷰포트 크기와 기본 크기 중 더 큰 값 사용
    return {
      width: Math.max(CANVAS_DEFAULT.width, Math.ceil(rect.width)),
      height: Math.max(CANVAS_DEFAULT.height, Math.ceil(rect.height))
    };
  }, []);

  const applyDraftToEditor = useCallback(
    (draftToApply: WorkflowDraft | null, options?: { markUnsaved?: boolean }) => {
      const markUnsaved = options?.markUnsaved === true;
      const getSize = () => {
        const viewportSize = getViewportCanvasSize();
        return viewportSize;
      };

      if (!draftToApply) {
        preservedOnFailureDslRef.current = null;
        setNodes([]);
        setEdges([]);
        setCanvasBase(getSize());
        setZoom(1);
        setHasUnsavedChanges(false);
        return;
      }

      preservedOnFailureDslRef.current = cloneDslOnFailureBlock(draftToApply.dsl_json);

      const hasOnFailure = dslJsonHasOnFailureKey(draftToApply.dsl_json);

      const parsed = parseEditorView(draftToApply.view_json, nodeTypes);
      let loadedNodes: EditorNode[] = [];
      let loadedEdges: EditorEdge[] = [];
      let canvas = parsed?.canvas;

      const applyFailureStateFromDraft = () => {
        if (!hasOnFailure) {
          setFailureGraph(createInitialFailureGraph(false));
          nextFailureNodeIndex.current = 1;
          return;
        }
        const viewFailure = parsed?.failure;
        const viewFailureHasFlow =
          viewFailure && viewFailure.edges.some((e) => e.from === viewFailure.entryNodeId);
        if (viewFailureHasFlow) {
          setFailureGraph({
            enabled: true,
            drawerOpen: false,
            entryNodeId: viewFailure.entryNodeId,
            nodes: viewFailure.nodes,
            edges: viewFailure.edges
          });
          nextFailureNodeIndex.current = getNextIndexFromIds(
            viewFailure.nodes.map((node) => node.id),
            "failure-node"
          );
        } else {
          const rawOnFailure = draftToApply.dsl_json.OnFailure;
          const onFailureDsl = isRecord(rawOnFailure) ? rawOnFailure : null;
          const fromDsl =
            onFailureDsl && failureGraphFromOnFailureDsl(onFailureDsl, nodeTypeConfig);
          if (fromDsl) {
            setFailureGraph(fromDsl);
            nextFailureNodeIndex.current = getNextIndexFromIds(
              fromDsl.nodes.map((n) => n.id),
              "failure-node"
            );
          } else {
            setFailureGraph(createInitialFailureGraph(true));
            nextFailureNodeIndex.current = 1;
          }
        }
      };

      if (parsed) {
        const normalizedNodes = normalizeContainerFrames(
          normalizeContainerAssignments(parsed.nodes)
        );
        loadedNodes = normalizedNodes;
        loadedEdges = filterEdgesByContainerRules(normalizedNodes, parsed.edges);
      } else {
        const imported = parseDslToEditor(draftToApply.dsl_json, nodeTypeConfig);
        if (imported) {
          loadedNodes = imported.nodes;
          loadedEdges = imported.edges;
          canvas = imported.canvas;
        }
      }

      if (loadedNodes.length === 0 && loadedEdges.length === 0) {
        setNodes([]);
        setEdges([]);
        setCanvasBase(getSize());
        setZoom(1);
        applyFailureStateFromDraft();
        setHasUnsavedChanges(markUnsaved);
        return;
      }

      applyFailureStateFromDraft();

      setNodes(loadedNodes);
      setEdges(loadedEdges);
      if (canvas) {
        const viewportSize = getViewportCanvasSize();
        setCanvasBase({
          width: Math.max(viewportSize.width, canvas.width),
          height: Math.max(viewportSize.height, canvas.height)
        });
        setZoom(clamp(canvas.zoom, ZOOM_LIMITS.min, ZOOM_LIMITS.max));
      } else {
        setCanvasBase(getSize());
        setZoom(1);
      }
      assignEditorCountersAfterDraftLoad(loadedNodes, loadedEdges, {
        nextNodeIndex,
        nextEdgeIndex,
        nextConditionIndex,
        nextVariableRowIndex
      });
      setSelectedNode(null);
      setSelectedEdgeId(null);
      setConnectingFrom(null);
      setEditingNodeId(null);
      setHasUnsavedChanges(markUnsaved);
    },
    [nodeTypeConfig, nodeTypes, getViewportCanvasSize]
  );

  useEffect(() => {
    if (!activeDraft) return;
    if (loadedWorkflowId.current === activeDraft.workflowId) return;
    loadedWorkflowId.current = activeDraft.workflowId;
    applyDraftToEditor(activeDraft);
  }, [activeDraft, applyDraftToEditor]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateCanvasSize = () => {
      const viewportSize = getViewportCanvasSize();
      setCanvasBase((prev) => {
        // 저장된 크기나 현재 크기가 뷰포트보다 작으면 뷰포트 크기로 확장
        // 하지만 저장된 크기가 더 크면 유지 (노드들이 밖으로 나가지 않도록)
        const newWidth = Math.max(viewportSize.width, prev.width);
        const newHeight = Math.max(viewportSize.height, prev.height);
        // 크기가 실제로 변경된 경우에만 업데이트
        if (newWidth !== prev.width || newHeight !== prev.height) {
          return { width: newWidth, height: newHeight };
        }
        return prev;
      });
    };

    // 초기 크기 설정 (컨테이너가 마운트된 후 약간의 지연)
    const timeoutId = setTimeout(() => {
      updateCanvasSize();
    }, 0);

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [getViewportCanvasSize]);

  const { data: validationErrors = [] } = useQuery({
    queryKey: ["workflow-validation", workflowId],
    queryFn: () => workflowsApi.validateDraft(workflowId),
    enabled: Boolean(draft)
  });

  const saveMutation = useMutation({
    mutationFn: ({
      workflowId: targetWorkflowId,
      payload
    }: {
      workflowId: string;
      payload: WorkflowDraft;
    }) => workflowsApi.saveDraft(targetWorkflowId, payload),
    onSuccess: (saved, variables) => {
      const sentDsl = variables.payload.dsl_json as Record<string, unknown>;
      const mergedDsl = mergeDslOnFailureIfServerDropped(
        (saved.dsl_json ?? {}) as Record<string, unknown>,
        sentDsl
      );
      setDraftOverride({ ...saved, dsl_json: mergedDsl });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      if (saved.workflowId !== workflowId) {
        router.replace(`/editor/${saved.workflowId}`);
      }
      setHasUnsavedChanges(false);
      // 테스트용: 저장된 DSL JSON 확인
      const dslString = JSON.stringify(saved.dsl_json ?? {}, null, 2);
      console.log("[Save] DSL JSON:", dslString);
      navigator.clipboard?.writeText(dslString).catch(() => {});
    }
  });

  const buildCurrentDraftPayload = () => {
    let dsl_json = buildDslJson(nodes, validEdges, skillsetMap, failureGraph) as Record<
      string,
      unknown
    >;
    let dslHasOnFailure = dslJsonHasOnFailureKey(dsl_json);
    const hasFailureStartEdge = failureGraph.edges.some((e) => e.from === failureGraph.entryNodeId);
    const mergedOnFailure = mergePreservedOnFailureIntoDraftDsl(
      dsl_json,
      dslHasOnFailure,
      hasFailureStartEdge,
      preservedOnFailureDslRef.current
    );
    dsl_json = mergedOnFailure.dsl_json;
    dslHasOnFailure = mergedOnFailure.dslHasOnFailure;
    const view_json = buildViewJson(
      nodes,
      validEdges,
      canvasBase,
      zoom,
      failureGraph,
      dslHasOnFailure
    );
    preservedOnFailureDslRef.current = cloneDslOnFailureBlock(dsl_json);
    const updatedAt = new Date().toISOString();
    return { view_json, dsl_json, updatedAt };
  };

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (hasErrors) return;

      let targetWorkflowId = workflowId;
      const { view_json, dsl_json, updatedAt } = buildCurrentDraftPayload();

      if (isNewWorkflow) {
        const name = workflowName.trim() || "Untitled Workflow";
        const created = await workflowsApi.create({ name });
        targetWorkflowId = created.workflowId;
      }

      await saveMutation.mutateAsync({
        workflowId: targetWorkflowId,
        payload: {
          workflowId: targetWorkflowId,
          dsl_json,
          view_json,
          updatedAt
        }
      });

      await workflowsApi.publish(targetWorkflowId);
      return targetWorkflowId;
    },
    onSuccess: (targetWorkflowId) => {
      if (!targetWorkflowId) return;
      setShowPublishConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["workflow", targetWorkflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      router.push(`/monitor/workflow/${targetWorkflowId}`);
    }
  });

  const containerEmptyBranches = useMemo(() => {
    const map = new Map<string, Set<number>>();
    nodes.forEach((node) => {
      if (!isContainerNode(node)) return;
      const containerType = getContainerType(node.kind);
      if (!containerType) return;
      const branchCount = getContainerBranchCount(node);
      const empty = new Set<number>();
      if (containerType === "repeat") {
        const hasBodyNodes = nodes.some((child) => child.containerId === node.id);
        if (!hasBodyNodes) {
          empty.add(0);
        }
      } else {
        for (let index = 0; index < branchCount; index += 1) {
          const hasBranchNodes = nodes.some(
            (child) => child.containerId === node.id && (child.branchIndex ?? 0) === index
          );
          if (!hasBranchNodes) {
            empty.add(index);
          }
        }
      }
      if (empty.size > 0) {
        map.set(node.id, empty);
      }
    });
    return map;
  }, [nodes]);

  const containerWarningLabels = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node) => {
      const empty = containerEmptyBranches.get(node.id);
      if (!empty) return;
      const containerType = getContainerType(node.kind);
      if (containerType === "repeat") {
        map.set(node.id, "Empty body");
      } else {
        map.set(node.id, `${empty.size} empty`);
      }
    });
    return map;
  }, [containerEmptyBranches, nodes]);

  const containerWarnings = useMemo<ValidationError[]>(() => {
    const warnings: ValidationError[] = [];
    nodes.forEach((node) => {
      const empty = containerEmptyBranches.get(node.id);
      if (!empty) return;
      const containerType = getContainerType(node.kind);
      if (containerType === "repeat") {
        warnings.push({
          id: `${node.id}-empty-body`,
          message: "Repeat body is empty.",
          nodeId: node.id
        });
        return;
      }
      empty.forEach((index) => {
        warnings.push({
          id: `${node.id}-branch-${index}`,
          message: `Parallel branch ${index + 1} is empty.`,
          nodeId: node.id
        });
      });
    });
    return warnings;
  }, [containerEmptyBranches, nodes]);

  const { startEndValidationErrors, startEndBadges } = useMemo(() => {
    const containerTypeById = getContainerTypeById(nodes);
    const containerIds = new Set(nodes.filter(isContainerNode).map((n) => n.id));
    const topLevelNodes = nodes.filter((n) => !n.containerId || !containerIds.has(n.containerId));
    const topLevelNodeIds = new Set(topLevelNodes.map((n) => n.id));
    const validEdgesLocal = edges.filter((edge) => {
      const fromNode = nodes.find((n) => n.id === edge.from);
      const toNode = nodes.find((n) => n.id === edge.to);
      if (!fromNode || !toNode) return false;
      const fromKey = getNodeContainerKey(fromNode, containerTypeById);
      const toKey = getNodeContainerKey(toNode, containerTypeById);
      if (!fromKey && !toKey) return true;
      return fromKey !== null && fromKey === toKey;
    });

    const scopes: Array<{
      scopeKey: string;
      nodeIds: string[];
      edges: Array<{ from: string; to: string }>;
      isRoot: boolean;
      containerId?: string;
    }> = [];

    scopes.push({
      scopeKey: "root",
      nodeIds: topLevelNodes.map((n) => n.id),
      edges: validEdgesLocal
        .filter((e) => topLevelNodeIds.has(e.from) && topLevelNodeIds.has(e.to))
        .map((e) => ({ from: e.from, to: e.to })),
      isRoot: true
    });

    nodes.forEach((node) => {
      if (!isContainerNode(node)) return;
      const containerType = getContainerType(node.kind);
      if (!containerType) return;
      if (containerType === "repeat") {
        const bodyNodes = nodes.filter((n) => n.containerId === node.id);
        const bodyIds = new Set(bodyNodes.map((n) => n.id));
        scopes.push({
          scopeKey: `${node.id}:body`,
          nodeIds: bodyNodes.map((n) => n.id),
          edges: validEdgesLocal
            .filter((e) => bodyIds.has(e.from) && bodyIds.has(e.to))
            .map((e) => ({ from: e.from, to: e.to })),
          isRoot: false,
          containerId: node.id
        });
        return;
      }
      const branchCount = getContainerBranchCount(node);
      for (let index = 0; index < branchCount; index += 1) {
        const branchNodes = nodes.filter(
          (n) => n.containerId === node.id && (n.branchIndex ?? 0) === index
        );
        const branchIds = new Set(branchNodes.map((n) => n.id));
        scopes.push({
          scopeKey: `${node.id}:branch:${index}`,
          nodeIds: branchNodes.map((n) => n.id),
          edges: validEdgesLocal
            .filter((e) => branchIds.has(e.from) && branchIds.has(e.to))
            .map((e) => ({ from: e.from, to: e.to })),
          isRoot: false,
          containerId: node.id
        });
      }
    });

    const validationErrorsList: ValidationError[] = [];
    const badges = new Map<
      string,
      {
        showStart: boolean;
        showEnd: boolean;
        isRootScope: boolean;
        startError?: string;
      }
    >();

    const expandedContainerIds = new Set(
      nodes.filter((n) => isContainerNode(n) && n.isExpanded).map((n) => n.id)
    );

    scopes.forEach((scope) => {
      const graph: ScopeGraph = {
        nodeIds: scope.nodeIds,
        edges: scope.edges
      };
      const result = computeStartEndForScope(graph);
      const showBadges =
        scope.isRoot || (scope.containerId != null && expandedContainerIds.has(scope.containerId));

      if (result.startError) {
        const scopeLabel = scope.isRoot
          ? "Root workflow"
          : scope.scopeKey.includes(":body")
            ? `Repeat body (${scope.containerId})`
            : `Parallel branch (${scope.containerId})`;
        validationErrorsList.push({
          id: `start-end-${scope.scopeKey}`,
          message: `${scopeLabel}: ${result.startError}`,
          nodeId: scope.containerId ?? undefined
        });
      }

      const startCandidateSet = new Set(result.startCandidateIds ?? []);

      scope.nodeIds.forEach((nodeId) => {
        const isStart = result.startNodeId === nodeId;
        const isStartCandidateWithError = Boolean(
          showBadges && result.startError && startCandidateSet.has(nodeId)
        );
        const isEnd = result.endNodeIds.includes(nodeId);
        const existing = badges.get(nodeId);
        badges.set(nodeId, {
          showStart:
            (existing?.showStart ?? false) ||
            (showBadges && (isStart || isStartCandidateWithError)),
          showEnd: (existing?.showEnd ?? false) || (showBadges && isEnd),
          isRootScope: existing?.isRootScope ?? scope.isRoot,
          startError:
            existing?.startError ?? (isStartCandidateWithError ? result.startError : undefined)
        });
      });
    });

    return {
      startEndValidationErrors: validationErrorsList,
      startEndBadges: badges
    };
  }, [nodes, edges]);

  const effectiveNodeHeightMap = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach((node) => {
      const badge = startEndBadges.get(node.id);
      const hasRibbon = Boolean(badge?.showStart || badge?.showEnd);
      map.set(node.id, getEffectiveNodeHeight(node, nodeTypeConfig, hasRibbon));
    });
    return map;
  }, [nodes, nodeTypeConfig, startEndBadges]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const required = getCanvasSizeForNodes(nodes, nodeTypeConfig, effectiveNodeHeightMap);
    setCanvasBase((prev) => {
      const nextWidth = Math.max(prev.width, required.width);
      const nextHeight = Math.max(prev.height, required.height);
      if (nextWidth === prev.width && nextHeight === prev.height) {
        return prev;
      }
      return { width: nextWidth, height: nextHeight };
    });
  }, [nodes, nodeTypeConfig, effectiveNodeHeightMap]);

  const retryValidationErrors = useMemo<ValidationError[]>(() => {
    const errs: ValidationError[] = [];
    nodes.forEach((node) => {
      if (node.kind !== "flow_control.retry") return;
      for (const scopeType of ["main", "failure"] as const) {
        const scopeIds = getRetryScopeNodeIds(node.id, scopeType, nodes, edges);
        scopeIds.forEach((nid) => {
          const n = nodes.find((x) => x.id === nid);
          if (!n) return;
          if (isForbiddenInRetryScope(n.kind)) {
            errs.push({
              id: `retry-forbidden-${node.id}-${scopeType}-${nid}`,
              message: `Retry ${scopeType} scope cannot contain Branch/Parallel/Merge/Retry nodes (v0).`,
              nodeId: n.id
            });
          }
        });
      }
    });
    return errs;
  }, [nodes, edges]);

  const allValidationErrors = useMemo(
    () => [
      ...validationErrors,
      ...containerWarnings,
      ...startEndValidationErrors,
      ...retryValidationErrors
    ],
    [containerWarnings, validationErrors, startEndValidationErrors, retryValidationErrors]
  );

  const hasErrors = allValidationErrors.length > 0;

  const nodeMap = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const collapsedContainerIds = useMemo(() => {
    return new Set(
      nodes.filter((node) => isContainerNode(node) && !node.isExpanded).map((node) => node.id)
    );
  }, [nodes]);

  const visibleNodes = useMemo(() => {
    if (collapsedContainerIds.size === 0) return nodes;
    return nodes.filter(
      (node) => !node.containerId || !collapsedContainerIds.has(node.containerId)
    );
  }, [collapsedContainerIds, nodes]);

  const visibleNodeIds = useMemo(() => {
    return new Set(visibleNodes.map((node) => node.id));
  }, [visibleNodes]);

  const containerTypeById = useMemo(() => {
    return getContainerTypeById(nodes);
  }, [nodes]);

  const validEdges = useMemo(() => {
    return filterEdgesByContainerRules(nodes, edges);
  }, [edges, nodes]);

  const nodeTypesByCategory = useMemo(() => {
    return nodeTypes.reduce(
      (acc, kind) => {
        const config = nodeTypeConfig[kind];
        if (config) {
          acc[config.category].push(kind);
        }
        return acc;
      },
      {
        skill: [],
        flow_control: [],
        event: []
      } as Record<NodeCategory, NodeKind[]>
    );
  }, [nodeTypes, nodeTypeConfig]);

  const incomingEdges = useMemo(() => {
    const set = new Set<string>();
    validEdges.forEach((edge) => set.add(edge.to));
    return set;
  }, [validEdges]);

  const outgoingEdges = useMemo(() => {
    const map = new Map<string, EditorEdge>();
    validEdges.forEach((edge) => {
      map.set(`${edge.from}:${edge.fromPort}`, edge);
    });
    return map;
  }, [validEdges]);

  const getCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return clientToUnscaledCanvasSpace(rect, clientX, clientY, zoom);
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
    return scrollViewportCenterToUnscaledCanvasPosition(
      container.scrollLeft,
      container.scrollTop,
      container.clientWidth,
      container.clientHeight,
      zoom,
      NODE_METRICS.width,
      NODE_METRICS.collapsedHeight
    );
  }, [canvasBase, zoom]);

  const resolveContainerAssignment = useCallback(
    (allNodes: EditorNode[], targetNode: EditorNode) => {
      if (isContainerNode(targetNode)) return null;
      const hasRibbon = Boolean(
        startEndBadges.get(targetNode.id)?.showStart || startEndBadges.get(targetNode.id)?.showEnd
      );
      const nodeHeight = getEffectiveNodeHeight(targetNode, nodeTypeConfig, hasRibbon);
      const center = {
        x: targetNode.position.x + NODE_METRICS.width / 2,
        y: targetNode.position.y + nodeHeight / 2
      };
      const containerNodes = allNodes.filter((node) => isContainerNode(node) && node.isExpanded);
      for (const containerNode of containerNodes) {
        const layout = getContainerFrameLayout(containerNode, nodeTypeConfig);
        if (!layout) continue;
        for (const region of layout.regions) {
          const withinX =
            center.x >= region.bounds.x && center.x <= region.bounds.x + region.bounds.width;
          const withinY =
            center.y >= region.bounds.y && center.y <= region.bounds.y + region.bounds.height;
          if (!withinX || !withinY) continue;
          const containerType = getContainerType(containerNode.kind);
          if (!containerType) continue;
          return {
            containerId: containerNode.id,
            containerType,
            branchIndex: containerType === "parallel" ? region.index : null
          };
        }
      }
      return null;
    },
    [nodeTypeConfig, startEndBadges]
  );

  const finalizeNodeDrag = useCallback(
    (nodeId: string) => {
      setNodes((prev) => {
        const target = prev.find((node) => node.id === nodeId);
        if (!target || isContainerNode(target)) return prev;
        const assignment = resolveContainerAssignment(prev, target);
        const nextContainerId = assignment?.containerId ?? null;
        const nextContainerType = assignment?.containerType ?? null;
        const nextBranchIndex = assignment?.branchIndex ?? null;
        const changed =
          target.containerId !== nextContainerId ||
          target.containerType !== nextContainerType ||
          (target.branchIndex ?? null) !== (nextBranchIndex ?? null);
        if (!changed) return prev;
        const nextNodes = prev.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                containerId: nextContainerId,
                containerType: nextContainerType,
                branchIndex: nextBranchIndex
              }
            : node
        );
        setEdges((prevEdges) => filterEdgesByContainerRules(nextNodes, prevEdges));
        setHasUnsavedChanges(true);
        return nextNodes;
      });
    },
    [resolveContainerAssignment]
  );

  const handleContainerResizeStart = useCallback(
    (nodeId: string, handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      const target = nodeMap.get(nodeId);
      if (!target) return;
      const layout = getContainerFrameLayout(target, nodeTypeConfig);
      if (!layout) return;
      setResizeState({
        nodeId,
        handle,
        startPoint: point,
        startWidth: layout.frame.width,
        startHeight: layout.frame.height
      });
    },
    [getCanvasPoint, nodeMap, nodeTypeConfig]
  );

  useEffect(() => {
    if (!dragState) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;

      const nextX = point.x - dragState.offsetX;
      const nextY = point.y - dragState.offsetY;

      setNodes((prev) => {
        const target = prev.find((node) => node.id === dragState.nodeId);
        if (!target) return prev;
        const candidatePosition = { x: nextX, y: nextY };
        let requiredWidth = Math.max(
          canvasBase.width,
          candidatePosition.x + NODE_METRICS.width + CANVAS_PADDING.x
        );
        let requiredHeight = Math.max(
          canvasBase.height,
          candidatePosition.y + dragState.height + CANVAS_PADDING.y
        );
        if (isContainerNode(target)) {
          const layout = getContainerFrameLayout(
            { ...target, position: candidatePosition },
            nodeTypeConfig
          );
          if (layout) {
            requiredWidth = Math.max(
              requiredWidth,
              layout.frame.x + layout.frame.width + CANVAS_PADDING.x
            );
            requiredHeight = Math.max(
              requiredHeight,
              layout.frame.y + layout.frame.height + CANVAS_PADDING.y
            );
          }
        }

        if (requiredWidth > canvasBase.width || requiredHeight > canvasBase.height) {
          setCanvasBase((base) => ({
            width: Math.max(base.width, requiredWidth),
            height: Math.max(base.height, requiredHeight)
          }));
        }

        const { minX, minY, maxX, maxY } = getCanvasBounds(
          { width: requiredWidth, height: requiredHeight },
          dragState.height
        );
        const nextPosition = {
          x: clamp(candidatePosition.x, minX, maxX),
          y: clamp(candidatePosition.y, minY, maxY)
        };
        const delta = {
          x: nextPosition.x - target.position.x,
          y: nextPosition.y - target.position.y
        };
        if (delta.x === 0 && delta.y === 0) return prev;
        if (isContainerNode(target)) {
          return prev.map((node) => {
            if (node.id === target.id) {
              return { ...node, position: nextPosition };
            }
            if (node.containerId === target.id) {
              return {
                ...node,
                position: {
                  x: node.position.x + delta.x,
                  y: node.position.y + delta.y
                }
              };
            }
            return node;
          });
        }
        return prev.map((node) =>
          node.id === target.id ? { ...node, position: nextPosition } : node
        );
      });
    };

    const handlePointerUp = () => {
      setDragState(null);
      finalizeNodeDrag(dragState.nodeId);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [
    canvasBase.height,
    canvasBase.width,
    dragState,
    finalizeNodeDrag,
    getCanvasPoint,
    nodeTypeConfig
  ]);

  useEffect(() => {
    if (!resizeState) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      const deltaX = point.x - resizeState.startPoint.x;
      const deltaY = point.y - resizeState.startPoint.y;
      setNodes((prev) => {
        const target = prev.find((node) => node.id === resizeState.nodeId);
        if (!target) return prev;
        const layout = getContainerFrameLayout(target, nodeTypeConfig);
        if (!layout) return prev;
        const frameX = layout.frame.x;
        const frameY = layout.frame.y;
        let nextWidth = resizeState.startWidth;
        let nextHeight = resizeState.startHeight;
        if (resizeState.handle === "e" || resizeState.handle === "se") {
          nextWidth += deltaX;
        }
        if (resizeState.handle === "s" || resizeState.handle === "se") {
          nextHeight += deltaY;
        }
        nextWidth = Math.max(nextWidth, CONTAINER_FRAME_METRICS.minWidth);
        nextHeight = Math.max(nextHeight, CONTAINER_FRAME_METRICS.minHeight);
        const requiredWidth = frameX + nextWidth + CANVAS_PADDING.x;
        const requiredHeight = frameY + nextHeight + CANVAS_PADDING.y;
        if (requiredWidth > canvasBase.width || requiredHeight > canvasBase.height) {
          setCanvasBase((base) => ({
            width: Math.max(base.width, requiredWidth),
            height: Math.max(base.height, requiredHeight)
          }));
        }
        const containerType = getContainerType(target.kind);
        if (!containerType) return prev;
        const branchCount = getContainerBranchCount(target);
        const nextFrame: ContainerFrameData = {
          width: nextWidth,
          height: nextHeight,
          ...(containerType === "parallel" ? { branchCount } : {})
        };
        if (
          target.containerFrame?.width === nextWidth &&
          target.containerFrame?.height === nextHeight
        ) {
          return prev;
        }
        return prev.map((node) =>
          node.id === target.id ? { ...node, containerFrame: nextFrame } : node
        );
      });
    };

    const handlePointerUp = () => {
      setResizeState(null);
      setHasUnsavedChanges(true);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [canvasBase.height, canvasBase.width, getCanvasPoint, nodeTypeConfig, resizeState]);

  const buildDefaultParams = useCallback(
    (kind: NodeKind) => {
      const config = nodeTypeConfig[kind];
      if (!config) return {};
      const base = config.paramFields.reduce(
        (acc, field) => ({
          ...acc,
          [field.key]: ""
        }),
        {} as Record<string, string>
      );
      if (kind === "flow_control.retry") {
        if (!base.maxAttempts) {
          base.maxAttempts = "2";
        }
        if (base.onFailureEnabled === undefined) {
          base.onFailureEnabled = "true";
        }
        if (base.mainScopeEndId === undefined) {
          base.mainScopeEndId = "";
        }
        if (base.failureScopeEndId === undefined) {
          base.failureScopeEndId = "";
        }
      }
      return base;
    },
    [nodeTypeConfig]
  );

  const createConditionExpression = useCallback(
    (operator: ConditionOperator | null): ConditionExpression => ({
      id: `condition-${nextConditionIndex.current++}`,
      operator,
      variable: "",
      comparisonOperator: "==",
      value: ""
    }),
    []
  );

  const normalizeConditionExpressions = useCallback(
    (expressions: ConditionExpression[]) => {
      if (expressions.length === 0) {
        return [createConditionExpression(null)];
      }
      return expressions.map((expression, index) =>
        index === 0 ? { ...expression, operator: null } : expression
      );
    },
    [createConditionExpression]
  );

  const {
    addFailureNode,
    handleFailureToggleExpand,
    handleFailureStartConnect,
    handleFailureInputDrop,
    handleFailureParamChange,
    handleFailureConditionExpressionFieldChange,
    handleFailureAddConditionExpression,
    handleFailureRemoveConditionExpression,
    handleFailureVariableRowChange,
    handleFailureAddVariableRow,
    handleFailureRemoveVariableRow,
    handleFailureNameChange,
    handleFailureRetryScopeEndChange
  } = useFailureGraphCanvasHandlers({
    failureGraph,
    failureConnectingFrom,
    setFailureGraph,
    setFailureConnectingFrom,
    setFailureFlowToastMessage,
    setHasUnsavedChanges,
    nodeTypeConfig,
    buildDefaultParams,
    createConditionExpression,
    normalizeConditionExpressions,
    nextFailureNodeIndex,
    nextVariableRowIndex,
    getCanvasBounds,
    clamp,
    recomputeRetryScopeMembership,
    isForbiddenInRetryScope
  });

  const createNode = useCallback(
    (kind: NodeKind, position?: { x: number; y: number }) => {
      if (kind === "flow_control.input") {
        const existingInput = nodes.find((node) => node.kind === "flow_control.input");
        if (existingInput) {
          setSelectedNode(existingInput.id);
          setSelectedEdgeId(null);
          setEditingNodeId(null);
          return;
        }
      }

      const basePosition = position ?? getViewportCenter();
      const nodeHeight = NODE_METRICS.collapsedHeight;
      const clampedPosition = clampEditorNodePositionToCanvas(
        canvasBase,
        basePosition,
        nodeHeight,
        getCanvasBounds,
        clamp
      );

      const index = nextNodeIndex.current++;
      const id = `node-${index}`;
      const config = nodeTypeConfig[kind];
      const name =
        kind === "flow_control.input"
          ? "Inputs"
          : kind === "flow_control.vlm"
            ? `VLMPlanner ${index}`
            : config
              ? `${config.label} ${index}`
              : `${kind} ${index}`;
      const params = buildDefaultParams(kind);
      if (kind === "flow_control.repeat" && !params.count) {
        params.count = "1";
      }
      const containerType = getContainerType(kind);
      const containerFrame =
        containerType !== null
          ? {
              ...getDefaultContainerFrameSize(containerType, DEFAULT_PARALLEL_BRANCHES),
              ...(containerType === "parallel" ? { branchCount: DEFAULT_PARALLEL_BRANCHES } : {})
            }
          : undefined;
      let retryThemeColor: string | null = null;
      if (kind === "flow_control.retry") {
        const theme = RETRY_THEME_COLORS[nextRetryThemeIndex.current % RETRY_THEME_COLORS.length];
        retryThemeColor = theme.key;
        nextRetryThemeIndex.current += 1;
      }

      const baseNode: EditorNode = {
        id,
        name,
        kind,
        position: clampedPosition,
        isExpanded: false,
        params,
        conditionExpressions:
          kind === "flow_control.condition" ? [createConditionExpression(null)] : undefined,
        // input / output 노드는 초기 생성 시 파라미터 row 0개
        variableRows:
          kind === "flow_control.input" || kind === "flow_control.output" ? [] : undefined,
        containerId: null,
        containerType: null,
        branchIndex: null,
        containerFrame,
        retryOwnerId: null,
        retryScopeType: null,
        isRetryScopeEnd: false,
        retryThemeColor
      };
      setNodes((prev) => {
        const assignment =
          containerType === null ? resolveContainerAssignment(prev, baseNode) : null;
        const nextNode = assignment ? { ...baseNode, ...assignment } : baseNode;
        return [...prev, nextNode];
      });
      setSelectedNode(id);
      setSelectedEdgeId(null);
    },
    [
      buildDefaultParams,
      canvasBase,
      createConditionExpression,
      getViewportCenter,
      nodeTypeConfig,
      nodes,
      resolveContainerAssignment
    ]
  );

  const buildPastedEditorNode = useCallback(
    (source: EditorNode): EditorNode => {
      const index = nextNodeIndex.current++;
      const newId = `node-${index}`;
      const nodeHeight = NODE_METRICS.collapsedHeight;
      const { minX, minY, maxX, maxY } = getCanvasBounds(canvasBase, nodeHeight);
      const offset = 24;
      const position = {
        x: clamp(source.position.x + offset, minX, maxX),
        y: clamp(source.position.y + offset, minY, maxY)
      };

      const remappedConditions = (source.conditionExpressions ?? []).map((expr) => ({
        ...expr,
        id: `condition-${nextConditionIndex.current++}`
      }));
      const remappedVariableRows = (source.variableRows ?? []).map((row) => ({
        ...row,
        id: `var-${nextVariableRowIndex.current++}`
      }));

      let params = { ...source.params };
      if (source.kind === "flow_control.retry") {
        params = {
          ...params,
          mainScopeEndId: "",
          failureScopeEndId: ""
        };
      }

      const conditionExpressions =
        source.kind === "flow_control.condition"
          ? normalizeConditionExpressions(remappedConditions)
          : undefined;

      return {
        ...source,
        id: newId,
        position,
        params,
        conditionExpressions,
        variableRows:
          source.kind === "flow_control.input" || source.kind === "flow_control.output"
            ? remappedVariableRows
            : undefined,
        containerId: null,
        containerType: null,
        branchIndex: null,
        retryOwnerId: null,
        retryScopeType: null,
        isRetryScopeEnd: false
      };
    },
    [canvasBase, normalizeConditionExpressions]
  );

  const handleSave = async () => {
    const { view_json, dsl_json, updatedAt } = buildCurrentDraftPayload();
    if (isNewWorkflow) {
      const name = workflowName.trim() || "Untitled Workflow";
      try {
        const created = await workflowsApi.create({ name });
        saveMutation.mutate({
          workflowId: created.workflowId,
          payload: {
            workflowId: created.workflowId,
            dsl_json,
            view_json,
            updatedAt
          }
        });
      } catch (error) {
        console.error("Failed to create workflow draft", error);
      }
      return;
    }

    saveMutation.mutate({
      workflowId,
      payload: {
        workflowId,
        dsl_json,
        view_json,
        updatedAt
      }
    });
    setHasUnsavedChanges(false);
  };

  const handlePublish = () => {
    if (hasErrors) return;
    setShowPublishConfirm(true);
  };

  const handleConfirmPublish = () => {
    publishMutation.mutate();
  };

  const handleImportFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    setShowWorkflowMenu(false);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportFailMessages(["Could not read the selected file."]);
      setImportValidationFailOpen(true);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      setImportFailMessages(["The file is not valid JSON."]);
      setImportValidationFailOpen(true);
      return;
    }
    if (!isRecord(parsed)) {
      setImportFailMessages(["Workflow import expects a JSON object at the root."]);
      setImportValidationFailOpen(true);
      return;
    }
    const fileBaseName = file.name.replace(/\.json$/i, "").trim() || "Imported workflow";
    pendingImportRef.current = { dsl: parsed, fileBaseName };
    setImportOverwriteConfirmOpen(true);
  };

  const cancelImportOverwrite = () => {
    setImportOverwriteConfirmOpen(false);
    pendingImportRef.current = null;
  };

  const confirmImportOverwrite = useCallback(() => {
    setImportOverwriteConfirmOpen(false);
    const pending = pendingImportRef.current;
    pendingImportRef.current = null;
    if (!pending) return;
    if (!skillsetsResponse) {
      setImportFailMessages(["The skill catalog is still loading. Please try again in a moment."]);
      setImportValidationFailOpen(true);
      return;
    }
    const check = validateImportedDslForEditor(pending.dsl, nodeTypeConfig);
    if (!check.ok) {
      setImportFailMessages(check.errors);
      setImportValidationFailOpen(true);
      return;
    }
    const snapshot = buildEditorImportRollbackSnapshot({
      nodes,
      edges,
      failureGraph,
      canvasBase,
      zoom,
      workflowName,
      originalWorkflowName,
      draftOverride,
      preservedOnFailureDsl: preservedOnFailureDslRef.current,
      nextNodeIndex: nextNodeIndex.current,
      nextEdgeIndex: nextEdgeIndex.current,
      nextConditionIndex: nextConditionIndex.current,
      nextVariableRowIndex: nextVariableRowIndex.current,
      nextFailureNodeIndex: nextFailureNodeIndex.current,
      hasUnsavedChanges,
      selectedNode,
      selectedEdgeId
    });
    try {
      const nextDraft: WorkflowDraft = {
        workflowId,
        dsl_json: JSON.parse(JSON.stringify(pending.dsl)) as Record<string, unknown>,
        view_json: {},
        updatedAt: new Date().toISOString()
      };
      setDraftOverride(nextDraft);
      applyDraftToEditor(nextDraft, { markUnsaved: true });
      setWorkflowName(pending.fileBaseName);
      setOriginalWorkflowName(pending.fileBaseName);
    } catch (error) {
      restoreEditorFromImportRollbackSnapshot(snapshot, {
        setNodes,
        setEdges,
        setFailureGraph,
        setCanvasBase,
        setZoom,
        setWorkflowName,
        setOriginalWorkflowName,
        setDraftOverride,
        preservedOnFailureDslRef,
        nextNodeIndex,
        nextEdgeIndex,
        nextConditionIndex,
        nextVariableRowIndex,
        nextFailureNodeIndex,
        setHasUnsavedChanges,
        setSelectedNode,
        setSelectedEdgeId
      });
      const message =
        error instanceof Error ? error.message : "An unexpected error occurred while importing.";
      setImportFailMessages([message]);
      setImportValidationFailOpen(true);
    }
  }, [
    skillsetsResponse,
    nodeTypeConfig,
    nodes,
    edges,
    failureGraph,
    canvasBase,
    zoom,
    workflowName,
    originalWorkflowName,
    draftOverride,
    hasUnsavedChanges,
    selectedNode,
    selectedEdgeId,
    workflowId,
    applyDraftToEditor
  ]);

  const handleEditorExport = () => {
    setShowWorkflowMenu(false);
    const { dsl_json } = buildCurrentDraftPayload();
    const base = sanitizeDownloadFileBaseName(workflowName.trim() || "workflow");
    downloadJsonFile(`${base}.json`, dsl_json);
  };

  const handleToggleExpand = (nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    const isContainer = target ? isContainerNode(target) : false;
    const willCollapse = Boolean(target && target.isExpanded && isContainer);
    const childIds = willCollapse ? collectChildNodeIdsForContainer(nodes, nodeId) : null;

    setNodes((prev) =>
      mapNodesForToggleExpand(
        prev,
        nodeId,
        nodeTypeConfig,
        canvasBase,
        startEndBadges,
        getCanvasBounds,
        clamp,
        getEffectiveNodeHeight
      )
    );
    if (target) {
      setHasUnsavedChanges(true);
    }

    if (willCollapse && childIds) {
      if (selectedNode && childIds.has(selectedNode)) {
        setSelectedNode(null);
      }
      if (editingNodeId && childIds.has(editingNodeId)) {
        setEditingNodeId(null);
      }
      if (connectingFrom && childIds.has(connectingFrom.nodeId)) {
        setConnectingFrom(null);
      }
      if (
        selectedEdgeId &&
        edges.some(
          (edge) => edge.id === selectedEdgeId && (childIds.has(edge.from) || childIds.has(edge.to))
        )
      ) {
        setSelectedEdgeId(null);
      }
    }
  };

  const handleRetryScopeEndChange = (nodeId: string, checked: boolean) => {
    setNodes((prev) =>
      applyRetryScopeEndChangeToNodes(prev, nodeId, checked, edges, isForbiddenInRetryScope)
    );
    setHasUnsavedChanges(true);
  };

  const handleParamChange = (nodeId: string, key: string, value: string) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some((n) => n.id === nodeId);
      return applyParamChangeToNodes(
        prev,
        nodeId,
        key,
        value,
        edges,
        recomputeRetryScopeMembership
      );
    });
    if (shouldMarkUnsaved) {
      setHasUnsavedChanges(true);
    }
    if (key === "onFailureEnabled" && value === "false") {
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.kind === "flow_control.retry") {
        setEdges((prev) => prev.filter((e) => !(e.from === nodeId && e.fromPort === "failure")));
      }
    }
  };

  const handleConditionExpressionFieldChange = (
    nodeId: string,
    expressionId: string,
    field: "variable" | "comparisonOperator" | "value",
    value: string
  ) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some((n) => n.id === nodeId && n.kind === "flow_control.condition");
      return applyConditionExpressionFieldChange(
        prev,
        nodeId,
        expressionId,
        field,
        value,
        createConditionExpression
      );
    });
    if (shouldMarkUnsaved) setHasUnsavedChanges(true);
  };

  const handleAddConditionExpression = (nodeId: string, operator: ConditionOperator) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some((n) => n.id === nodeId && n.kind === "flow_control.condition");
      return applyAddConditionExpression(
        prev,
        nodeId,
        operator,
        normalizeConditionExpressions,
        createConditionExpression,
        nodeTypeConfig,
        canvasBase,
        startEndBadges,
        getCanvasBounds,
        clamp,
        getEffectiveNodeHeight
      );
    });
    if (shouldMarkUnsaved) setHasUnsavedChanges(true);
  };

  const handleRemoveConditionExpression = (nodeId: string, expressionId: string) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some((n) => n.id === nodeId && n.kind === "flow_control.condition");
      return applyRemoveConditionExpression(
        prev,
        nodeId,
        expressionId,
        normalizeConditionExpressions,
        nodeTypeConfig,
        canvasBase,
        startEndBadges,
        getCanvasBounds,
        clamp,
        getEffectiveNodeHeight
      );
    });
    if (shouldMarkUnsaved) setHasUnsavedChanges(true);
  };

  const handleVariableRowChange = (
    nodeId: string,
    rowId: string,
    field: "name" | "value",
    value: string
  ) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some(
        (n) =>
          n.id === nodeId && (n.kind === "flow_control.input" || n.kind === "flow_control.output")
      );
      return applyVariableRowChange(prev, nodeId, rowId, field, value);
    });
    if (shouldMarkUnsaved) setHasUnsavedChanges(true);
  };

  const handleAddVariableRow = (nodeId: string, valueType: VariableValueType) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some(
        (n) =>
          n.id === nodeId && (n.kind === "flow_control.input" || n.kind === "flow_control.output")
      );
      return applyAddVariableRow(
        prev,
        nodeId,
        valueType,
        () => `var-${nextVariableRowIndex.current++}`,
        nodeTypeConfig,
        canvasBase,
        startEndBadges,
        getCanvasBounds,
        clamp,
        getEffectiveNodeHeight
      );
    });
    if (shouldMarkUnsaved) setHasUnsavedChanges(true);
  };

  const handleRemoveVariableRow = (nodeId: string, rowId: string) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some(
        (n) =>
          n.id === nodeId && (n.kind === "flow_control.input" || n.kind === "flow_control.output")
      );
      return applyRemoveVariableRow(
        prev,
        nodeId,
        rowId,
        nodeTypeConfig,
        canvasBase,
        startEndBadges,
        getCanvasBounds,
        clamp,
        getEffectiveNodeHeight
      );
    });
    if (shouldMarkUnsaved) setHasUnsavedChanges(true);
  };

  const handleNameChange = (nodeId: string, value: string) => {
    let shouldMarkUnsaved = false;
    setNodes((prev) => {
      shouldMarkUnsaved = prev.some((n) => n.id === nodeId);
      return applyNameChangeToNodes(prev, nodeId, value);
    });
    if (shouldMarkUnsaved) setHasUnsavedChanges(true);
  };

  const handleStartEditName = (nodeId: string) => {
    setEditingNodeId(nodeId);
    setSelectedNode(nodeId);
    setSelectedEdgeId(null);
  };

  const handleFinishEditName = () => {
    setEditingNodeId(null);
  };

  const handleDeleteNode = (nodeId: string) => {
    // Failure flow 캔버스에 존재하는 노드인 경우 별도 처리
    if (failureGraph.nodes.some((n) => n.id === nodeId)) {
      // entry 노드는 삭제 불가
      if (nodeId === failureGraph.entryNodeId) {
        return;
      }
      setFailureGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
      }));
      setHasUnsavedChanges(true);
      return;
    }

    const connectedEdgeIds = edges
      .filter((edge) => edge.from === nodeId || edge.to === nodeId)
      .map((edge) => edge.id);
    setNodes((prev) => {
      const nextNodes = reduceMainGraphNodesAfterDelete(prev, nodeId, edges);
      setEdges((prevEdges) => {
        const trimmed = prevEdges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
        return filterEdgesByContainerRules(nextNodes, trimmed);
      });
      return nextNodes;
    });
    setSelectedNode((prev) => (prev === nodeId ? null : prev));
    setSelectedEdgeId((prev) => (prev && connectedEdgeIds.includes(prev) ? null : prev));
    setConnectingFrom((prev) => (prev && prev.nodeId === nodeId ? null : prev));
    setEditingNodeId((prev) => (prev === nodeId ? null : prev));
    setHasUnsavedChanges(true);
  };

  const handleDeleteEdge = (edgeId: string) => {
    const edge = edges.find((e) => e.id === edgeId);
    const fromNode = edge ? nodeMap.get(edge.from) : null;
    const isRetryScopeStartEdge =
      fromNode?.kind === "flow_control.retry" &&
      (edge?.fromPort === "main" || edge?.fromPort === "failure");
    if (isRetryScopeStartEdge && edge) {
      const ownerId = edge.from;
      const scopeType = edge.fromPort as "main" | "failure";
      setNodes((prev) =>
        prev.map((n) =>
          n.retryOwnerId === ownerId && n.retryScopeType === scopeType
            ? {
                ...n,
                retryOwnerId: null,
                retryScopeType: null,
                isRetryScopeEnd: false
              }
            : n
        )
      );
    }
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    setSelectedEdgeId((prev) => (prev === edgeId ? null : prev));
    setHasUnsavedChanges(true);
  };

  useEffect(() => {
    const runModKeyCopy = (event: KeyboardEvent) => {
      if (!selectedNode) return;
      const node = nodes.find((n) => n.id === selectedNode);
      if (!node) return;
      event.preventDefault();
      void navigator.clipboard.writeText(serializeEditorNodeClipboard(node));
    };

    const runModKeyCut = (event: KeyboardEvent) => {
      if (!selectedNode) return;
      const node = nodes.find((n) => n.id === selectedNode);
      if (!node) return;
      event.preventDefault();
      void navigator.clipboard.writeText(serializeEditorNodeClipboard(node));
      handleDeleteNode(selectedNode);
    };

    const runModKeyPaste = (event: KeyboardEvent) => {
      event.preventDefault();
      void (async () => {
        let text: string;
        try {
          text = await navigator.clipboard.readText();
        } catch {
          return;
        }
        const source = parseEditorNodeClipboard(text);
        if (!source) return;
        if (!nodeTypeConfig[source.kind]) return;
        if (source.kind === "flow_control.vlm" && !ENABLE_VLM_NODES) return;
        if (source.kind === "flow_control.input") {
          const existingInput = nodes.find((n) => n.kind === "flow_control.input");
          if (existingInput) {
            setSelectedNode(existingInput.id);
            setSelectedEdgeId(null);
            return;
          }
        }
        const newNode = buildPastedEditorNode(source);
        setNodes((prev) => [...prev, newNode]);
        setSelectedNode(newNode.id);
        setSelectedEdgeId(null);
        setEditingNodeId(null);
        setHasUnsavedChanges(true);
      })();
    };

    const runDeleteOrBackspace = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableKeyboardTarget(event)) return;
      if (selectedNode) {
        event.preventDefault();
        handleDeleteNode(selectedNode);
        return;
      }
      if (selectedEdgeId) {
        event.preventDefault();
        handleDeleteEdge(selectedEdgeId);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isTypingTarget = isEditableKeyboardTarget(event);

      const mod = event.metaKey || event.ctrlKey;
      if (mod) {
        const key = event.key.toLowerCase();
        if (key === "c" || key === "x" || key === "v") {
          if (isTypingTarget) return;
          if (key === "c") {
            runModKeyCopy(event);
            return;
          }
          if (key === "x") {
            runModKeyCut(event);
            return;
          }
          runModKeyPaste(event);
          return;
        }
      }

      runDeleteOrBackspace(event);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    buildPastedEditorNode,
    handleDeleteEdge,
    handleDeleteNode,
    nodeTypeConfig,
    nodes,
    selectedEdgeId,
    selectedNode
  ]);

  const handleAutoLayout = () => {
    if (nodes.length === 0) return;

    // DSL import 시 사용하던 레이아웃 로직을 그대로 재사용:
    // - 최상위 노드는 레이어 기반 좌→우 DAG
    // - Repeat 컨테이너 안은 세로 / Parallel 브랜치 안은 가로 배치
    const nextNodes = applyImportedLayout(nodes, validEdges, nodeTypeConfig);

    setNodes((prev) => {
      // 포지션이 실제로 변경된 경우에만 unsaved 플래그 설정
      const changed =
        prev.length !== nextNodes.length ||
        prev.some((node, index) => {
          const next = nextNodes[index];
          return (
            node.id !== next.id ||
            node.position.x !== next.position.x ||
            node.position.y !== next.position.y
          );
        });

      if (changed) {
        setHasUnsavedChanges(true);
      }
      return nextNodes;
    });
  };

  const showEdgeError = useCallback((message: string) => {
    setEdgeError(message);
    if (edgeErrorTimerRef.current) {
      window.clearTimeout(edgeErrorTimerRef.current);
    }
    edgeErrorTimerRef.current = window.setTimeout(() => {
      setEdgeError(null);
      edgeErrorTimerRef.current = null;
    }, 2400);
  }, []);

  const isEdgeAllowed = useCallback(
    (fromNode: EditorNode, toNode: EditorNode) => {
      const fromKey = getNodeContainerKey(fromNode, containerTypeById);
      const toKey = getNodeContainerKey(toNode, containerTypeById);
      if (!fromKey && !toKey) return true;
      return fromKey !== null && fromKey === toKey;
    },
    [containerTypeById]
  );

  const connectNodes = useCallback(
    (fromNodeId: string, fromPort: string, toNodeId: string) => {
      if (fromNodeId === toNodeId) return;
      const fromNode = nodeMap.get(fromNodeId);
      const toNode = nodeMap.get(toNodeId);
      if (!fromNode || !toNode) return;
      const toConfig = nodeTypeConfig[toNode.kind];
      if (toConfig?.inputEnabled === false) return;
      if (outgoingEdges.has(`${fromNodeId}:${fromPort}`)) return;
      if (!isEdgeAllowed(fromNode, toNode)) {
        showEdgeError("Edges cannot cross container boundaries.");
        return;
      }

      const retryScopeError =
        "Branch/Parallel/Merge/Retry nodes are not allowed inside Retry scopes (v0).";
      if (
        fromNode.kind === "flow_control.retry" &&
        (fromPort === "main" || fromPort === "failure")
      ) {
        if (isForbiddenInRetryScope(toNode.kind)) {
          showEdgeError(retryScopeError);
          return;
        }
        if (toNode.retryOwnerId && toNode.retryOwnerId !== fromNodeId) {
          showEdgeError("Target node already belongs to another Retry scope.");
          return;
        }
        const scopeType = fromPort === "main" ? "main" : "failure";
        const endKey = scopeType === "main" ? "mainScopeEndId" : "failureScopeEndId";
        setNodes((prev) => {
          let nextNodes = prev.map((n) => {
            if (n.id === fromNodeId) {
              const currentEnd = n.params[endKey];
              if (!currentEnd) {
                return {
                  ...n,
                  params: {
                    ...n.params,
                    [endKey]: toNodeId
                  }
                };
              }
            }
            return n;
          });

          // 이 시점에는 아직 setEdges가 적용되기 전이므로,
          // 새로 추가될 edge를 포함한 가상의 edge 리스트로 스코프를 재계산한다.
          const virtualEdges: EditorEdge[] = [
            ...edges,
            {
              id: "__virtual_retry_scope_edge__",
              from: fromNodeId,
              fromPort,
              to: toNodeId
            }
          ];
          nextNodes = recomputeRetryScopeMembership(nextNodes, fromNodeId, scopeType, virtualEdges);
          return nextNodes;
        });
      } else if (
        fromNode.retryOwnerId &&
        !fromNode.isRetryScopeEnd &&
        (fromNode.retryScopeType === "main" || fromNode.retryScopeType === "failure")
      ) {
        // 스코프 끝이 아닌 노드에서 연결 → 스코프 확장 (End retry scope 해제 후 다음 노드를 스코프에 포함)
        if (isForbiddenInRetryScope(toNode.kind)) {
          showEdgeError(retryScopeError);
          return;
        }
        if (toNode.retryOwnerId && toNode.retryOwnerId !== fromNode.retryOwnerId) {
          showEdgeError("Target node already belongs to another Retry scope.");
          return;
        }
        const ownerId = fromNode.retryOwnerId;
        const scopeType = fromNode.retryScopeType;
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id === toNodeId)
              return {
                ...n,
                retryOwnerId: ownerId,
                retryScopeType: scopeType,
                isRetryScopeEnd: true
              };
            return n;
          })
        );
      }
      // 스코프 끝 노드(isRetryScopeEnd === true)에서 나간 연결은 스코프 확장 없음 → toNode는 Retry flow 다음 순서 노드

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
      setHasUnsavedChanges(true);
    },
    [edges, isEdgeAllowed, nodeMap, nodeTypeConfig, outgoingEdges, showEdgeError]
  );

  const handleStartConnect = (nodeId: string, portKey: string) => {
    if (outgoingEdges.has(`${nodeId}:${portKey}`)) {
      setConnectingFrom(null);
      return;
    }
    setEditingNodeId(null);
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
    setEditingNodeId(null);
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
    if (!nodeTypes.includes(rawKind as NodeKind)) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) return;

    const { x: dropX, y: dropY } = canvasPointToNewNodeTopLeft(
      point,
      NODE_METRICS.width,
      NODE_METRICS.collapsedHeight
    );
    createNode(rawKind as NodeKind, { x: dropX, y: dropY });
    setHasUnsavedChanges(true);
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-card]")) return;
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setConnectingFrom(null);
    setEditingNodeId(null);
  };

  const edgesToRender = useMemo(() => {
    return validEdges.filter((edge) => {
      if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) {
        return false;
      }
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      if (!fromNode || !toNode) return false;
      const config = nodeTypeConfig[fromNode.kind];
      if (!config) return false;
      const outputs = config.outputs;
      return outputs.some((output) => output.key === edge.fromPort);
    });
  }, [nodeMap, nodeTypeConfig, validEdges, visibleNodeIds]);

  const containerFramesToRender = useMemo(() => {
    return nodes
      .filter((node) => isContainerNode(node) && node.isExpanded)
      .map((node) => {
        const layout = getContainerFrameLayout(node, nodeTypeConfig);
        if (!layout) return null;
        const empty = containerEmptyBranches.get(node.id);
        const regions = layout.regions.map((region) => ({
          ...region,
          isEmpty: empty ? empty.has(region.index) : false
        }));
        return {
          node,
          label: getContainerHeaderLabel(node, regions.length),
          frame: layout.frame,
          headerHeight: layout.headerHeight,
          regions,
          highlight: Boolean(empty && empty.size > 0)
        };
      })
      .filter(Boolean) as Array<{
      node: EditorNode;
      label: string;
      frame: { x: number; y: number; width: number; height: number };
      headerHeight: number;
      regions: ContainerFrameRegion[];
      highlight: boolean;
    }>;
  }, [containerEmptyBranches, nodeTypeConfig, nodes]);

  const connectingLabel = useMemo(() => {
    if (!connectingFrom) return null;
    const node = nodeMap.get(connectingFrom.nodeId);
    if (!node) return null;
    const config = nodeTypeConfig[node.kind];
    if (!config) return `${node.name} - ${connectingFrom.portKey}`;
    const output = config.outputs.find((item) => item.key === connectingFrom.portKey);
    return `${node.name} - ${output?.label ?? connectingFrom.portKey}`;
  }, [connectingFrom, nodeMap, nodeTypeConfig]);

  // 에디터 페이지에서 unsaved 변경 여부를 전역(window)에 노출
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __editorHasUnsavedChanges?: boolean }).__editorHasUnsavedChanges =
      hasUnsavedChanges;
    return () => {
      if (typeof window === "undefined") return;
      (window as unknown as { __editorHasUnsavedChanges?: boolean }).__editorHasUnsavedChanges =
        false;
    };
  }, [hasUnsavedChanges]);

  // 새로고침/탭 닫기 등 브라우저 단위 이동 시 경고
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!publishToast) return;
    const id = window.setTimeout(() => setPublishToast(false), 3000);
    return () => window.clearTimeout(id);
  }, [publishToast]);

  useEffect(() => {
    if (!failureFlowToastMessage) return;
    const id = window.setTimeout(() => setFailureFlowToastMessage(null), 3000);
    return () => window.clearTimeout(id);
  }, [failureFlowToastMessage]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-6" data-testid="editor-page">
      <input
        ref={importFileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden
        onChange={handleImportFileSelected}
      />
      {importOverwriteConfirmOpen && (
        <ImportOverwriteDialog
          onBackdropClick={cancelImportOverwrite}
          onCancelClick={cancelImportOverwrite}
          onConfirmClick={confirmImportOverwrite}
        />
      )}
      {importValidationFailOpen && (
        <ImportValidationFailDialog
          messages={importFailMessages}
          onBackdropClick={() => setImportValidationFailOpen(false)}
          onOkClick={() => setImportValidationFailOpen(false)}
        />
      )}
      {showPublishConfirm && (
        <PublishConfirmDialog
          onBackdropClick={() => setShowPublishConfirm(false)}
          onCancelClick={() => setShowPublishConfirm(false)}
          onPublishClick={handleConfirmPublish}
          isPublishPending={publishMutation.isPending}
        />
      )}

      <EditorNoticeToasts
        publishToastVisible={publishToast}
        failureFlowToastMessage={failureFlowToastMessage}
      />

      <div className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">Workflow Editor</p>
          <div className="flex items-center gap-2">
            {isEditingWorkflowName ? (
              <input
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value)}
                onBlur={async () => {
                  setIsEditingWorkflowName(false);
                  if (workflows) {
                    const currentWorkflow = workflows.find((w) => w.workflowId === workflowId);
                    if (
                      currentWorkflow &&
                      workflowName.trim() &&
                      workflowName !== currentWorkflow.name
                    ) {
                      try {
                        const updated = await workflowsApi.update(currentWorkflow.workflowId, {
                          name: workflowName.trim()
                        });
                        queryClient.setQueryData<typeof workflows>(["workflows"], (old) =>
                          old?.map((w) =>
                            w.workflowId === workflowId ? { ...w, name: updated.name } : w
                          )
                        );
                        setOriginalWorkflowName(updated.name);
                      } catch (error) {
                        console.error("Failed to update workflow name", error);
                        // 실패 시 로컬 이름을 원래 값으로 롤백
                        setWorkflowName(currentWorkflow.name);
                      }
                    } else if (!workflowName.trim()) {
                      // 빈 이름이면 원래 값으로 복원
                      setWorkflowName(originalWorkflowName);
                    }
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setWorkflowName(originalWorkflowName);
                    setIsEditingWorkflowName(false);
                  }
                }}
                autoFocus
                className="text-xl font-semibold rounded border border-slate-300 bg-white px-2 py-1 focus:border-slate-500 focus:outline-none min-w-[200px]"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="flex items-center gap-2 group">
                <h1
                  className="text-xl font-semibold cursor-pointer hover:text-slate-700 select-none"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsEditingWorkflowName(true);
                  }}
                  title="더블클릭하여 이름 변경"
                >
                  {isLoadingWorkflows
                    ? "Loading..."
                    : workflowName || activeDraft?.workflowId || "Untitled Workflow"}
                </h1>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditingWorkflowName(true);
                  }}
                  className="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
                  title="이름 변경"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-4 h-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                    />
                  </svg>
                </button>
              </div>
            )}
            <StatusBadge status="DRAFT" />
            {workflows &&
              (() => {
                const current = workflows.find((w) => w.workflowId === workflowId);
                const ver = current?.latestVersion?.versionNumber;
                return ver ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    Latest: v{ver}
                  </span>
                ) : null;
              })()}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" onClick={handleAutoLayout}>
            Auto Layout
          </Button>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowWorkflowMenu((prev) => !prev)}
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border-2 border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200"
              aria-label="Workflow menu"
              data-testid="workflow-menu-button"
              title="Workflow menu (Save, Publish, Failure Handling)"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                <circle cx="10" cy="5" r="2" />
                <circle cx="10" cy="10" r="2" />
                <circle cx="10" cy="15" r="2" />
              </svg>
            </button>
            {showWorkflowMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden
                  onClick={() => setShowWorkflowMenu(false)}
                />
                <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-slate-200 bg-white py-2 shadow-lg">
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Workflow
                  </p>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    data-testid="workflow-menu-save"
                    onClick={() => {
                      setShowWorkflowMenu(false);
                      handleSave();
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                    data-testid="workflow-menu-publish"
                    onClick={() => {
                      if (hasErrors) return;
                      setShowWorkflowMenu(false);
                      handlePublish();
                    }}
                    disabled={hasErrors}
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                    title={skillsetsResponse ? undefined : "Skill catalog is still loading."}
                    disabled={!skillsetsResponse}
                    onClick={() => {
                      if (!skillsetsResponse) return;
                      setShowWorkflowMenu(false);
                      importFileInputRef.current?.click();
                    }}
                  >
                    Import…
                  </button>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={handleEditorExport}
                  >
                    Export…
                  </button>
                  <div className="mt-1 border-t border-slate-100 pt-1">
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setFailureGraph((prev) => {
                          const nextEnabled = !prev.enabled;
                          if (!nextEnabled) {
                            preservedOnFailureDslRef.current = null;
                          }
                          return {
                            ...prev,
                            enabled: nextEnabled,
                            drawerOpen: prev.enabled ? false : prev.drawerOpen
                          };
                        });
                      }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={failureGraph.enabled}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-slate-700"
                      />
                      <span>Failure Handling</span>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full cursor-pointer items-center px-6 py-1.5 text-left text-sm",
                        failureGraph.enabled
                          ? "text-slate-700 hover:bg-slate-50"
                          : "cursor-not-allowed text-slate-300"
                      )}
                      onClick={() => {
                        if (!failureGraph.enabled) return;
                        setFailureGraph((prev) => ({ ...prev, drawerOpen: true }));
                        setShowWorkflowMenu(false);
                      }}
                      disabled={!failureGraph.enabled}
                    >
                      Edit Flow
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {failureGraph.enabled && !failureGraph.drawerOpen && (
          <button
            type="button"
            className="absolute right-0 top-1/2 z-10 flex h-10 w-6 -translate-y-1/2 items-center justify-center rounded-l-md border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-600 shadow hover:bg-slate-200 hover:text-slate-700"
            onClick={() => setFailureGraph((prev) => ({ ...prev, drawerOpen: true }))}
            aria-label="Open Failure Handling Flow"
          >
            &lt;
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowPalette((prev) => !prev)}
          className="cursor-pointer absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg"
        >
          +
        </button>
        {showPalette && (
          <EditorPalette
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            nodeTypesByCategory={nodeTypesByCategory}
            nodeTypeConfig={nodeTypeConfig}
            onNodeKindDragStart={(event, kind) => {
              event.dataTransfer.setData("application/x-node-kind", kind);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onNodeKindClick={(kind) => createNode(kind)}
          />
        )}

        <Card className="flex min-h-0 min-w-0 flex-1 flex-col border-dashed">
          <div
            ref={containerRef}
            className="relative min-h-[560px] w-full min-w-0 flex-1 overflow-hidden rounded-md bg-slate-50"
          >
            <div
              ref={scrollRef}
              className="h-full w-full min-w-0 min-h-0 overflow-x-auto overflow-y-auto"
            >
              <div
                className="relative min-w-full min-h-full"
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
                  {containerFramesToRender.map((frame) => (
                    <ContainerFrame
                      key={frame.node.id}
                      id={frame.node.id}
                      label={frame.label}
                      position={{ x: frame.frame.x, y: frame.frame.y }}
                      size={{ width: frame.frame.width, height: frame.frame.height }}
                      headerHeight={frame.headerHeight}
                      regions={frame.regions}
                      highlight={frame.highlight}
                      onResizeStart={(handle, event) =>
                        handleContainerResizeStart(frame.node.id, handle, event)
                      }
                    />
                  ))}

                  {visibleNodes.map((node) => {
                    const config = nodeTypeConfig[node.kind];
                    if (!config) return null;
                    const outputs =
                      node.kind === "flow_control.retry" && node.params.onFailureEnabled === "false"
                        ? config.outputs.filter((o) => o.key !== "failure")
                        : config.outputs;
                    const outputStates = outputs.map((output) => ({
                      key: output.key,
                      label: output.label,
                      isConnected: outgoingEdges.has(`${node.id}:${output.key}`),
                      isActive:
                        connectingFrom?.nodeId === node.id && connectingFrom.portKey === output.key
                    }));
                    const skillset = node.kind.startsWith("skill.")
                      ? skillsetMap.get(node.kind)
                      : undefined;
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
                          nodeTypeConfig={nodeTypeConfig}
                          skillset={skillset}
                          nodes={nodes}
                          edges={edges}
                          stateNameMap={stateNameMap}
                          skillsetMap={skillsetMap}
                          warningLabel={containerWarningLabels.get(node.id) ?? null}
                          startEndBadge={startEndBadges.get(node.id) ?? null}
                          effectiveHeight={effectiveNodeHeightMap.get(node.id)}
                          onSelect={() => {
                            setSelectedNode(node.id);
                            setSelectedEdgeId(null);
                            setEditingNodeId((prev) => (prev === node.id ? prev : null));
                          }}
                          onToggleExpand={() => handleToggleExpand(node.id)}
                          onDragStart={(event) => {
                            const point = getCanvasPoint(event.clientX, event.clientY);
                            if (!point) return;
                            const offsetX = point.x - node.position.x;
                            const offsetY = point.y - node.position.y;
                            setSelectedNode(node.id);
                            setSelectedEdgeId(null);
                            setEditingNodeId(null);
                            setConnectingFrom(null);
                            setDragState({
                              nodeId: node.id,
                              offsetX,
                              offsetY,
                              height:
                                effectiveNodeHeightMap.get(node.id) ??
                                getNodeHeight(node, nodeTypeConfig)
                            });
                          }}
                          onStartConnect={(portKey) => handleStartConnect(node.id, portKey)}
                          onCompleteConnect={() => handleCompleteConnect(node.id)}
                          onParamChange={(key, value) => handleParamChange(node.id, key, value)}
                          onConditionExpressionFieldChange={(expressionId, field, value) =>
                            handleConditionExpressionFieldChange(
                              node.id,
                              expressionId,
                              field,
                              value
                            )
                          }
                          onAddConditionExpression={(operator) =>
                            handleAddConditionExpression(node.id, operator)
                          }
                          onRemoveConditionExpression={(expressionId) =>
                            handleRemoveConditionExpression(node.id, expressionId)
                          }
                          onVariableRowChange={(rowId, field, value) =>
                            handleVariableRowChange(node.id, rowId, field, value)
                          }
                          onAddVariableRow={(valueType) => handleAddVariableRow(node.id, valueType)}
                          onRemoveVariableRow={(rowId) => handleRemoveVariableRow(node.id, rowId)}
                          onNameChange={(value) => handleNameChange(node.id, value)}
                          isEditingName={editingNodeId === node.id}
                          onStartEditName={() => handleStartEditName(node.id)}
                          onFinishEditName={handleFinishEditName}
                          onOutputDragStart={(event, portKey) =>
                            handleOutputDragStart(event, node.id, portKey)
                          }
                          onOutputDragEnd={handleOutputDragEnd}
                          onInputDragOver={handleInputDragOver}
                          onInputDrop={(event) => handleInputDrop(event, node.id)}
                          onRetryScopeEndChange={
                            node.retryScopeType
                              ? (checked) => handleRetryScopeEndChange(node.id, checked)
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}

                  <svg
                    className="absolute inset-0 z-10 pointer-events-none"
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
                      <marker
                        id="arrow-true"
                        markerWidth="10"
                        markerHeight="10"
                        refX="8"
                        refY="5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                      </marker>
                      <marker
                        id="arrow-false"
                        markerWidth="10"
                        markerHeight="10"
                        refX="8"
                        refY="5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                      </marker>
                    </defs>
                    {edgesToRender.map((edge) => {
                      const fromNode = nodeMap.get(edge.from);
                      const toNode = nodeMap.get(edge.to);
                      if (!fromNode || !toNode) return null;
                      const fromConfig = nodeTypeConfig[fromNode.kind];
                      if (!fromConfig) return null;
                      const outputs =
                        fromNode.kind === "flow_control.retry" &&
                        fromNode.params.onFailureEnabled === "false"
                          ? fromConfig.outputs.filter((o) => o.key !== "failure")
                          : fromConfig.outputs;
                      const outputIndex = outputs.findIndex(
                        (output) => output.key === edge.fromPort
                      );
                      if (outputIndex < 0) return null;
                      const toNodeHeight =
                        effectiveNodeHeightMap.get(toNode.id) ??
                        getNodeHeight(toNode, nodeTypeConfig);
                      const fromNodeHeight =
                        effectiveNodeHeightMap.get(fromNode.id) ??
                        getNodeHeight(fromNode, nodeTypeConfig);
                      const outputOffsets = getPortOffsets(fromNodeHeight, outputs.length);
                      const start = {
                        x: fromNode.position.x + NODE_METRICS.width,
                        y: fromNode.position.y + outputOffsets[outputIndex]
                      };
                      const end = {
                        x: toNode.position.x - 12,
                        y: toNode.position.y + toNodeHeight / 2
                      };
                      const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
                      const controlX1 = start.x + (end.x >= start.x ? curve : -curve);
                      const controlX2 = end.x + (end.x >= start.x ? -curve : curve);
                      const path = `M ${start.x} ${start.y} C ${controlX1} ${start.y}, ${controlX2} ${end.y}, ${end.x} ${end.y}`;
                      const isConditionNode = fromNode.kind === "flow_control.condition";
                      const isTrueEdge = edge.fromPort === "true";
                      const isFalseEdge = edge.fromPort === "false";
                      let strokeColor = selectedEdgeId === edge.id ? "#0f172a" : "#94a3b8";
                      let markerId = "arrow";

                      if (isConditionNode && isTrueEdge) {
                        strokeColor = selectedEdgeId === edge.id ? "#059669" : "#10b981";
                        markerId = "arrow-true";
                      } else if (isConditionNode && isFalseEdge) {
                        strokeColor = selectedEdgeId === edge.id ? "#dc2626" : "#ef4444";
                        markerId = "arrow-false";
                      } else if (
                        fromNode.kind === "flow_control.retry" &&
                        edge.fromPort === "failure"
                      ) {
                        strokeColor = selectedEdgeId === edge.id ? "#dc2626" : "#ef4444";
                        markerId = "arrow-false";
                      }

                      return (
                        <path
                          key={edge.id}
                          d={path}
                          stroke={strokeColor}
                          strokeWidth={selectedEdgeId === edge.id ? "2.5" : "2"}
                          fill="none"
                          markerEnd={`url(#${markerId})`}
                          className="cursor-pointer"
                          style={{ pointerEvents: "stroke" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedEdgeId(edge.id);
                            setSelectedNode(null);
                            setEditingNodeId(null);
                          }}
                        />
                      );
                    })}
                  </svg>

                  {nodes.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-sm text-slate-400">
                      <p>Drag a node here or click in the palette.</p>
                      <p className="text-xs">Use output ports to connect nodes with arrows.</p>
                    </div>
                  )}

                  {edgeError && (
                    <div className="absolute bottom-12 left-4 rounded-full bg-rose-600 px-3 py-1 text-[10px] font-semibold text-white shadow">
                      {edgeError}
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
            <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] text-slate-600 shadow">
              <button
                type="button"
                className="cursor-pointer rounded px-1 text-slate-600 hover:text-slate-900"
                onClick={() =>
                  setZoom((prev) =>
                    clamp(prev - ZOOM_LIMITS.step, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
                  )
                }
              >
                -
              </button>
              <span className="min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="cursor-pointer rounded px-1 text-slate-600 hover:text-slate-900"
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
                className="cursor-pointer rounded px-1 text-slate-500 hover:text-slate-900"
                onClick={() => setZoom(1)}
              >
                Reset
              </button>
            </div>
          </div>
        </Card>
        {/* Failure Handling 드로어: enabled이고 drawerOpen일 때만 표시 */}
        {failureGraph.enabled && failureGraph.drawerOpen && (
          <div className="absolute inset-0 flex justify-end pointer-events-none z-10">
            <div
              className="relative pointer-events-auto flex h-full flex-col border-l border-slate-200 bg-white shadow-xl"
              style={{ width: "33%" }}
            >
              {/* Failure drawer 닫기 버튼: 메인 캔버스 < 버튼과 동일한 vertical center 기준 */}
              <button
                type="button"
                className="absolute -left-4 top-1/2 z-30 flex h-10 w-6 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-r-md border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-600 shadow hover:bg-slate-200 hover:text-slate-700"
                onClick={() => setFailureGraph((prev) => ({ ...prev, drawerOpen: false }))}
                aria-label="Close Failure Handling Flow"
              >
                &gt;
              </button>
              <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Failure Handling Flow</h2>
                  <p className="text-xs text-slate-500">Runs when the workflow fails</p>
                </div>
                <button
                  type="button"
                  className="cursor-pointer rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setFailureGraph((prev) => ({ ...prev, drawerOpen: false }))}
                  aria-label="Close"
                >
                  <span className="text-sm font-bold">✕</span>
                </button>
              </div>
              <div className="relative flex-1 min-h-0 overflow-auto bg-slate-50">
                {/* 전체 Failure drawer 기준 안내 텍스트 (엔트리만 있을 때) */}
                {failureGraph.nodes.length <= 1 && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-xs text-slate-500 z-20">
                    <p className="font-medium">
                      Define what should happen when the workflow fails.
                    </p>
                    <p className="mt-1">
                      Drag nodes from the palette into this area to build your failure handling
                      flow.
                    </p>
                  </div>
                )}
                <div className="relative mx-4 my-4">
                  <div
                    className="relative rounded-md bg-slate-100"
                    data-failure-canvas
                    style={{
                      width: FAILURE_CANVAS_BASE.width,
                      height: FAILURE_CANVAS_BASE.height,
                      minWidth: FAILURE_CANVAS_BASE.width,
                      minHeight: FAILURE_CANVAS_BASE.height
                    }}
                    onMouseDown={(e) => {
                      // Failure 캔버스 배경 클릭 시 메인 선택만 해제 (노드 카드 안은 무시)
                      if (e.button !== 0) return;
                      const t = e.target as HTMLElement;
                      if (t.closest("[data-node-card]")) return;
                      e.stopPropagation();
                      setSelectedNode(null);
                      setSelectedEdgeId(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const kind = e.dataTransfer.getData("application/x-node-kind") as
                        | NodeKind
                        | "";
                      if (!kind || kind === "system.on_failure_entry") return;
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      const { x, y } = failureCanvasLocalDropPosition(
                        rect,
                        e.clientX,
                        e.clientY,
                        NODE_METRICS.width,
                        24
                      );
                      addFailureNode(kind, {
                        x: Math.max(0, x),
                        y: Math.max(0, y)
                      });
                    }}
                  >
                    {failureGraph.nodes.map((node) => {
                      const config = nodeTypeConfig[node.kind];
                      if (!config) return null;
                      const isEntry = node.id === failureGraph.entryNodeId;
                      const failureOutgoing = new Map(
                        failureGraph.edges
                          .filter((e) => e.from === node.id)
                          .map((e) => [e.fromPort, e])
                      );
                      const outputStates = config.outputs.map((output) => ({
                        key: output.key,
                        label: output.label,
                        isConnected: failureOutgoing.has(output.key),
                        isActive:
                          failureConnectingFrom?.nodeId === node.id &&
                          failureConnectingFrom?.portKey === output.key
                      }));
                      const skillset = node.kind.startsWith("skill.")
                        ? skillsetMap.get(node.kind)
                        : undefined;
                      return (
                        <div
                          key={node.id}
                          className="absolute"
                          style={{
                            left: node.position.x,
                            top: node.position.y
                          }}
                        >
                          <NodeCard
                            node={node}
                            config={config}
                            isSelected={selectedNode === node.id}
                            inputConnected={failureGraph.edges.some((e) => e.to === node.id)}
                            outputs={outputStates}
                            nodeTypeConfig={nodeTypeConfig}
                            skillset={skillset}
                            nodes={failureGraph.nodes}
                            edges={failureGraph.edges}
                            stateNameMap={new Map()}
                            skillsetMap={skillsetMap}
                            portLayout="vertical"
                            onSelect={() => {
                              setSelectedNode(node.id);
                              setSelectedEdgeId(null);
                            }}
                            onToggleExpand={() => handleFailureToggleExpand(node.id)}
                            onDragStart={(ev) => {
                              if (isEntry) return;
                              ev.preventDefault();
                              ev.stopPropagation();
                              const target = ev.currentTarget as HTMLElement;
                              const parent = target.closest(
                                "[data-failure-canvas]"
                              ) as HTMLElement | null;
                              if (!parent) return;
                              const targetRect = target.getBoundingClientRect();
                              const parentRect = parent.getBoundingClientRect();
                              const offsetX = ev.clientX - targetRect.left;
                              const offsetY = ev.clientY - targetRect.top;
                              const onMove = (e: PointerEvent) => {
                                const { x: nx, y: ny } = parentLocalPositionFromPointer(
                                  parentRect,
                                  e.clientX,
                                  e.clientY,
                                  offsetX,
                                  offsetY
                                );
                                setFailureGraph((prev) => ({
                                  ...prev,
                                  nodes: prev.nodes.map((n) =>
                                    n.id === node.id
                                      ? {
                                          ...n,
                                          position: {
                                            x: Math.max(
                                              0,
                                              Math.min(
                                                FAILURE_CANVAS_BASE.width - NODE_METRICS.width,
                                                nx
                                              )
                                            ),
                                            y: Math.max(
                                              0,
                                              Math.min(
                                                FAILURE_CANVAS_BASE.height -
                                                  getNodeHeight(n, nodeTypeConfig),
                                                ny
                                              )
                                            )
                                          }
                                        }
                                      : n
                                  )
                                }));
                              };
                              const onUp = () => {
                                window.removeEventListener("pointermove", onMove);
                                window.removeEventListener("pointerup", onUp);
                              };
                              window.addEventListener("pointermove", onMove);
                              window.addEventListener("pointerup", onUp);
                            }}
                            onStartConnect={(portKey) =>
                              handleFailureStartConnect(node.id, portKey)
                            }
                            onCompleteConnect={() => handleFailureInputDrop(node.id)}
                            onParamChange={(key, value) =>
                              handleFailureParamChange(node.id, key, value)
                            }
                            onConditionExpressionFieldChange={(expressionId, field, value) =>
                              handleFailureConditionExpressionFieldChange(
                                node.id,
                                expressionId,
                                field,
                                value
                              )
                            }
                            onAddConditionExpression={(operator) =>
                              handleFailureAddConditionExpression(node.id, operator)
                            }
                            onRemoveConditionExpression={(expressionId) =>
                              handleFailureRemoveConditionExpression(node.id, expressionId)
                            }
                            onVariableRowChange={(rowId, field, value) =>
                              handleFailureVariableRowChange(node.id, rowId, field, value)
                            }
                            onAddVariableRow={(valueType) =>
                              handleFailureAddVariableRow(node.id, valueType)
                            }
                            onRemoveVariableRow={(rowId) =>
                              handleFailureRemoveVariableRow(node.id, rowId)
                            }
                            onNameChange={(value) => handleFailureNameChange(node.id, value)}
                            isEditingName={editingNodeId === node.id}
                            onStartEditName={() => handleStartEditName(node.id)}
                            onFinishEditName={handleFinishEditName}
                            onOutputDragStart={() => {}}
                            onOutputDragEnd={() => {}}
                            onInputDragOver={() => {}}
                            onInputDrop={() => handleFailureInputDrop(node.id)}
                            onRetryScopeEndChange={
                              node.retryScopeType
                                ? (checked) => handleFailureRetryScopeEndChange(node.id, checked)
                                : undefined
                            }
                          />
                        </div>
                      );
                    })}
                    {failureGraph.edges.length > 0 && (
                      <svg
                        className="absolute inset-0 pointer-events-none"
                        width={FAILURE_CANVAS_BASE.width}
                        height={FAILURE_CANVAS_BASE.height}
                        viewBox={`0 0 ${FAILURE_CANVAS_BASE.width} ${FAILURE_CANVAS_BASE.height}`}
                      >
                        <defs>
                          <marker
                            id="failure-arrow"
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
                        {failureGraph.edges.map((edge) => {
                          const fromNode = failureGraph.nodes.find((n) => n.id === edge.from);
                          const toNode = failureGraph.nodes.find((n) => n.id === edge.to);
                          if (!fromNode || !toNode) return null;
                          const configFrom = nodeTypeConfig[fromNode.kind];
                          const outputs = configFrom?.outputs ?? [];
                          const outIdx = outputs.findIndex((o) => o.key === edge.fromPort);
                          const fromH = getNodeHeight(fromNode, nodeTypeConfig);
                          const outXOffsets = getPortOffsets(NODE_METRICS.width, outputs.length);
                          const start = {
                            x:
                              fromNode.position.x +
                              (outIdx >= 0 ? outXOffsets[outIdx] : NODE_METRICS.width / 2),
                            y: fromNode.position.y + fromH
                          };
                          const end = {
                            x: toNode.position.x + NODE_METRICS.width / 2,
                            y: toNode.position.y
                          };
                          const curve = 40;
                          const path = `M ${start.x} ${start.y} C ${start.x} ${
                            start.y + curve
                          }, ${end.x} ${end.y - curve}, ${end.x} ${end.y}`;
                          return (
                            <path
                              key={edge.id}
                              d={path}
                              stroke="#94a3b8"
                              strokeWidth="2"
                              fill="none"
                              markerEnd="url(#failure-arrow)"
                            />
                          );
                        })}
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {hasErrors && (
          <div className="fixed bottom-6 right-6 z-20">
            <button
              type="button"
              className="cursor-pointer flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
              onClick={() => setShowValidation((prev) => !prev)}
            >
              {allValidationErrors.length} Validation Errors
            </button>
            {showValidation && (
              <div className="mt-3 w-72 rounded-lg border border-red-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
                <p className="font-semibold text-red-600">Errors</p>
                <ul className="mt-2 space-y-2">
                  {allValidationErrors.map((error: ValidationError, index) => (
                    <li key={`${error.id}-${index}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedNode(error.nodeId ?? null)}
                        className="cursor-pointer text-left text-slate-700 hover:text-slate-900"
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
    </div>
  );
}
