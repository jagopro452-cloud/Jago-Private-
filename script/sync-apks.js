import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, "..", "public", "apks");
const DEST_DIR_DIST = path.join(__dirname, "..", "dist", "public", "apks");

function copyFile(src, dest) {
  try {
    fs.copyFileSync(src, dest);
    console.log(`[sync-apks] Success: ${path.basename(dest)} is now in ${path.dirname(dest)}`);
    return true;
  } catch (err) {
    console.error(`[sync-apks] failed to sync ${path.basename(src)}:`, err.message);
    return false;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[sync-apks] created ${dirPath}`);
  }
}

function parseVersion(fileName) {
  const match = fileName.match(/v(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return [0, 0, 0];
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return bv[i] - av[i];
  }
  return 0;
}

function isVersionedApk(fileName) {
  return /v\d+\.\d+\.\d+/i.test(fileName);
}

function findLatest(files, prefix) {
  return files
    .filter((file) => file.startsWith(prefix) && file.endsWith(".apk") && isVersionedApk(file))
    .sort(compareVersions)[0] ?? null;
}

function syncAPKs() {
  console.log("[sync-apks] starting");

  if (!fs.existsSync(SOURCE_DIR)) {
    console.log("[sync-apks] public/apks not found, skipping");
    return true;
  }

  ensureDir(DEST_DIR_DIST);

  const apkFiles = fs.readdirSync(SOURCE_DIR).filter((file) => file.endsWith(".apk"));
  if (apkFiles.length === 0) {
    console.log("[sync-apks] no apk files found");
    return true;
  }

  apkFiles.forEach((fileName) => {
    copyFile(path.join(SOURCE_DIR, fileName), path.join(DEST_DIR_DIST, fileName));
  });

  const customerLatest = findLatest(apkFiles, "jago-customer-");
  const driverLatest = findLatest(apkFiles, "jago-driver-");
  const pilotLatest = findLatest(apkFiles, "jago-pilot-");
  const aliases = [
    { source: customerLatest, alias: "jago-customer-latest.apk" },
    { source: driverLatest, alias: "jago-driver-latest.apk" },
    { source: pilotLatest, alias: "jago-pilot-latest.apk" },
  ];

  aliases.forEach(({ source, alias }) => {
    const explicitLatest = path.join(SOURCE_DIR, alias);
    if (fs.existsSync(explicitLatest)) {
      copyFile(explicitLatest, path.join(DEST_DIR_DIST, alias));
      return;
    }
    if (source) copyFile(path.join(SOURCE_DIR, source), path.join(DEST_DIR_DIST, alias));
  });

  const status = {
    customer: fs.existsSync(path.join(DEST_DIR_DIST, "jago-customer-latest.apk")),
    driver: fs.existsSync(path.join(DEST_DIR_DIST, "jago-driver-latest.apk")),
    pilot: fs.existsSync(path.join(DEST_DIR_DIST, "jago-pilot-latest.apk")),
  };

  console.log("[sync-apks] latest aliases", status);
  return true;
}

syncAPKs();
