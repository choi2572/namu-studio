import { describe, expect, it } from "vitest";

import type { WorkflowAgentDraftFailureResponse } from "@/api/workflowAgent";
import {
  getWorkflowAgentDraftFailureHints,
  shouldConfirmWorkflowAgentImport
} from "@/features/editor/workflowAgentDraftUi";

describe("shouldConfirmWorkflowAgentImport", () => {
  const empty = {
    hasUnsavedChanges: false,
    mainNodeCount: 0,
    mainEdgeCount: 0,
    failureGraphEnabled: false,
    failureNodeCount: 0
  };

  it("빈 편집기이고 저장 상태면 확인 불필요", () => {
    expect(shouldConfirmWorkflowAgentImport(empty)).toBe(false);
  });

  it("미저장이면 확인", () => {
    expect(shouldConfirmWorkflowAgentImport({ ...empty, hasUnsavedChanges: true })).toBe(true);
  });

  it("메인 노드가 있으면 확인", () => {
    expect(shouldConfirmWorkflowAgentImport({ ...empty, mainNodeCount: 1 })).toBe(true);
  });

  it("실패 플로우 활성 + 노드 있으면 확인", () => {
    expect(
      shouldConfirmWorkflowAgentImport({
        ...empty,
        failureGraphEnabled: true,
        failureNodeCount: 1
      })
    ).toBe(true);
  });

  it("실패 플로우만 켜고 노드 없으면 확인 생략", () => {
    expect(
      shouldConfirmWorkflowAgentImport({
        ...empty,
        failureGraphEnabled: true,
        failureNodeCount: 0
      })
    ).toBe(false);
  });
});

describe("getWorkflowAgentDraftFailureHints", () => {
  const fail = (
    partial: Partial<WorkflowAgentDraftFailureResponse>
  ): WorkflowAgentDraftFailureResponse =>
    ({
      success: false,
      error_code: "X",
      errors: [],
      guidance: {},
      last_spec: null,
      ...partial
    }) as WorkflowAgentDraftFailureResponse;

  it("suggestion을 placeholder 우선으로 쓴다", () => {
    const h = getWorkflowAgentDraftFailureHints(
      fail({
        errors: ["e1"],
        guidance: { suggestion: "try this", basic: "basic" }
      })
    );
    expect(h.placeholder).toBe("try this");
    expect(h.feedbackMessage).toContain("e1");
  });

  it("에러만 있을 때 placeholder는 첫 에러", () => {
    const h = getWorkflowAgentDraftFailureHints(fail({ errors: ["only"] }));
    expect(h.placeholder).toBe("only");
    expect(h.feedbackMessage).toBe("only");
  });
});
