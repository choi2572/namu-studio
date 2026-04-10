import { describe, expect, it } from "vitest";

import { workflowAgentModelOptionLabel } from "@/features/editor/workflowAgentModelLabel";

describe("workflowAgentModelOptionLabel", () => {
  it("maps known short ids", () => {
    expect(workflowAgentModelOptionLabel("qwen")).toBe("Qwen");
    expect(workflowAgentModelOptionLabel("gemma")).toBe("Gemma");
  });

  it("strips path and file extension", () => {
    expect(workflowAgentModelOptionLabel("/data/models/Qwen-7B-Q4.gguf")).toBe("Qwen");
  });

  it("returns moderate-length ids as trimmed filename", () => {
    expect(workflowAgentModelOptionLabel("custom-local-id")).toBe("custom-local-id");
  });

  it("abbreviates very long labels", () => {
    const long = "a-very-long-model-identifier-name-that-needs-shortening";
    const out = workflowAgentModelOptionLabel(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("…");
  });
});
