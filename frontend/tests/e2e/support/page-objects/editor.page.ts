import { expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 리포 루트(namu-studio) 기준 `docs/dsl-example.json` (SSOT) */
export const DSL_EXAMPLE_JSON_PATH = path.resolve(
  __dirname,
  "../../../../../docs/dsl-example.json"
);

export class EditorPageObject {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId("editor-page");
  }

  async goto(workflowId: string) {
    await this.page.goto(`/editor/${workflowId}`);
  }

  async openWorkflowMenu() {
    await this.page.getByTestId("workflow-menu-button").click();
  }

  async expectSaveAndPublishReachable() {
    await this.openWorkflowMenu();
    await this.page.getByTestId("workflow-menu-save").waitFor({ state: "visible" });
    await this.page.getByTestId("workflow-menu-publish").waitFor({ state: "visible" });
  }

  /**
   * 워크플로 메뉴의 Import…로 SSOT JSON을 선택하고 덮어쓰기 확인까지 진행합니다.
   * 스킬 카탈로그는 백엔드→mock_middleware `GET /api/v1/skill-sets`에 의존합니다.
   */
  async openMenuAndImportJson(absolutePath: string) {
    await this.openWorkflowMenu();
    const importBtn = this.page.getByRole("button", { name: "Import…" });
    await expect(importBtn).toBeEnabled({ timeout: 25_000 });
    const [fileChooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      importBtn.click()
    ]);
    await fileChooser.setFiles(absolutePath);
    await this.page
      .getByRole("dialog", { name: "Replace editor contents?" })
      .getByRole("button", { name: "OK" })
      .click();
  }

  async openMenuAndImportDslExample() {
    await this.openMenuAndImportJson(DSL_EXAMPLE_JSON_PATH);
  }
}
