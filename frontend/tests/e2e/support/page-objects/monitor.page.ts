import type { Locator, Page } from "@playwright/test";

/** 글로벌 라이브 러너 모니터 (`/monitor`) */
export class LiveMonitorPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/monitor");
  }

  root(): Locator {
    return this.page.getByTestId("monitor-page");
  }
}

export class MonitorRunPage {
  constructor(private readonly page: Page) {}

  async goto(runId: string, query?: { mode?: "replay" }) {
    const q = query?.mode ? `?mode=${query.mode}` : "";
    await this.page.goto(`/monitor/${runId}${q}`);
  }

  root(): Locator {
    return this.page.getByTestId("monitor-run-page");
  }
}

export class MonitorWorkflowPage {
  constructor(private readonly page: Page) {}

  async goto(workflowId: string) {
    await this.page.goto(`/monitor/workflow/${workflowId}`);
  }

  root(): Locator {
    return this.page.getByTestId("monitor-workflow-page");
  }
}
