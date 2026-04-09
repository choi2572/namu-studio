import type { Skillset } from "@/domain/types";

import type { NodeKind, NodeParamField, NodeOutputPort, NodeTypeConfig } from "./editorTypes";
import { STATIC_NODE_TYPE_CONFIG } from "./editorConstants";

/** skill 노드 kind: skill.${namespace}.${name} */
export function getSkillNodeKind(skillset: Skillset): NodeKind {
  return `skill.${skillset.namespace}.${skillset.name}` as NodeKind;
}

/** 에디터에서 표시할 타입 문자열 (namespace.name) */
export function getSkillDisplayType(skillset: Skillset): string {
  return `${skillset.namespace}.${skillset.name}`;
}

// Skillset 기반으로 노드 타입 설정 생성
function createNodeTypeConfigFromSkillset(skillset: Skillset): NodeTypeConfig {
  const skillName = skillset.name;
  const iconText = skillName
    .split(/(?=[A-Z])/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // 색상 클래스는 skill 이름의 해시 기반으로 결정 (간단한 방법)
  const colorClasses = [
    "border-blue-200 bg-blue-100 text-blue-700",
    "border-emerald-200 bg-emerald-100 text-emerald-700",
    "border-purple-200 bg-purple-100 text-purple-700",
    "border-orange-200 bg-orange-100 text-orange-700",
    "border-pink-200 bg-pink-100 text-pink-700",
    "border-indigo-200 bg-indigo-100 text-indigo-700"
  ];
  const colorIndex = skillName.length % colorClasses.length;

  const paramFields: NodeParamField[] = Object.entries(skillset.parameters).map(([key, param]) => {
    const candidates = param.candidates?.filter((c) => typeof c === "string" && c.length > 0);
    const range = param.range;
    const hasRange =
      range != null &&
      typeof range === "object" &&
      (range.min !== undefined || range.max !== undefined);
    return {
      key,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      placeholder: param.type || key,
      valueType: param.type,
      ...(hasRange ? { range: { min: range.min, max: range.max } } : {}),
      ...(candidates && candidates.length > 0 ? { candidates } : {})
    };
  });

  // Skill 노드는 transition 표현이므로 next 포트 하나만 사용
  const outputs: NodeOutputPort[] = [{ key: "next", label: "Next" }];

  return {
    label: skillName.replace(/([A-Z])/g, " $1").trim(),
    category: "skill",
    iconText,
    colorClass: colorClasses[colorIndex],
    paramFields,
    outputs
  };
}

// Skillset 배열로부터 전체 노드 타입 설정 생성
export function createNodeTypeConfigFromSkillsets(
  skillsets: Skillset[]
): Record<string, NodeTypeConfig> {
  const config: Record<string, NodeTypeConfig> = {
    ...(STATIC_NODE_TYPE_CONFIG as unknown as Record<string, NodeTypeConfig>)
  };

  skillsets.forEach((skillset) => {
    const nodeKind = getSkillNodeKind(skillset);
    config[nodeKind] = createNodeTypeConfigFromSkillset(skillset);
  });

  return config as Record<NodeKind, NodeTypeConfig>;
}
