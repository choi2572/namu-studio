import {
  createMiddlewareApi,
  createRunsApi,
  createSkillsetsApi,
  createWorkflowsApi
} from "@/api/factory";

export const workflowsApi = createWorkflowsApi();
export const runsApi = createRunsApi();
export const skillsetsApi = createSkillsetsApi();
export const middlewareApi = createMiddlewareApi();
