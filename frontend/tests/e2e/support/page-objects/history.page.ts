import type { Locator, Page } from "@playwright/test";

export class HistoryPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/history");
  }

  root(): Locator {
    return this.page.getByTestId("run-history-page");
  }

  filtersCard(): Locator {
    return this.root().locator("section").filter({
      has: this.page.getByRole("heading", { name: "Filters" })
    });
  }

  runsCard(): Locator {
    return this.root().locator("section").filter({
      has: this.page.getByRole("heading", { name: "Runs" })
    });
  }

  runRow(runId: string): Locator {
    return this.page.getByRole("row", { name: new RegExp(runId) });
  }
}
