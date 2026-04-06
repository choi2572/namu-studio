import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = __dirname;
const backendRoot = path.resolve(__dirname, "..", "backend");

const reuseExistingServer = !process.env.CI;

/**
 * E2E 기본 스택: mock_middleware(8000) + Flask 백엔드(SQLite, middleware 엔진) + Next.js(3000)
 * 사전 준비: `cd backend && pip install -r requirements.txt` (mock_middleware WebSocket은 flask-sock 필요)
 * 전략 문서: tests/spec_driven_e2e_testing_strategy.md
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      name: "mock-middleware",
      command: "python -m mock_middleware",
      cwd: backendRoot,
      url: "http://127.0.0.1:8000/api/v1/runner/status",
      reuseExistingServer,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe"
    },
    {
      name: "backend",
      command: "python run.py",
      cwd: backendRoot,
      url: "http://127.0.0.1:5000/api/capabilities/health",
      reuseExistingServer,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        REPO_BACKEND: "sqlite",
        DB_PATH: "./data/e2e-playwright.db",
        EXECUTION_ENGINE: "middleware",
        MIDDLEWARE_BASE_URL: "http://127.0.0.1:8000",
        SEED_DATA: "true",
        FLASK_USE_RELOADER: "false"
      }
    },
    {
      name: "frontend",
      command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
      cwd: frontendRoot,
      url: "http://127.0.0.1:3000",
      reuseExistingServer,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NEXT_PUBLIC_USE_MOCK_API: "false",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:5000/api",
        NEXT_PUBLIC_MIDDLEWARE_BASE_URL: "http://127.0.0.1:8000"
      }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
