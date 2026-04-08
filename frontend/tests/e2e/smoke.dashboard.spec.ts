import { expect, test } from "@playwright/test";

import { DashboardPage } from "./support/page-objects/dashboard.page";
import {
  SEED_DRAFT_WORKFLOW_ID,
  SEED_DRAFT_WORKFLOW_NAME,
  SEED_PUBLISHED_WORKFLOW_ID,
  SEED_PUBLISHED_WORKFLOW_NAME
} from "./support/seed";

test.describe("Smoke: Dashboard", () => {
  test("앱 셸과 대시보드 루트가 보인다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(dash.root()).toBeVisible({ timeout: 15_000 });
  });

  test("요약 통계 카드가 시드 데이터와 함께 표시된다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    const root = dash.root();
    await expect(root.getByText("Total Workflows", { exact: true })).toBeVisible({
      timeout: 15_000
    });
    await expect(
      root.getByText("Total Workflows", { exact: true }).locator("..").locator(".text-3xl")
    ).toHaveText("4");
    await expect(root.getByText("Total Runs", { exact: true })).toBeVisible();
    await expect(
      root.getByText("Total Runs", { exact: true }).locator("..").locator(".text-3xl")
    ).toHaveText("2");
    await expect(root.getByText("Success Rate", { exact: true })).toBeVisible();
    await expect(
      root.getByText("Success Rate", { exact: true }).locator("..").locator(".text-3xl")
    ).toContainText("50");
  });

  test("Latest Run·Recent Failures·Workflows 주요 영역이 보인다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    const root = dash.root();
    await expect(root.getByRole("heading", { name: "Latest Run" })).toBeVisible({
      timeout: 15_000
    });
    await expect(root.getByText("Current or most recent run")).toBeVisible();
    await expect(root.getByRole("heading", { name: "Recent Failures" })).toBeVisible();
    await expect(root.getByRole("link", { name: "View all" })).toBeVisible();
    await expect(root.getByRole("heading", { name: "Workflows" })).toBeVisible();
    await expect(root.getByText("Registered workflows and latest run information")).toBeVisible();
  });

  test("시드 워크플로가 테이블에 나열고 컬럼 헤더가 있다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    const root = dash.root();
    await expect(root.getByRole("columnheader", { name: "Workflow Name" })).toBeVisible({
      timeout: 15_000
    });
    await expect(root.getByRole("columnheader", { name: "Latest Run State" })).toBeVisible();
    await expect(root.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    await expect(dash.workflowRowByName(SEED_DRAFT_WORKFLOW_NAME)).toBeVisible();
    await expect(dash.workflowRowByName(SEED_PUBLISHED_WORKFLOW_NAME)).toBeVisible();
    await expect(
      dash.workflowRowByName(SEED_DRAFT_WORKFLOW_NAME).getByText("Draft", { exact: true })
    ).toBeVisible();
  });

  test("Latest Run 카드에서 시드 런 요약과 상세 이동 버튼이 보인다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    const root = dash.root();
    const latestSection = root
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Latest Run" }) });
    await expect(latestSection.getByText(SEED_PUBLISHED_WORKFLOW_NAME)).toBeVisible({
      timeout: 15_000
    });
    await expect(latestSection.getByRole("button", { name: /View Run Details/ })).toBeVisible();
  });

  test("Recent Failures에 시드 실패 런이 표시된다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    const root = dash.root();
    const failuresSection = root.locator("section").filter({
      has: page.getByRole("heading", { name: "Recent Failures" })
    });
    await expect(failuresSection.getByText(SEED_PUBLISHED_WORKFLOW_NAME)).toBeVisible({
      timeout: 15_000
    });
  });

  test("드래프트 행 클릭 시 에디터로 이동한다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    await dash.workflowRowByName(SEED_DRAFT_WORKFLOW_NAME).click();
    await expect(page).toHaveURL(new RegExp(`/editor/${SEED_DRAFT_WORKFLOW_ID}`));
    await expect(page.getByTestId("editor-page")).toBeVisible({ timeout: 15_000 });
  });

  test("퍼블리시된 행 클릭 시 해당 워크플로 모니터로 이동한다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    await dash.workflowRowByName(SEED_PUBLISHED_WORKFLOW_NAME).click();
    await expect(page).toHaveURL(new RegExp(`/monitor/workflow/${SEED_PUBLISHED_WORKFLOW_ID}`));
  });

  test("행의 More 메뉴에서 Export·Duplicate가 보인다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    const row = dash.workflowRowByName(SEED_DRAFT_WORKFLOW_NAME);
    await row.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Export" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  });

  test("드래프트 행의 편집 버튼으로 에디터로 이동한다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    const row = dash.workflowRowByName(SEED_DRAFT_WORKFLOW_NAME);
    await row.getByRole("button", { name: "Edit workflow" }).click();
    await expect(page).toHaveURL(new RegExp(`/editor/${SEED_DRAFT_WORKFLOW_ID}`));
  });

  test("Recent Failures의 View all로 Run History로 이동한다", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    await dash.root().getByRole("link", { name: "View all" }).click();
    await expect(page).toHaveURL(/\/history\/?$/);
    await expect(page.getByTestId("run-history-page")).toBeVisible();
  });
});
