import { describe, expect, it, vi } from "vitest";

import { QueryClient } from "@tanstack/react-query";

import type { WorkflowAgentStatusResponse } from "@/api/workflowAgent";
import { pollWorkflowAgentUntilModelReady } from "@/features/editor/workflowAgentModelPoll";

function status(partial: Partial<WorkflowAgentStatusResponse>): WorkflowAgentStatusResponse {
  return {
    alive: true,
    active_model: "qwen",
    model_loaded: false,
    skills_ready: true,
    skills_hash: "x",
    supported_models: ["qwen"],
    ...partial
  };
}

describe("pollWorkflowAgentUntilModelReady", () => {
  it("inject한 getStatus로 준비될 때까지 폴링한다", async () => {
    const qc = new QueryClient();
    const calls = [
      status({ active_model: "qwen", model_loaded: false }),
      status({ active_model: "qwen", model_loaded: true })
    ];
    const getStatus = vi.fn().mockImplementation(() => {
      const next = calls.shift();
      if (!next) {
        return Promise.resolve(status({ active_model: "qwen", model_loaded: true }));
      }
      return Promise.resolve(next);
    });

    const out = await pollWorkflowAgentUntilModelReady("qwen", qc, "wf-1", {
      maxAttempts: 5,
      intervalMs: 0,
      getStatus
    });

    expect(out.model_loaded).toBe(true);
    expect(qc.getQueryData(["workflow-agent-status", "wf-1"])).toEqual(out);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("maxAttempts 초과 시 에러", async () => {
    const qc = new QueryClient();
    const getStatus = vi
      .fn()
      .mockResolvedValue(status({ active_model: "qwen", model_loaded: false }));

    await expect(
      pollWorkflowAgentUntilModelReady("qwen", qc, "wf-2", {
        maxAttempts: 3,
        intervalMs: 0,
        getStatus
      })
    ).rejects.toThrow(/시간이 오래/);

    expect(getStatus).toHaveBeenCalledTimes(3);
  });
});
