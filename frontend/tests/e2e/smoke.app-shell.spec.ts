import { expect, test } from "@playwright/test";

import { AppShellPage } from "./support/page-objects/app-shell.page";
import { EditorPageObject } from "./support/page-objects/editor.page";

test.describe("Smoke: app shell & 주요 페이지", () => {
  test("대시보드가 로드되고 워크플로 목록이 보인다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("dashboard-page")).toBeVisible();
    await expect(page.getByText("Total Workflows")).toBeVisible();
    await expect(page.getByRole("row", { name: /Pick & Place Draft/ })).toBeVisible({
      timeout: 15_000
    });
  });

  test("사이드바에서 Monitor로 이동하면 /monitor 이다", async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.goto("/");
    await shell.clickSidebarLink("Monitor");
    await expect(page).toHaveURL(/\/monitor\/?$/);
    await expect(page.getByTestId("monitor-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible();
  });

  test("모니터: 연결 대기 또는 빈 상태 중 하나가 보인다", async ({ page }) => {
    await page.goto("/monitor");
    await expect(page.getByTestId("monitor-page")).toBeVisible();
    const main = page.getByTestId("monitor-page");
    await expect(
      main.getByText(/Waiting for monitor connection|No workflow is currently running/)
    ).toBeVisible({ timeout: 20_000 });
  });

  test("Run History 페이지가 로드된다", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByTestId("run-history-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "All Runs" })).toBeVisible();
  });

  test("에디터: 기존 워크플로가 로드되고 Save/Publish에 도달할 수 있다", async ({
    page
  }) => {
    await page.goto("/editor/workflow-001");
    await expect(page.getByTestId("editor-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pick & Place Draft" })).toBeVisible({
      timeout: 15_000
    });
    await expect(page.getByRole("button", { name: "Auto Layout" })).toBeVisible();
    const editorPo = new EditorPageObject(page);
    await editorPo.expectSaveAndPublishReachable();
  });

  test("에디터: 새 워크플로(/editor/new)가 로드된다", async ({ page }) => {
    await page.goto("/editor/new");
    await expect(page.getByTestId("editor-page")).toBeVisible();
    await expect(page.getByText("Workflow Editor").first()).toBeVisible();
    await expect(page.getByRole("heading")).toBeVisible({ timeout: 15_000 });
  });

  test("에디터에서 대시보드로 나갈 때 확인 후 이동한다", async ({ page }) => {
    page.once("dialog", (d) => d.accept());
    await page.goto("/editor/workflow-001");
    await expect(page.getByTestId("editor-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pick & Place Draft" })).toBeVisible({
      timeout: 15_000
    });
    const shell = new AppShellPage(page);
    await shell.clickSidebarLink("Dashboard");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("dashboard-page")).toBeVisible();
  });
});
