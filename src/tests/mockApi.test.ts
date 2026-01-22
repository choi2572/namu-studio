import { describe, expect, it } from "vitest";

import { mockRunsApi, mockWorkflowsApi } from "@/api/mock/mockApi";
import { RunStatus } from "@/domain/types";

describe("mock API", () => {
  it("returns workflows with draft and published states", async () => {
    const workflows = await mockWorkflowsApi.list();
    const states = workflows.map((item) => item.state);
    expect(states).toContain("DRAFT");
    expect(states).toContain("PUBLISHED");
  });

  it("returns validation errors for draft workflow", async () => {
    const errors = await mockWorkflowsApi.validateDraft("workflow-001");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("lists runs with failed entries", async () => {
    const runs = await mockRunsApi.list();
    expect(runs.some((run) => run.status === RunStatus.FAILED)).toBe(true);
  });

  it("filters events by seq", async () => {
    const events = await mockRunsApi.getEvents("run-099", 1);
    expect(events.every((event) => event.seq > 1)).toBe(true);
  });
});
