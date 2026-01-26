import { RunsApi, WorkflowsApi } from "@/api/interfaces";
import { mockRunsApi, mockWorkflowsApi } from "@/api/mock/mockApi";
import { httpRunsApi, httpWorkflowsApi } from "@/api/http/httpApi";

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
