import { expect, test } from "@playwright/test";

import { AppShellPage } from "./support/page-objects/app-shell.page";
import { EditorPageObject } from "./support/page-objects/editor.page";
import {
  SEED_CONDITION_PARALLEL_WORKFLOW_ID,
  SEED_CONDITION_PARALLEL_WORKFLOW_NAME,
  SEED_DRAFT_WORKFLOW_ID,
  SEED_DRAFT_WORKFLOW_NAME,
  SEED_PUBLISHED_WORKFLOW_ID,
  SEED_PUBLISHED_WORKFLOW_NAME,
  SEED_WAIT_WORKFLOW_ID,
  SEED_WAIT_WORKFLOW_NAME
} from "./support/seed";

test.describe("Smoke: Editor · 스택·카탈로그 (백엔드 + mock_middleware)", () => {
  test("백엔드 헬스와 미들웨어 스킬 세트가 응답한다 (dsl-example SSOT 정합)", async ({
    request
  }) => {
    const health = await request.get("http://127.0.0.1:5000/api/capabilities/health");
    expect(health.ok()).toBeTruthy();

    const skillsRes = await request.get("http://127.0.0.1:8000/api/v1/skill-sets");
    expect(skillsRes.ok()).toBeTruthy();
    const body = (await skillsRes.json()) as {
      skill_sets: Array<{ namespace: string; name: string }>;
    };
    const qualified = body.skill_sets.map((s) => `${s.namespace}.${s.name}`);
    // docs/dsl-example.json 및 mock_middleware MOCK_SKILL_SET 기준
    expect(qualified).toContain("vision.PreprocessFrame");
    expect(qualified).toContain("robot.ExecuteAction");
    expect(qualified).toContain("system.NotifyOps");
  });
});

test.describe("Smoke: Editor · 시드 워크플로 (API에서 DSL 로드)", () => {
  test("드래프트 워크플로가 로드되고 Save/Publish 메뉴에 도달한다", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: SEED_DRAFT_WORKFLOW_NAME })).toBeVisible();
    await expect(page.getByRole("button", { name: "Auto Layout" })).toBeVisible();
    await editor.expectSaveAndPublishReachable();
  });

  test("퍼블리시 워크플로 에디터가 뜨고 API DSL에 FetchData·ProcessData 상태가 있다", async ({
    page,
    request
  }) => {
    const draftRes = await request.get(
      `http://127.0.0.1:5000/api/workflows/${SEED_PUBLISHED_WORKFLOW_ID}/draft`
    );
    expect(draftRes.ok()).toBeTruthy();
    const body = (await draftRes.json()) as { dsl_json?: { States?: Record<string, unknown> } };
    expect(body.dsl_json?.States?.FetchData).toBeTruthy();
    expect(body.dsl_json?.States?.TransformData).toBeTruthy();
    expect(body.dsl_json?.States?.ProcessData).toBeTruthy();

    const editor = new EditorPageObject(page);
    await editor.goto(SEED_PUBLISHED_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: SEED_PUBLISHED_WORKFLOW_NAME })).toBeVisible();
  });

  test("Condition + Parallel 시드 DSL 상태명이 보인다", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_CONDITION_PARALLEL_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: SEED_CONDITION_PARALLEL_WORKFLOW_NAME })
    ).toBeVisible();
    const canvas = editor.root();
    await expect(canvas.getByText("CheckCondition", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(canvas.getByText("ParallelSplit", { exact: true })).toBeVisible();
  });

  test("Wait 시드 DSL에 WaitForEvent 상태가 API에 있고 에디터 셸이 뜬다", async ({ page, request }) => {
    const draftRes = await request.get(
      `http://127.0.0.1:5000/api/workflows/${SEED_WAIT_WORKFLOW_ID}/draft`
    );
    expect(draftRes.ok()).toBeTruthy();
    const body = (await draftRes.json()) as { dsl_json?: { States?: Record<string, unknown> } };
    expect(body.dsl_json?.States?.WaitForEvent).toBeTruthy();

    const editor = new EditorPageObject(page);
    await editor.goto(SEED_WAIT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: SEED_WAIT_WORKFLOW_NAME })).toBeVisible();
  });
});

test.describe("Smoke: Editor · SSOT dsl-example.json (Import + 저장)", () => {
  test.describe.configure({ mode: "serial" });

  test("Import 후 dsl-example Label·Inputs가 보인다 (상태명이 아닌 DSL Label)", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });

    await editor.openMenuAndImportDslExample();

    await expect(page.getByRole("dialog", { name: "Import failed" })).not.toBeVisible();
    const canvas = editor.root();
    // parseDslToEditor uses state.Label ?? stateName — docs/dsl-example.json 주석 플로우
    await expect(canvas.getByText("Inputs", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(canvas.getByText("Condition", { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText("Parallel", { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText("Retry", { exact: true }).first()).toBeVisible();
    // Succeed 상태 Label (dsl-example Output_1)
    await expect(canvas.getByText("Output", { exact: true }).first()).toBeVisible();
  });

  test("Import한 dsl-example을 Save하면 draft PUT이 성공한다", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });

    await editor.openMenuAndImportDslExample();
    await expect(page.getByRole("dialog", { name: "Import failed" })).not.toBeVisible();

    const saveResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/workflows/${SEED_DRAFT_WORKFLOW_ID}/draft`) &&
        res.request().method() === "PUT" &&
        res.ok()
    );
    await editor.openWorkflowMenu();
    await page.getByTestId("workflow-menu-save").click();
    await saveResponse;
  });
});

test.describe("Smoke: Editor · 새 워크플로", () => {
  test("/editor/new 가 로드된다", async ({ page }) => {
    await page.goto("/editor/new");
    await expect(page.getByTestId("editor-page")).toBeVisible();
    await expect(page.getByText("Workflow Editor").first()).toBeVisible();
    await expect(page.getByRole("heading")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Smoke: Editor · 앱 셸 내비게이션", () => {
  test("에디터에서 대시보드로 나갈 때 확인 후 이동한다", async ({ page }) => {
    page.once("dialog", (d) => d.accept());
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible();
    await expect(page.getByRole("heading", { name: SEED_DRAFT_WORKFLOW_NAME })).toBeVisible({
      timeout: 15_000
    });
    const shell = new AppShellPage(page);
    await shell.clickSidebarLink("Dashboard");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("dashboard-page")).toBeVisible();
  });
});

