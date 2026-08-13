const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const nodeExec = process.execPath;
const playwrightCli = path.join(rootDir, "node_modules", "playwright", "cli.js");

const helperServers = [
  {
    name: "ui",
    url: process.env.PW_BASE_URL || "http://127.0.0.1:4173",
    entryPoint: "tests/playwright/support/web-server.ts",
    startupTimeoutMs: 120_000,
  },
  {
    name: "mock-api",
    url: `${process.env.PW_API_BASE_URL || `http://127.0.0.1:${process.env.PW_API_PORT || "4010"}`}/health`,
    entryPoint: "tests/playwright/support/mock-server.ts",
    startupTimeoutMs: 120_000,
  },
];

const children = [];
let cleanedUp = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnChild(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function waitForUrl(url, timeoutMs = 30_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if ((response.statusCode || 500) < 500) {
          resolve();
          return;
        }

        request.destroy();
        retry(new Error(`Unexpected status ${response.statusCode} for ${url}`));
      });

      request.on("error", retry);
      request.setTimeout(2_000, () => {
        request.destroy(new Error(`Timed out waiting for ${url}`));
      });
    };

    const retry = (error) => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(error);
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  await Promise.all(
    children.map((child) => {
      if (!child.pid) return Promise.resolve();
      if (process.platform === "win32") {
        return new Promise((resolve) => {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          killer.on("exit", () => resolve());
          killer.on("error", () => resolve());
        });
      }

      child.kill("SIGTERM");
      return Promise.resolve();
    }),
  );

  await wait(250);
}

async function main() {
  const playwrightArgs = process.argv.slice(2);
  const helperEnv = {
    PW_SKIP_WEB_SERVER: "true",
    PW_SKIP_MOCK_API: "true",
  };

  for (const server of helperServers) {
    spawnChild(nodeExec, ["--import", "tsx", server.entryPoint], helperEnv);
    await waitForUrl(server.url, server.startupTimeoutMs);
  }

  const playwright = spawnChild(nodeExec, [playwrightCli, ...playwrightArgs], helperEnv);
  const exitCode = await new Promise((resolve, reject) => {
    playwright.on("exit", (code) => resolve(code ?? 1));
    playwright.on("error", reject);
  });

  await cleanup();
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await cleanup();
    process.exit(1);
  });
}

main().catch(async (error) => {
  console.error("[run-playwright-local] failed", error);
  await cleanup();
  process.exit(1);
});
