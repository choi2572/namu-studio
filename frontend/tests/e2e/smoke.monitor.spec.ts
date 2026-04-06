import { expect, test } from "@playwright/test";

import { AppShellPage } from "./support/page-objects/app-shell.page";
import {
  LiveMonitorPage,
  MonitorRunPage,
  MonitorWorkflowPage
} from "./support/page-objects/monitor.page";
import {
  SEED_DRAFT_WORKFLOW_ID,
  SEED_DRAFT_WORKFLOW_NAME,
  SEED_PUBLISHED_WORKFLOW_ID,
  SEED_PUBLISHED_WORKFLOW_NAME,
  SEED_RUN_SUCCESS_ID
} from "./support/seed";

test.describe("Smoke: Monitor (live runner)", () => {
  test("라이브 모니터 페이지 루트와 제목이 보인다", async ({ page }) => {
    const live = new LiveMonitorPage(page);
    await live.goto();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(live.root()).toBeVisible({ timeout: 15_000 });
    await expect(live.root().getByRole("heading", { name: "Monitor" })).toBeVisible();
    await expect(
      live.root().getByText("Live middleware runner — independent of dashboard run detail.")
    ).toBeVisible();
  });

  test("연결 배지와(가능하면) 러너 상태가 표시된다", async ({ page }) => {
    const live = new LiveMonitorPage(page);
    await live.goto();
    const root = live.root();
    await expect(
      root.getByText(/Connecting…|Connected|Disconnected/)
    ).toBeVisible({ timeout: 25_000 });
    await expect(
      root.getByText(/Waiting for monitor connection|No workflow is currently running|Loading…|DAG View/)
    ).toBeVisible({ timeout: 25_000 });
    await expect
      .poll(async () => {
        const t = await root.textContent();
        return t?.includes("Runner:") ?? false;
      })
      .toBeTruthy();
  });

  test("사이드바에서 Monitor로 이동한다", async ({ page }) => {
    const shell = new AppShellPage(page);
    await shell.goto("/");
    await shell.clickSidebarLink("Monitor");
    await expect(page).toHaveURL(/\/monitor\/?$/);
    await expect(page.getByTestId("monitor-page")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Smoke: Monitor (run detail & replay)", () => {
  test("시드 성공 런 모니터가 로드되고 워크플로 이름·SUCCESS가 보인다", async ({
    page
  }) => {
    const run = new MonitorRunPage(page);
    await run.goto(SEED_RUN_SUCCESS_ID);
    await expect(run.root()).toBeVisible({ timeout: 15_000 });
    await expect(
      run.root().getByRole("heading", { name: SEED_PUBLISHED_WORKFLOW_NAME })
    ).toBeVisible();
    await expect(run.root().getByText("SUCCESS", { exact: true })).toBeVisible();
  });

  test("리플레이 모드에서 DAG·Timeline·재생 컨트롤이 보인다", async ({ page }) => {
    const run = new MonitorRunPage(page);
    await run.goto(SEED_RUN_SUCCESS_ID, { mode: "replay" });
    await expect(run.root()).toBeVisible({ timeout: 15_000 });
    await expect(
      run.root().getByRole("heading", { name: SEED_PUBLISHED_WORKFLOW_NAME })
    ).toBeVisible();
    await expect(run.root().getByRole("heading", { name: "DAG View" })).toBeVisible();
    await expect(
      run.root().getByText("Replay mode: viewing historical execution state")
    ).toBeVisible();
    await expect(run.root().getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(
      run.root().getByText("Replay-only timeline of events.")
    ).toBeVisible();
    await expect(run.root().getByRole("button", { name: /Play|Pause/ })).toBeVisible();
    await expect(run.root().getByRole("link", { name: "Open Workflow" })).toBeVisible();
  });
});

test.describe("Smoke: Monitor (workflow prep)", () => {
  test("퍼블리시 워크플로 준비 화면에서 Run·Edit·DAG가 보인다", async ({ page }) => {
    const wf = new MonitorWorkflowPage(page);
    await wf.goto(SEED_PUBLISHED_WORKFLOW_ID);
    await expect(wf.root()).toBeVisible({ timeout: 15_000 });
    await expect(
      wf.root().getByRole("heading", { name: SEED_PUBLISHED_WORKFLOW_NAME })
    ).toBeVisible();
    await expect(wf.root().getByRole("button", { name: "Run", exact: true })).toBeEnabled();
    await expect(wf.root().getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(wf.root().getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(wf.root().getByRole("heading", { name: "DAG View" })).toBeVisible();
    await expect(
      wf.root().getByText("Click Run to start execution; you will be redirected to the monitor.")
    ).toBeVisible();
  });

  test("드래프트 워크플로는 Run이 비활성이고 안내 문구가 보인다", async ({ page }) => {
    const wf = new MonitorWorkflowPage(page);
    await wf.goto(SEED_DRAFT_WORKFLOW_ID);
    await expect(wf.root()).toBeVisible({ timeout: 15_000 });
    await expect(
      wf.root().getByRole("heading", { name: SEED_DRAFT_WORKFLOW_NAME })
    ).toBeVisible();
    await expect(wf.root().getByRole("button", { name: "Run", exact: true })).toBeDisabled();
    await expect(
      wf.root().getByText("This workflow is in Draft. Publish from the editor to run.")
    ).toBeVisible();
  });
});
