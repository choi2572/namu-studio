/** workflow-agent HTTP API — workflow-agent/docs/spec.md */

export type WorkflowAgentStatusResponse = {
  alive: boolean;
  active_model: string;
  model_loaded: boolean;
  skills_ready: boolean;
  skills_hash: string;
  /** 런타임 설정 기준 활성화 가능한 모델 id (정렬됨) */
  supported_models: string[];
};

/** POST /workflow-agent/skills/sync — skill catalog row (parameters → inputs). */
export type WorkflowAgentSkillParameter = {
  type: string;
  description: string;
  range?: { min?: number; max?: number };
  candidates?: string[];
};

export type WorkflowAgentSkillOutput = {
  type: string;
  description: string;
};

export type WorkflowAgentSkillDefinition = {
  namespace?: string | null;
  name: string;
  version?: string | null;
  description: string;
  inputs: Record<string, WorkflowAgentSkillParameter>;
  outputs: Record<string, WorkflowAgentSkillOutput>;
};

export type WorkflowAgentSkillSyncRequest = {
  skills: WorkflowAgentSkillDefinition[];
};

export type WorkflowAgentSkillSyncResponse = {
  success: boolean;
  skills_hash: string;
  metadata: {
    skill_count: number;
    prompt_context_length: number;
  };
};

export type WorkflowAgentModelActivateRequest = {
  model: string;
};

export type WorkflowAgentModelActivateResponse = {
  success: boolean;
  active_model: string;
  already_active?: boolean;
  message?: string | null;
};

export type WorkflowAgentDraftRequest = {
  request: string;
  model?: string | null;
  system_prompt_suffix?: string | null;
};

export type WorkflowAgentDraftGuidance = {
  basic?: string | null;
  suggestion?: string | null;
};

export type WorkflowAgentDraftMetadata = {
  request_id: string;
  skills_hash: string;
};

export type WorkflowAgentDraftSuccessResponse = {
  success: true;
  model: string;
  spec: Record<string, unknown>;
  dsl: Record<string, unknown>;
  warnings: string[];
  metadata: WorkflowAgentDraftMetadata;
};

export type WorkflowAgentDraftFailureResponse = {
  success: false;
  error_code: string;
  errors: string[];
  guidance: WorkflowAgentDraftGuidance;
  last_spec: Record<string, unknown> | null;
};

export type WorkflowAgentDraftResponse =
  | WorkflowAgentDraftSuccessResponse
  | WorkflowAgentDraftFailureResponse;
