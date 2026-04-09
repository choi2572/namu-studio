import { expect, test } from "@playwright/test";

import { EditorPageObject } from "./support/page-objects/editor.page";

/**
 * 스킬 카탈로그는 `GET /api/capabilities/skill-set` → mock_middleware `GET /api/v1/skill-sets`에 의존합니다.
 * PlaceObject.orientation → candidates, TrackTargets.maxTargets → range(min 1, max 32).
 */
test.describe("Editor · 스킬 파라미터 range / candidates", () => {
  test("numeric range: maxTargets가 범위 밖이면 메시지가 보이고 유효 값이면 사라진다", async ({
    page
  }) => {
    const editor = new EditorPageObject(page);
    await page.goto("/editor/new");
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });

    await editor.addSkillFromPalette(/Track Targets/);
    await editor.expandSelectedNodeCard();

    const card = editor.root().locator("[data-node-card].border-slate-900").first();
    const maxTargets = card
      .locator("label")
      .filter({ hasText: "MaxTargets" })
      .locator("input")
      .first();
    await maxTargets.fill("0");
    await expect(card.getByTestId("editor-skill-param-range-error-maxTargets")).toBeVisible();

    await maxTargets.fill("5");
    await expect(card.getByTestId("editor-skill-param-range-error-maxTargets")).not.toBeVisible();
  });

  test("candidates: orientation이 셀렉트로 보이고 옵션을 바꿀 수 있다", async ({ page }) => {
    const editor = new EditorPageObject(page);
    await page.goto("/editor/new");
    await expect(editor.root()).toBeVisible({ timeout: 15_000 });

    await editor.addSkillFromPalette(/Place Object/);
    await editor.expandSelectedNodeCard();

    const card = editor.root().locator("[data-node-card].border-slate-900").first();
    const select = card.getByTestId("editor-skill-param-select-orientation");
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveCount(5);

    await select.selectOption("east");
    await expect(select).toHaveValue("east");
  });
});
