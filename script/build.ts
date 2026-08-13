import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(command: string) {
  execSync(command, {
    stdio: "inherit",
    env: process.env,
  });
}

function readGitSha() {
  const fromEnv =
    process.env.GIT_SHA ||
    process.env.DEPLOYMENT_SHA ||
    process.env.SOURCE_COMMIT_HASH ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA;
  if (fromEnv?.trim()) return fromEnv.trim();
  try {
    return execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      env: process.env,
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

run("vite build");
run("esbuild server/index.ts --platform=node --bundle --format=esm --packages=external --define:process.env.NODE_ENV='\"production\"' --outfile=dist/index.js");

fs.mkdirSync(path.resolve("dist"), { recursive: true });
fs.writeFileSync(
  path.resolve("dist", "build-info.json"),
  JSON.stringify(
    {
      gitSha: readGitSha(),
      deploymentSha:
        process.env.DEPLOYMENT_SHA ||
        process.env.SOURCE_COMMIT_HASH ||
        process.env.GITHUB_SHA ||
        process.env.COMMIT_SHA ||
        readGitSha(),
      runningSha:
        process.env.RUNNING_SHA ||
        process.env.DEPLOYMENT_SHA ||
        process.env.SOURCE_COMMIT_HASH ||
        process.env.GITHUB_SHA ||
        process.env.COMMIT_SHA ||
        readGitSha(),
      deploymentId: process.env.DEPLOYMENT_ID || process.env.DO_DEPLOYMENT_ID || null,
      appEnv: process.env.APP_ENV || process.env.DEPLOY_ENV || process.env.NODE_ENV || null,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

const serverMigrationsSrc = path.resolve("server", "migrations");
const serverMigrationsDest = path.resolve("dist", "migrations");
const rootMigrationsSrc = path.resolve("migrations");
const rootMigrationsDest = path.resolve("dist", "drizzle-migrations");

if (fs.existsSync(serverMigrationsSrc)) {
  fs.rmSync(serverMigrationsDest, { recursive: true, force: true });
  fs.mkdirSync(serverMigrationsDest, { recursive: true });
  fs.cpSync(serverMigrationsSrc, serverMigrationsDest, { recursive: true });
}

if (fs.existsSync(rootMigrationsSrc)) {
  fs.mkdirSync(rootMigrationsDest, { recursive: true });
  fs.cpSync(rootMigrationsSrc, rootMigrationsDest, { recursive: true });
}

run("node script/sync-apks.js");
