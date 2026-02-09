import { MiddlewareApi, RunsApi, SkillsetsApi, WorkflowsApi } from "@/api/interfaces";
import { mockMiddlewareApi, mockRunsApi, mockWorkflowsApi } from "@/api/mock/mockApi";
import { httpMiddlewareApi, httpRunsApi, httpSkillsetsApi, httpWorkflowsApi } from "@/api/http/httpApi";

const USE_MOCK_API = process.env.NEXT_PUBLIC_USE_MOCK_API === "true";

export function createWorkflowsApi(): WorkflowsApi {
  if (USE_MOCK_API) {
    if (process.env.NODE_ENV === "development") {
      console.log("[API Factory] Using mock workflows API");
    }
    return mockWorkflowsApi;
  }
  if (process.env.NODE_ENV === "development") {
    console.log("[API Factory] Using HTTP workflows API");
    console.log(`[API Factory] Base URL: ${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api"}`);
  }
  return httpWorkflowsApi;
}

export function createMiddlewareApi(): MiddlewareApi {
  if (USE_MOCK_API) {
    if (process.env.NODE_ENV === "development") {
      console.log("[API Factory] Using mock middleware API");
    }
    return mockMiddlewareApi;
  }
  if (process.env.NODE_ENV === "development") {
    console.log("[API Factory] Using HTTP middleware API");
    console.log(
      `[API Factory] Middleware Base URL: ${
        process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api"
      }`
    );
  }
  return httpMiddlewareApi;
}

export function createRunsApi(): RunsApi {
  if (USE_MOCK_API) {
    if (process.env.NODE_ENV === "development") {
      console.log("[API Factory] Using mock runs API");
    }
    return mockRunsApi;
  }
  if (process.env.NODE_ENV === "development") {
    console.log("[API Factory] Using HTTP runs API");
    console.log(`[API Factory] Base URL: ${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api"}`);
  }
  return httpRunsApi;
}

export function createSkillsetsApi(): SkillsetsApi {
  // Skillsets: frontend → backend → middleware GET /api/v1/skill-set
  if (process.env.NODE_ENV === "development") {
    console.log("[API Factory] Using HTTP skillsets API (GET /capabilities/skill-set → middleware)");
    console.log(`[API Factory] Base URL: ${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api"}`);
  }
  return httpSkillsetsApi;
}
