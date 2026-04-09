import { describe, expect, it } from "vitest";

import { skillParamRangeMessage } from "@/features/editor/editorSkillParamValidation";
import type { NodeParamField } from "@/features/editor/editorTypes";

function field(partial: Partial<NodeParamField> & Pick<NodeParamField, "key">): NodeParamField {
  return {
    label: partial.key,
    placeholder: "",
    ...partial
  };
}

describe("skillParamRangeMessage", () => {
  it("빈 값과 $ 참조는 검사하지 않는다", () => {
    const f = field({
      key: "n",
      valueType: "int",
      range: { min: 1, max: 10 }
    });
    expect(skillParamRangeMessage(f, "")).toBeNull();
    expect(skillParamRangeMessage(f, "  ")).toBeNull();
    expect(skillParamRangeMessage(f, "$.Inputs.x")).toBeNull();
  });

  it("int 리터럴이 min 미만이면 메시지", () => {
    const f = field({ key: "maxTargets", valueType: "int", range: { min: 1, max: 32 } });
    expect(skillParamRangeMessage(f, "0")).toContain("≥");
  });

  it("int 리터럴이 max 초과이면 메시지", () => {
    const f = field({ key: "maxTargets", valueType: "int", range: { min: 1, max: 32 } });
    expect(skillParamRangeMessage(f, "99")).toContain("≤");
  });

  it("범위 안이면 null", () => {
    const f = field({ key: "maxTargets", valueType: "int", range: { min: 1, max: 32 } });
    expect(skillParamRangeMessage(f, "5")).toBeNull();
  });

  it("double은 소수 리터럴을 검사한다", () => {
    const f = field({ key: "threshold", valueType: "double", range: { min: 0, max: 1 } });
    expect(skillParamRangeMessage(f, "1.5")).toContain("≤");
    expect(skillParamRangeMessage(f, "0.5")).toBeNull();
  });
});
