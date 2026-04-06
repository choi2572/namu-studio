/** 백엔드 `app/seed.py` 시드와 동일 (SQLite + SEED_DATA 기준 E2E) */
export const SEED_DRAFT_WORKFLOW_ID = "wf-seed-draft";
export const SEED_DRAFT_WORKFLOW_NAME = "Seeded Draft Workflow";

export const SEED_PUBLISHED_WORKFLOW_ID = "wf-seed-published";
export const SEED_PUBLISHED_WORKFLOW_NAME = "Seeded Published Workflow";

/** Condition + Parallel · Wait 시드 (`app/seed.py` SEED_IDS) */
export const SEED_CONDITION_PARALLEL_WORKFLOW_ID = "wf-seed-condition-parallel";
export const SEED_CONDITION_PARALLEL_WORKFLOW_NAME = "Seeded Condition + Parallel Workflow";

export const SEED_WAIT_WORKFLOW_ID = "wf-seed-wait";
export const SEED_WAIT_WORKFLOW_NAME = "Seeded Wait Workflow";

/** 시드 런 (`app/seed.py` SEED_IDS) */
export const SEED_RUN_SUCCESS_ID = "run-seed-success";
export const SEED_RUN_FAILED_ID = "run-seed-failed";
export const SEED_RUN_FAILURE_CODE = "NODE_FAILED";
export const SEED_RUN_FAILURE_MESSAGE = "TransformData failed validation";
