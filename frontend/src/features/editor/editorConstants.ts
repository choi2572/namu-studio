import type { ContainerType, NodeCategory, NodeKind, NodeTypeConfig } from "./editorTypes";

export const CONDITION_COMPARISON_OPERATORS = ["==", "!=", ">=", "<=", ">", "<"] as const;

/** 에디터 연산자(==, != 등) → DSL JSON 연산자(Equals, NotEquals 등) */
export const EDITOR_OP_TO_DSL: Record<string, string> = {
  "==": "Equals",
  "!=": "NotEquals",
  "<": "LessThan",
  ">": "GreaterThan",
  "<=": "LessThanOrEqual",
  ">=": "GreaterThanOrEqual"
};

/** DSL JSON 연산자 → 에디터 연산자 */
export const DSL_OP_TO_EDITOR: Record<string, string> = {
  Equals: "==",
  NotEquals: "!=",
  LessThan: "<",
  GreaterThan: ">",
  LessThanOrEqual: "<=",
  GreaterThanOrEqual: ">="
};

// NODE_TYPES는 skillset에서 동적으로 생성됩니다

export const NODE_CATEGORIES: { id: NodeCategory; label: string }[] = [
  { id: "skill", label: "Skill" },
  { id: "flow_control", label: "Flow Control" },
  { id: "event", label: "Event" }
];

export const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  skill: "Skill",
  flow_control: "Flow Control",
  event: "Event"
};

// 정적 노드 타입 설정 (flow_control, event)
export const STATIC_NODE_TYPE_CONFIG: Partial<Record<NodeKind, NodeTypeConfig>> = {
  "system.on_failure_entry": {
    label: "On Workflow Failure",
    category: "flow_control",
    iconText: "WF",
    colorClass: "border-slate-300 bg-slate-100 text-slate-700",
    paramFields: [],
    outputs: [{ key: "next", label: "Next" }],
    inputEnabled: false
  },
  "flow_control.input": {
    label: "Input",
    category: "flow_control",
    iconText: "IN",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [],
    outputs: [{ key: "next", label: "Next" }],
    inputEnabled: false
  },
  "flow_control.retry": {
    label: "Retry",
    category: "flow_control",
    iconText: "RT",
    colorClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
    paramFields: [{ key: "maxAttempts", label: "MaxAttempts", placeholder: "2" }],
    outputs: [
      { key: "main", label: "Main" },
      { key: "failure", label: "On Failure" }
    ]
  },
  "flow_control.condition": {
    label: "Condition",
    category: "flow_control",
    iconText: "IF",
    colorClass: "border-amber-200 bg-amber-100 text-amber-700",
    paramFields: [],
    outputs: [
      { key: "true", label: "True" },
      { key: "false", label: "False" }
    ]
  },
  "flow_control.output": {
    label: "Output",
    category: "flow_control",
    iconText: "OUT",
    colorClass: "border-rose-200 bg-rose-100 text-rose-700",
    paramFields: [],
    outputs: []
  },
  "flow_control.repeat": {
    label: "Repeat",
    category: "flow_control",
    iconText: "RP",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [{ key: "count", label: "Repeat Count", placeholder: "3" }],
    outputs: [{ key: "next", label: "Next" }]
  },
  "flow_control.parallel": {
    label: "Parallel",
    category: "flow_control",
    iconText: "PA",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [],
    outputs: [{ key: "next", label: "Next" }]
  },
  "flow_control.vlm": {
    label: "VLM Planner",
    category: "flow_control",
    iconText: "VLM",
    colorClass: "border-violet-200 bg-violet-100 text-violet-700",
    paramFields: [],
    outputs: [{ key: "next", label: "Next" }]
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

export const NODE_METRICS = {
  width: 220,
  collapsedHeight: 86,
  expandedTopPadding: 12,
  fieldHeight: 44,
  fieldGap: 8,
  conditionButtonHeight: 28
};

/** Retry 노드 전용 색상 팔레트 (강한 대비 색상들, 순환 사용) */
export const RETRY_THEME_COLORS: Array<{
  key: string;
  border: string;
  bg: string;
  text: string;
  indicator: string;
}> = [
  {
    key: "emerald",
    border: "border-emerald-300",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    indicator: "bg-emerald-500"
  },
  {
    key: "indigo",
    border: "border-indigo-300",
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    indicator: "bg-indigo-500"
  },
  {
    key: "orange",
    border: "border-orange-300",
    bg: "bg-orange-50",
    text: "text-orange-700",
    indicator: "bg-orange-500"
  },
  {
    key: "rose",
    border: "border-rose-300",
    bg: "bg-rose-50",
    text: "text-rose-700",
    indicator: "bg-rose-500"
  }
];

/** 리본(START/END)이 있을 때 카드 상단에 추가되는 높이 (리본 h-6 + pt-6) */
export const RIBBON_EXTRA_HEIGHT = 20;

export const CONTAINER_FRAME_DEFAULTS = {
  width: 520,
  height: 320,
  branchWidth: 280
};

export const CONTAINER_FRAME_METRICS = {
  offsetY: 12,
  headerHeight: 28,
  // 컨테이너 안쪽 여백과 기본/최소 크기를 넉넉하게 조정
  padding: 20,
  minWidth: 380,
  minHeight: 240
};

export const DEFAULT_PARALLEL_BRANCHES = 2;

export const CONTAINER_LAYOUT = {
  // 컨테이너 내부에서 노드 사이 간격 및 내부 패딩
  rowGap: 32,
  padding: 20,
  columnGap: 140
};

export const CANVAS_PADDING = {
  // 오토 레이아웃 시 노드/컨테이너와 캔버스 경계 사이 여백
  x: 40,
  y: 40
};

export const CANVAS_DEFAULT = {
  width: 1000,
  height: 600
};

/** 실패 처리 캔버스 기본 크기 (상하 플로우용) */
export const FAILURE_CANVAS_BASE = { width: 800, height: 1200 };

export const ZOOM_LIMITS = {
  min: 0.6,
  max: 1.6,
  step: 0.1
};

export const EDITOR_NODE_CLIPBOARD_PREFIX = "namu-studio:editor-node:";

export const CONTAINER_TYPE_BY_KIND: Partial<Record<NodeKind, ContainerType>> = {
  "flow_control.repeat": "repeat",
  "flow_control.parallel": "parallel"
};

/** v0: Retry 스코프 안에 넣을 수 없는 노드 kind */
export const RETRY_SCOPE_FORBIDDEN_KINDS: NodeKind[] = [
  "flow_control.condition",
  "flow_control.parallel",
  "flow_control.repeat",
  "flow_control.retry"
];
