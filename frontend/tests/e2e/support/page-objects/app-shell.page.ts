import type { Page } from "@playwright/test";

export class AppShellPage {
  constructor(private readonly page: Page) {}

  async goto(path = "/") {
    await this.page.goto(path);
  }

  /** 사이드바 기본이 접힘일 때 전체 라벨 링크를 쓰기 위해 펼칩니다. */
  async expandSidebarIfCollapsed() {
    const expand = this.page.getByRole("button", { name: "Expand sidebar" });
    if (await expand.isVisible()) {
      await expand.click();
    }
  }

  async clickSidebarLink(label: string) {
    await this.expandSidebarIfCollapsed();
    await this.page.getByRole("link", { name: label }).click();
  }
}
