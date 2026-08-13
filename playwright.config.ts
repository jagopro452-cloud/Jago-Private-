import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = configDir;
const envProfile = (process.env.PW_ENV || "").trim();
const liveAdminStorageStatePath = path.resolve(rootDir, "test-results", ".live", "admin-storage-state.json");

dotenv.config({ path: path.resolve(rootDir, ".env"), override: false });
dotenv.config({ path: path.resolve(rootDir, ".env.playwright"), override: false });
if (envProfile) {
  dotenv.config({ path: path.resolve(rootDir, `.env.${envProfile}`), override: true });
}
dotenv.config({ path: path.resolve(rootDir, ".env.playwright.local"), override: true });

const uiPort = Number(process.env.PW_UI_PORT || 4173);
const apiPort = Number(process.env.PW_API_PORT || 4010);
const baseURL = process.env.PW_BASE_URL || `http://127.0.0.1:${uiPort}`;
const apiBaseURL = process.env.PW_API_BASE_URL || `http://127.0.0.1:${apiPort}`;
const isCI = !!process.env.CI;
const useLiveBackend = process.env.PW_USE_LIVE_BACKEND === "true";
const shouldUseLocalUi = !useLiveBackend && process.env.PW_SKIP_WEB_SERVER !== "true";
const shouldUseMockApi = !useLiveBackend && process.env.PW_SKIP_MOCK_API !== "true";
const runWithTsxImport = (entryPoint: string) => `"${process.execPath}" --import tsx "${entryPoint}"`;

const webServer = [];
if (shouldUseLocalUi) {
  webServer.push({
    command: runWithTsxImport("tests/playwright/support/web-server.ts"),
    cwd: rootDir,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 240_000,
  });
}
if (shouldUseMockApi) {
  webServer.push({
    command: runWithTsxImport("tests/playwright/support/mock-server.ts"),
    cwd: rootDir,
    url: `${apiBaseURL}/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  });
}

export default defineConfig({
  testDir: "./tests/playwright/specs",
  globalSetup: useLiveBackend ? "./tests/playwright/support/live-global-setup.ts" : undefined,
  globalTeardown: useLiveBackend ? "./tests/playwright/support/live-global-teardown.ts" : undefined,
  fullyParallel: !useLiveBackend,
  forbidOnly: isCI,
  retries: useLiveBackend
    ? Number(process.env.PW_RETRIES || 0)
    : Number(process.env.PW_RETRIES || (isCI ? 2 : 1)),
  workers: process.env.PW_WORKERS
    ? Number(process.env.PW_WORKERS)
    : useLiveBackend
      ? 1
      : undefined,
  timeout: useLiveBackend ? 120_000 : 45_000,
  expect: {
    timeout: useLiveBackend ? 20_000 : 10_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "test-results/playwright-results.json" }],
  ],
  outputDir: "test-results/artifacts",
  use: {
    baseURL,
    extraHTTPHeaders: useLiveBackend
      ? undefined
      : {
          "x-jago-playwright-suite": "true",
        },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    testIdAttribute: "data-testid",
    headless: process.env.PW_HEADED === "true" ? false : !process.env.PW_DEBUG,
    ignoreHTTPSErrors: true,
    storageState: useLiveBackend ? liveAdminStorageStatePath : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer,
});
