"use client";

import type { MutableRefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { QueryClient } from "@tanstack/react-query";

import { workflowAgentApi } from "@/api";
import type { WorkflowAgentStatusResponse } from "@/api/workflowAgent";
import type { SkillsetsResponse } from "@/domain/types";

import { getWorkflowAgentBarHint } from "./workflowAgentBarHint";
import { AGENT_DRAFT_PLACEHOLDER } from "./workflowAgentDraftConstants";
import { getWorkflowAgentDraftFailureHints } from "./workflowAgentDraftUi";
import { pollWorkflowAgentUntilModelReady } from "./workflowAgentModelPoll";
import { useWorkflowAgentEditorSession } from "./useWorkflowAgentEditorSession";

export type WorkflowAgentReplanPayload = {
  dsl: Record<string, unknown>;
  focus_state_names: string[];
};

export type UseEditorWorkflowAgentParams = {
  workflowId: string;
  skillsetsResponse: SkillsetsResponse | undefined;
  queryClient: QueryClient;
  workflowNameForDraftFile: string;
  /** commitImportedDsl에서 피드백 UI 초기화 */
  clearAgentDraftUiRef: MutableRefObject<(() => void) | null>;
  onApplyGeneratedDsl: (pending: { dsl: Record<string, unknown>; fileBaseName: string }) => void;
  getReplanPayload: () => WorkflowAgentReplanPayload;
  replanEnabled: boolean;
};

export type UseEditorWorkflowAgentResult = {
  syncErrorMessage: string | null;
  showWorkflowAgentBar: boolean;
  workflowAgentBarProps: {
    modelIds: string[];
    selectedModel: string;
    onModelChange: (id: string) => void;
    prompt: string;
    onPromptChange: (value: string) => void;
    placeholder: string;
    onGenerate: () => void;
    onReplan: () => void;
    replanExtraDisabled: boolean;
    disabled: boolean;
    disabledHint: string | null;
    feedbackMessage: string | null;
  };
  agentGenerating: boolean;
};

export function useEditorWorkflowAgent({
  workflowId,
  skillsetsResponse,
  queryClient,
  workflowNameForDraftFile,
  clearAgentDraftUiRef,
  onApplyGeneratedDsl,
  getReplanPayload,
  replanEnabled
}: UseEditorWorkflowAgentParams): UseEditorWorkflowAgentResult {
  const session = useWorkflowAgentEditorSession({
    workflowId,
    skillsetsResponse
  });

  const [agentDraftPrompt, setAgentDraftPrompt] = useState("");
  const [agentInputPlaceholder, setAgentInputPlaceholder] = useState(AGENT_DRAFT_PLACEHOLDER);
  const [agentDraftHelperText, setAgentDraftHelperText] = useState<string | null>(null);
  const [selectedAgentModel, setSelectedAgentModel] = useState("");
  const [agentGenerating, setAgentGenerating] = useState(false);

  /** 모델 전환 요청을 FIFO로 직렬화 (연속 선택·선택 직후 Generate 등) */
  const modelActivationChainRef = useRef<Promise<void>>(Promise.resolve());

  const resetAgentDraftUi = useCallback(() => {
    setAgentDraftHelperText(null);
    setAgentInputPlaceholder(AGENT_DRAFT_PLACEHOLDER);
  }, []);

  useLayoutEffect(() => {
    clearAgentDraftUiRef.current = resetAgentDraftUi;
    return () => {
      clearAgentDraftUiRef.current = null;
    };
  }, [clearAgentDraftUiRef, resetAgentDraftUi]);

  const agentModelIds = useMemo(() => {
    const st = session.status;
    if (!st) return [];
    return st.supported_models?.length ? [...st.supported_models] : [st.active_model];
  }, [session.status]);

  useEffect(() => {
    const st = session.status;
    if (!st) return;
    const ids = st.supported_models?.length > 0 ? st.supported_models : [st.active_model];
    setSelectedAgentModel((prev) => {
      if (prev && ids.includes(prev)) return prev;
      return st.active_model;
    });
  }, [session.status]);

  const showWorkflowAgentBar = Boolean(session.agentConfigured && skillsetsResponse);

  const draftUiCoreReady = Boolean(
    session.status?.alive &&
    session.status.skills_ready &&
    !session.syncPending &&
    !session.syncErrorMessage
  );

  const workflowAgentBarInteractive = Boolean(
    session.status && draftUiCoreReady && !agentGenerating
  );

  const statusQueryKey = useMemo(
    () => ["workflow-agent-status", workflowId] as const,
    [workflowId]
  );

  const enqueueModelActivation = useCallback(
    (modelId: string): Promise<void> => {
      const run = async () => {
        await workflowAgentApi.activateModel({ model: modelId });
        await pollWorkflowAgentUntilModelReady(modelId, queryClient, workflowId);
      };
      const next = modelActivationChainRef.current.then(run);
      modelActivationChainRef.current = next.catch(() => {
        /* 다음 전환은 계속 진행 */
      });
      return next;
    },
    [queryClient, workflowId]
  );

  const workflowAgentBarHint = useMemo(
    () =>
      getWorkflowAgentBarHint({
        agentConfigured: session.agentConfigured,
        syncPending: session.syncPending,
        syncErrorMessage: session.syncErrorMessage,
        statusError: session.statusError,
        status: session.status,
        syncSucceeded: session.syncSucceeded
      }),
    [
      session.agentConfigured,
      session.syncPending,
      session.syncErrorMessage,
      session.statusError,
      session.status,
      session.syncSucceeded
    ]
  );

  const runReplan = useCallback(async () => {
    const text = agentDraftPrompt.trim();
    if (!text || agentGenerating) return;
    if (!skillsetsResponse || !draftUiCoreReady || !replanEnabled) return;

    setAgentDraftHelperText(null);
    setAgentGenerating(true);
    try {
      await modelActivationChainRef.current;

      let st: WorkflowAgentStatusResponse = await workflowAgentApi.getStatus();
      queryClient.setQueryData(statusQueryKey, st);

      const targetModel = (selectedAgentModel || st.active_model).trim();
      if (!targetModel) {
        throw new Error("모델을 선택해 주세요.");
      }

      if (targetModel !== st.active_model || !st.model_loaded) {
        await enqueueModelActivation(targetModel);
        st = await workflowAgentApi.getStatus();
        queryClient.setQueryData(statusQueryKey, st);
        if (targetModel !== st.active_model || !st.model_loaded) {
          throw new Error("모델 전환이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.");
        }
      }

      const { dsl, focus_state_names } = getReplanPayload();
      const res = await workflowAgentApi.postReplan({
        request: text,
        current_dsl: dsl,
        focus_state_names,
        model: targetModel
      });
      if (!res.success) {
        const hints = getWorkflowAgentDraftFailureHints(res);
        setAgentDraftHelperText(hints.feedbackMessage);
        setAgentInputPlaceholder(hints.placeholder);
        return;
      }

      onApplyGeneratedDsl({
        dsl: res.dsl as Record<string, unknown>,
        fileBaseName: workflowNameForDraftFile
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "요청에 실패했습니다.";
      setAgentDraftHelperText(msg);
      setAgentInputPlaceholder(msg);
    } finally {
      setAgentGenerating(false);
    }
  }, [
    agentDraftPrompt,
    agentGenerating,
    skillsetsResponse,
    draftUiCoreReady,
    replanEnabled,
    selectedAgentModel,
    queryClient,
    statusQueryKey,
    workflowNameForDraftFile,
    onApplyGeneratedDsl,
    enqueueModelActivation,
    getReplanPayload
  ]);

  const runGenerate = useCallback(async () => {
    const text = agentDraftPrompt.trim();
    if (!text || agentGenerating) return;
    if (!skillsetsResponse || !draftUiCoreReady) return;

    setAgentDraftHelperText(null);
    setAgentGenerating(true);
    try {
      await modelActivationChainRef.current;

      let st: WorkflowAgentStatusResponse = await workflowAgentApi.getStatus();
      queryClient.setQueryData(statusQueryKey, st);

      const targetModel = (selectedAgentModel || st.active_model).trim();
      if (!targetModel) {
        throw new Error("모델을 선택해 주세요.");
      }

      if (targetModel !== st.active_model || !st.model_loaded) {
        await enqueueModelActivation(targetModel);
        st = await workflowAgentApi.getStatus();
        queryClient.setQueryData(statusQueryKey, st);
        if (targetModel !== st.active_model || !st.model_loaded) {
          throw new Error("모델 전환이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.");
        }
      }

      const res = await workflowAgentApi.postDraft({ request: text, model: targetModel });
      if (!res.success) {
        const hints = getWorkflowAgentDraftFailureHints(res);
        setAgentDraftHelperText(hints.feedbackMessage);
        setAgentInputPlaceholder(hints.placeholder);
        return;
      }

      onApplyGeneratedDsl({
        dsl: res.dsl as Record<string, unknown>,
        fileBaseName: workflowNameForDraftFile
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "요청에 실패했습니다.";
      setAgentDraftHelperText(msg);
      setAgentInputPlaceholder(msg);
    } finally {
      setAgentGenerating(false);
    }
  }, [
    agentDraftPrompt,
    agentGenerating,
    skillsetsResponse,
    draftUiCoreReady,
    selectedAgentModel,
    queryClient,
    statusQueryKey,
    workflowId,
    workflowNameForDraftFile,
    onApplyGeneratedDsl,
    enqueueModelActivation
  ]);

  const workflowAgentBarProps: UseEditorWorkflowAgentResult["workflowAgentBarProps"] = {
    modelIds: agentModelIds,
    selectedModel: selectedAgentModel,
    onModelChange: (id) => {
      setSelectedAgentModel(id);
      setAgentDraftHelperText(null);
      const cached = queryClient.getQueryData<WorkflowAgentStatusResponse>(statusQueryKey);
      if (cached?.active_model === id && cached.model_loaded) {
        return;
      }
      void enqueueModelActivation(id).catch((e) => {
        const msg = e instanceof Error ? e.message : "모델 전환에 실패했습니다.";
        setAgentDraftHelperText(msg);
      });
    },
    prompt: agentDraftPrompt,
    onPromptChange: (value) => {
      setAgentDraftPrompt(value);
      setAgentDraftHelperText(null);
    },
    placeholder: agentInputPlaceholder,
    onGenerate: () => {
      runGenerate().catch(() => {
        /* 오류는 상태로 반영됨 */
      });
    },
    onReplan: () => {
      runReplan().catch(() => {
        /* 오류는 상태로 반영됨 */
      });
    },
    replanExtraDisabled: !replanEnabled,
    disabled: !workflowAgentBarInteractive,
    disabledHint: workflowAgentBarInteractive ? null : workflowAgentBarHint,
    feedbackMessage: agentDraftHelperText
  };

  return {
    syncErrorMessage: session.syncErrorMessage,
    showWorkflowAgentBar,
    workflowAgentBarProps,
    agentGenerating
  };
}
