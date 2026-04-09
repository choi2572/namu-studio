import { describe, expect, it } from "vitest";

import { mapSkillsetsToWorkflowAgentSyncRequest } from "@/api/workflowAgent/mapStudioSkillsets";
import type { Skillset } from "@/domain/types";

function skill(partial: Partial<Skillset> & Pick<Skillset, "name" | "description">): Skillset {
  return {
    namespace: "ns",
    version: "1",
    parameters: {},
    outputs: {},
    feedback: [],
    pre_conditions: [],
    post_effects: [],
    ...partial
  };
}

describe("mapSkillsetsToWorkflowAgentSyncRequest", () => {
  it("parameters를 inputs로 옮긴다", () => {
    const out = mapSkillsetsToWorkflowAgentSyncRequest([
      skill({
        name: "pick",
        description: "Pick object",
        parameters: {
          maxTargets: { type: "int", description: "Max targets", range: { min: 1, max: 10 } }
        },
        outputs: { ok: { type: "bool", description: "Done" } }
      })
    ]);
    expect(out.skills).toHaveLength(1);
    expect(out.skills[0].name).toBe("pick");
    expect(out.skills[0].inputs.maxTargets?.type).toBe("int");
    expect(out.skills[0].outputs.ok?.type).toBe("bool");
  });

  it("빈 namespace·version은 생략한다", () => {
    const out = mapSkillsetsToWorkflowAgentSyncRequest([
      skill({
        namespace: "   ",
        version: "",
        name: "x",
        description: "d"
      })
    ]);
    expect(out.skills[0].namespace).toBeUndefined();
    expect(out.skills[0].version).toBeUndefined();
  });
});
