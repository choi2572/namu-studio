import { expect, test } from "@playwright/test";

import { AppShellPage } from "./support/page-objects/app-shell.page";
import { EditorPageObject } from "./support/page-objects/editor.page";
import { SEED_DRAFT_WORKFLOW_ID } from "./support/seed";

test.describe("Regression: Editor · 리팩토링 안전장치", () => {
  test("검증 에러가 있으면 Publish는 비활성이고 확인 모달이 뜨지 않는다", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });

    await editor.openWorkflowMenu();
    const publishButton = page.getByTestId("workflow-menu-publish");
    await expect(publishButton).toBeDisabled();
    const publishDialog = page.getByRole("dialog", { name: "Publish workflow?" });
    await expect(publishDialog).not.toBeVisible();
  });

  test("Failure Handling을 켜면 Edit Flow로 드로어를 열고 닫을 수 있다", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });

    await editor.openWorkflowMenu();
    const editFlowButton = page.getByRole("button", { name: "Edit Flow" });
    if (!(await editFlowButton.isEnabled())) {
      await page.getByRole("button", { name: "Failure Handling", exact: true }).click();
    }
    await expect(editFlowButton).toBeEnabled();
    await editFlowButton.click();

    await expect(page.getByText("Failure Handling Flow", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close Failure Handling Flow" }).click();
    await expect(page.getByText("Failure Handling Flow", { exact: true })).not.toBeVisible();
  });

  test("unsaved 변경 상태에서 이탈 확인을 취소하면 에디터에 머문다", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await editor.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });

    // Import로 캔버스 상태를 바꿔 unsaved 변경을 확실히 만든다.
    await editor.openMenuAndImportDslExample();
    await expect(page.getByRole("dialog", { name: "Import failed" })).not.toBeVisible();

    page.once("dialog", (d) => d.dismiss());
    const shell = new AppShellPage(page);
    await shell.clickSidebarLink("Dashboard");

    await expect(page).toHaveURL(new RegExp(`/editor/${SEED_DRAFT_WORKFLOW_ID}$`));
    await expect(editor.root()).toBeVisible();
  });
});
