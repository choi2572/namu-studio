import type { Page } from "@playwright/test";

export class EditorPageObject {
  constructor(private readonly page: Page) {}

  async openWorkflowMenu() {
    await this.page.getByTestId("workflow-menu-button").click();
  }

  async expectSaveAndPublishReachable() {
    await this.openWorkflowMenu();
    await this.page.getByTestId("workflow-menu-save").waitFor({ state: "visible" });
    await this.page.getByTestId("workflow-menu-publish").waitFor({ state: "visible" });
  }
}
