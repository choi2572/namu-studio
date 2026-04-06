import type { Locator, Page } from "@playwright/test";

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  root(): Locator {
    return this.page.getByTestId("dashboard-page");
  }

  workflowRowByName(name: string | RegExp): Locator {
    const re = typeof name === "string" ? new RegExp(name) : name;
    return this.page.getByRole("row", { name: re });
  }
}
