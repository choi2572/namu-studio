import { describe, expect, it } from "vitest";

import { getWorkflowAgentBarHint } from "@/features/editor/workflowAgentBarHint";

describe("getWorkflowAgentBarHint", () => {
  it("동기화 중이면 해당 문구", () => {
    expect(
      getWorkflowAgentBarHint({
        agentConfigured: true,
        syncPending: true,
        syncErrorMessage: null,
        statusError: null,
        status: undefined,
        syncSucceeded: false,
        agentReadyForDraftUi: false
      })
    ).toContain("동기화");
  });

  it("에이전트 준비 완료면 null", () => {
    expect(
      getWorkflowAgentBarHint({
        agentConfigured: true,
        syncPending: false,
        syncErrorMessage: null,
        statusError: null,
        status: {
          alive: true,
          active_model: "qwen",
          model_loaded: true,
          skills_ready: true,
          skills_hash: "x",
          supported_models: ["qwen"]
        },
        syncSucceeded: true,
        agentReadyForDraftUi: true
      })
    ).toBeNull();
  });
});
