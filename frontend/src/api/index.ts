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

export {
  WorkflowAgentNotConfiguredError,
  createWorkflowAgentClient,
  mapSkillsetsToWorkflowAgentSyncRequest,
  normalizeWorkflowAgentBaseUrl,
  workflowAgentApi
} from "@/api/workflowAgent";
export type {
  WorkflowAgentClient,
  WorkflowAgentDraftRequest,
  WorkflowAgentDraftResponse,
  WorkflowAgentSkillSyncRequest,
  WorkflowAgentStatusResponse
} from "@/api/workflowAgent";
