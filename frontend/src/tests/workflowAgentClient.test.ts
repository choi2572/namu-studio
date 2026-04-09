import { describe, expect, it, vi } from "vitest";

import {
  WorkflowAgentNotConfiguredError,
  createWorkflowAgentClient,
  normalizeWorkflowAgentBaseUrl,
  type WorkflowAgentDraftResponse,
  type WorkflowAgentStatusResponse
} from "@/api/workflowAgent";

describe("normalizeWorkflowAgentBaseUrl", () => {
  it("trim하고 origin만 반환한다", () => {
    expect(normalizeWorkflowAgentBaseUrl("  https://agent.example/path  ")).toBe(
      "https://agent.example"
    );
  });

  it("포트를 유지한다", () => {
    expect(normalizeWorkflowAgentBaseUrl("https://agent.example:8443")).toBe(
      "https://agent.example:8443"
    );
  });

  it("빈 값은 null", () => {
    expect(normalizeWorkflowAgentBaseUrl(undefined)).toBeNull();
    expect(normalizeWorkflowAgentBaseUrl(null)).toBeNull();
    expect(normalizeWorkflowAgentBaseUrl("")).toBeNull();
    expect(normalizeWorkflowAgentBaseUrl("   ")).toBeNull();
  });

  it("잘못된 URL은 null", () => {
    expect(normalizeWorkflowAgentBaseUrl("not-a-url")).toBeNull();
  });
});

describe("createWorkflowAgentClient", () => {
  it("baseUrl 없으면 isConfigured false이고 getStatus는 NotConfiguredError", async () => {
    const client = createWorkflowAgentClient({ baseUrl: "" });
    expect(client.isConfigured()).toBe(false);
    await expect(client.getStatus()).rejects.toThrow(WorkflowAgentNotConfiguredError);
  });

  it("GET /workflow-agent/status 를 올바른 URL로 호출하고 본문을 파싱한다", async () => {
    const payload: WorkflowAgentStatusResponse = {
      alive: true,
      active_model: "qwen",
      model_loaded: true,
      skills_ready: true,
      skills_hash: "abc",
      supported_models: ["gemma", "qwen"]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, statusText: "OK" }));
    const client = createWorkflowAgentClient({
      baseUrl: "https://wf.example",
      fetchImpl: fetchMock as typeof fetch
    });
    const out = await client.getStatus();
    expect(out).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("https://wf.example/workflow-agent/status", {
      method: "GET"
    });
  });

  it("postDraft 는 HTTP 200 + success:false 본문을 예외 없이 반환한다", async () => {
    const body: WorkflowAgentDraftResponse = {
      success: false,
      error_code: "SPEC_VALIDATION_FAILED",
      errors: ["x"],
      guidance: { basic: "b", suggestion: "s" },
      last_spec: null
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200, statusText: "OK" }));
    const client = createWorkflowAgentClient({
      baseUrl: "https://wf.example",
      fetchImpl: fetchMock as typeof fetch
    });
    const out = await client.postDraft({ request: "hello" });
    expect(out.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("https://wf.example/workflow-agent/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "hello" })
    });
  });

  it("HTTP 오류 시 의미 있는 메시지로 던진다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: { errors: ["bad"] } }), {
        status: 422,
        statusText: "Unprocessable"
      })
    );
    const client = createWorkflowAgentClient({
      baseUrl: "https://wf.example",
      fetchImpl: fetchMock as typeof fetch
    });
    await expect(client.syncSkills({ skills: [] })).rejects.toThrow(/422/);
  });
});
