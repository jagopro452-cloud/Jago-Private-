import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright/specs",
  fullyParallel: true,
  retries: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "test-results/playwright-results.json" }],
  ],
  outputDir: "test-results/artifacts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    extraHTTPHeaders: { "x-jago-playwright-suite": "true" },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 20000,
    testIdAttribute: "data-testid",
    headless: true,
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `"${process.execPath}" --import tsx "tests/playwright/support/web-server.ts"`,
      cwd: process.cwd(),
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 240000,
    },
    {
      command: `"${process.execPath}" --import tsx "tests/playwright/support/mock-server.ts"`,
      cwd: process.cwd(),
      url: "http://127.0.0.1:4010/health",
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
