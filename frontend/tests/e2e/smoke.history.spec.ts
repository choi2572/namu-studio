import { expect, test } from "@playwright/test";

import { AppShellPage } from "./support/page-objects/app-shell.page";
import { HistoryPage } from "./support/page-objects/history.page";
import {
  SEED_DRAFT_WORKFLOW_NAME,
  SEED_PUBLISHED_WORKFLOW_ID,
  SEED_PUBLISHED_WORKFLOW_NAME,
  SEED_RUN_FAILED_ID,
  SEED_RUN_FAILURE_CODE,
  SEED_RUN_FAILURE_MESSAGE,
  SEED_RUN_SUCCESS_ID
} from "./support/seed";

test.describe("Smoke: Run History", () => {
  test("페이지 루트와 제목이 보인다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(hist.root()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Run History")).toBeVisible();
    await expect(page.getByRole("heading", { name: "All Runs" })).toBeVisible();
  });

  test("필터 카드에 상태·워크플로·기간과 Reset이 있다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    const filters = hist.filtersCard();
    await expect(filters.getByRole("heading", { name: "Filters" })).toBeVisible({
      timeout: 15_000
    });
    await expect(filters.getByText("Filter by status, workflow, time")).toBeVisible();
    const selects = filters.locator("select");
    await expect(selects).toHaveCount(3);
    await expect(filters.getByRole("button", { name: "Reset" })).toBeVisible();
  });

  test("Runs 테이블에 시드 런 두 건이 보인다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    const runs = hist.runsCard();
    await expect(runs.getByRole("heading", { name: "Runs" })).toBeVisible({
      timeout: 15_000
    });
    await expect(runs.getByText("Click a row to replay")).toBeVisible();
    await expect(runs.getByRole("columnheader", { name: "Run ID" })).toBeVisible();
    await expect(runs.getByRole("columnheader", { name: "Workflow Name" })).toBeVisible();
    await expect(runs.getByRole("columnheader", { name: "Start Time" })).toBeVisible();
    await expect(runs.getByRole("columnheader", { name: "Duration" })).toBeVisible();
    await expect(runs.getByRole("columnheader", { name: "Result" })).toBeVisible();

    await expect(hist.runRow(SEED_RUN_SUCCESS_ID)).toBeVisible();
    await expect(hist.runRow(SEED_RUN_SUCCESS_ID)).toContainText(SEED_PUBLISHED_WORKFLOW_NAME);
    await expect(hist.runRow(SEED_RUN_FAILED_ID)).toBeVisible();
    await expect(hist.runRow(SEED_RUN_FAILED_ID)).toContainText(SEED_PUBLISHED_WORKFLOW_NAME);
  });

  test("상태 필터 FAILED면 실패 런만 남는다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    const filters = hist.filtersCard();
    await filters.locator("select").first().selectOption("FAILED");
    await expect(hist.runRow(SEED_RUN_FAILED_ID)).toBeVisible({ timeout: 15_000 });
    await expect(hist.runRow(SEED_RUN_SUCCESS_ID)).toHaveCount(0);
  });

  test("상태 필터 SUCCESS면 성공 런만 남는다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    const filters = hist.filtersCard();
    await filters.locator("select").first().selectOption("SUCCESS");
    await expect(hist.runRow(SEED_RUN_SUCCESS_ID)).toBeVisible({ timeout: 15_000 });
    await expect(hist.runRow(SEED_RUN_FAILED_ID)).toHaveCount(0);
  });

  test("워크플로 필터로 런이 없는 워크플로는 빈 테이블이다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    const filters = hist.filtersCard();
    await filters.locator("select").nth(1).selectOption(SEED_PUBLISHED_WORKFLOW_ID);
    await expect(hist.runRow(SEED_RUN_SUCCESS_ID)).toBeVisible({ timeout: 15_000 });

    await filters.locator("select").nth(1).selectOption({ label: SEED_DRAFT_WORKFLOW_NAME });
    await expect(hist.runsCard().locator("tbody tr")).toHaveCount(0);
  });

  test("Reset으로 필터가 초기화되고 두 런이 다시 보인다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    const filters = hist.filtersCard();
    await filters.locator("select").first().selectOption("SUCCESS");
    await expect(hist.runRow(SEED_RUN_FAILED_ID)).toHaveCount(0);
    await filters.getByRole("button", { name: "Reset" }).click();
    await expect(hist.runRow(SEED_RUN_SUCCESS_ID)).toBeVisible({ timeout: 15_000 });
    await expect(hist.runRow(SEED_RUN_FAILED_ID)).toBeVisible();
  });

  test("성공 런 행 클릭 시 리플레이 모드 모니터로 이동한다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    await hist.runRow(SEED_RUN_SUCCESS_ID).click();
    await expect(page).toHaveURL(new RegExp(`/monitor/${SEED_RUN_SUCCESS_ID}\\?mode=replay`));
  });

  test("실패 런의 결과 뱃지로 실패 상세를 볼 수 있다", async ({ page }) => {
    const hist = new HistoryPage(page);
    await hist.goto();
    const failedRow = hist.runRow(SEED_RUN_FAILED_ID);
    await failedRow.getByRole("button").click();
    await expect(page.getByText("Failure", { exact: true })).toBeVisible();
    await expect(page.getByText(`Code: ${SEED_RUN_FAILURE_CODE}`)).toBeVisible();
    await expect(page.getByText(SEED_RUN_FAILURE_MESSAGE)).toBeVisible();
  });

  test("사이드바에서 Run History로 이동한다", async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.goto("/");
    await shell.clickSidebarLink("Run History");
    await expect(page).toHaveURL(/\/history\/?$/);
    await expect(page.getByTestId("run-history-page")).toBeVisible({ timeout: 15_000 });
  });
});
