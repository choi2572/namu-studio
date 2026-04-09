"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { workflowAgentApi } from "@/api";
import {
  mapSkillsetsToWorkflowAgentSyncRequest,
  type WorkflowAgentStatusResponse
} from "@/api/workflowAgent";
import type { SkillsetsResponse } from "@/domain/types";

export type UseWorkflowAgentEditorSessionArgs = {
  workflowId: string;
  skillsetsResponse: SkillsetsResponse | undefined;
};

export type UseWorkflowAgentEditorSessionResult = {
  agentConfigured: boolean;
  syncPending: boolean;
  syncSucceeded: boolean;
  /** sync 요청 실패 시 메시지 (토스트 등) */
  syncErrorMessage: string | null;
  status: WorkflowAgentStatusResponse | undefined;
  statusLoading: boolean;
  statusError: Error | null;
  /** alive && model_loaded && skills_ready — draft UI 노출 조건 */
  agentReadyForDraftUi: boolean;
  refetchStatus: () => void;
};

function toErrorMessage(err: unknown): string | null {
  if (err == null) return null;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function useWorkflowAgentEditorSession({
  workflowId,
  skillsetsResponse
}: UseWorkflowAgentEditorSessionArgs): UseWorkflowAgentEditorSessionResult {
  const queryClient = useQueryClient();
  const syncAttemptedForWorkflowRef = useRef<string | null>(null);

  const agentConfigured = workflowAgentApi.isConfigured();

  const syncMutation = useMutation({
    mutationFn: (body: ReturnType<typeof mapSkillsetsToWorkflowAgentSyncRequest>) =>
      workflowAgentApi.syncSkills(body),
    onSuccess: () => {
      queryClient
        .invalidateQueries({ queryKey: ["workflow-agent-status", workflowId] })
        .catch(() => {
          /* ignore */
        });
    }
  });

  const { mutate } = syncMutation;

  useEffect(() => {
    syncAttemptedForWorkflowRef.current = null;
  }, [workflowId]);

  useEffect(() => {
    if (!agentConfigured) return;
    if (!skillsetsResponse) return;
    if (syncAttemptedForWorkflowRef.current === workflowId) return;
    syncAttemptedForWorkflowRef.current = workflowId;
    mutate(mapSkillsetsToWorkflowAgentSyncRequest(skillsetsResponse.skill_sets));
  }, [agentConfigured, skillsetsResponse, workflowId, mutate]);

  const statusQuery = useQuery({
    queryKey: ["workflow-agent-status", workflowId],
    queryFn: () => workflowAgentApi.getStatus(),
    enabled: agentConfigured && syncMutation.isSuccess,
    staleTime: 10_000
  });

  const status = statusQuery.data;
  const agentReadyForDraftUi = Boolean(status?.alive && status.model_loaded && status.skills_ready);

  return {
    agentConfigured,
    syncPending: syncMutation.isPending,
    syncSucceeded: syncMutation.isSuccess,
    syncErrorMessage: syncMutation.isError ? toErrorMessage(syncMutation.error) : null,
    status,
    statusLoading: statusQuery.isLoading || statusQuery.isFetching,
    statusError: statusQuery.error instanceof Error ? statusQuery.error : null,
    agentReadyForDraftUi,
    refetchStatus: () => {
      statusQuery.refetch().catch(() => {
        /* ignore */
      });
    }
  };
}
