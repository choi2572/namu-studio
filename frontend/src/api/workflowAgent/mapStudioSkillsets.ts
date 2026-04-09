import type { Skillset } from "@/domain/types";

import type { WorkflowAgentSkillDefinition, WorkflowAgentSkillSyncRequest } from "./types";

function mapOneSkillset(s: Skillset): WorkflowAgentSkillDefinition {
  const ns = s.namespace?.trim();
  const ver = s.version?.trim();
  return {
    namespace: ns || undefined,
    name: s.name.trim(),
    version: ver || undefined,
    description: s.description.trim(),
    inputs: { ...s.parameters },
    outputs: { ...s.outputs }
  };
}

/** 미들웨어 스킬셋( `parameters` ) → workflow-agent `inputs` 로 매핑 */
export function mapSkillsetsToWorkflowAgentSyncRequest(
  skill_sets: Skillset[]
): WorkflowAgentSkillSyncRequest {
  return {
    skills: skill_sets.map(mapOneSkillset)
  };
}
