import { expect, test } from "@playwright/test";

import { AppShellPage } from "./support/page-objects/app-shell.page";

test.describe("Smoke: app shell", () => {
  test("대시보드 루트가 앱 셸과 함께 보인다", async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("dashboard-page")).toBeVisible({ timeout: 15_000 });
  });
});
