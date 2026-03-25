import type { Skillset } from "@/domain/types";

function isAllowStatusExternalChangeTrue(s: Skillset): boolean {
  const ext = s as Skillset & { allowStatusExternalChange?: unknown };
  const v = s.allow_status_external_change ?? ext.allowStatusExternalChange;
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === "string" && v.toLowerCase() === "true") return true;
  return false;
}

/**
 * DSL Skill 노드 + skill-set: allow_status_external_change 가 켜진 스킬인지 판별.
 * DSL의 Skill 문자열은 namespace.name, skill.namespace.name, 또는 레거시로 name 만 올 수 있음.
 */
export function skillNodeAllowsExternalStatusChange(
  dslType: string,
  skillName: string | null,
  skillsets: Skillset[]
): boolean {
  if (!skillName?.trim()) return false;
  const t = (dslType || "").toLowerCase();
  if (t !== "skill") return false;
  const n = skillName.trim();
  return skillsets.some((s) => {
    if (!isAllowStatusExternalChangeTrue(s)) return false;
    const full = `${s.namespace}.${s.name}`;
    const kind = `skill.${s.namespace}.${s.name}`;
    return n === full || n === kind || n === s.name;
  });
}
