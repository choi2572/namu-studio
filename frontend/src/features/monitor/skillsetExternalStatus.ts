import type { Skillset } from "@/domain/types";

/** Skill DSL 키(namespace.name, skill.namespace.name) → 외부에서 상태 변경 허용 */
export function buildAllowStatusExternalChangeKeys(skillsets: Skillset[]): Set<string> {
  const keys = new Set<string>();
  for (const s of skillsets) {
    if (s.allow_status_external_change !== true) continue;
    keys.add(`${s.namespace}.${s.name}`);
    keys.add(`skill.${s.namespace}.${s.name}`);
  }
  return keys;
}

export function skillNodeAllowsExternalStatusChange(
  dslType: string,
  skillName: string | null,
  allowKeys: Set<string>
): boolean {
  if (dslType !== "Skill" || !skillName) return false;
  return allowKeys.has(skillName);
}
