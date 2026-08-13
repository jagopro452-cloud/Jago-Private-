import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { io as createSocketClient } from "socket.io-client";

const root = process.cwd();
const port = Number(process.env.AUTH_MATRIX_PORT || 5055);
const baseUrl = `http://127.0.0.1:${port}`;
const logPath = path.join(root, "tmp-auth-server.log");
const errPath = path.join(root, "tmp-auth-server.err.log");

let serverProcess = null;

function clearFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

async function http(method, route, body, token) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = { success: false, code: "NON_JSON_RESPONSE", message: await response.text() };
  }
  return {
    status: response.status,
    ok: response.ok,
    body: parsed,
  };
}

async function post(route, body, token) {
  return http("POST", route, body, token);
}

async function get(route, token) {
  return http("GET", route, null, token);
}

async function waitForHealth() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const data = await response.json();
      if (response.ok && data?.status === "ok") return;
    } catch {}
    await delay(1000);
  }
  throw new Error("Server failed health check after start");
}

async function startServer() {
  clearFile(logPath);
  clearFile(errPath);
  serverProcess = spawn("node", ["dist/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      AUTH_DEV_CONSOLE_SMS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serverProcess.stdout.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
  serverProcess.stderr.on("data", (chunk) => fs.appendFileSync(errPath, chunk));
  await waitForHealth();
}

async function stopServer() {
  if (!serverProcess) return;
  if (!serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await delay(1500);
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  }
  serverProcess = null;
}

async function seedUser() {
  await runCommand("npm.cmd", ["run", "seed:test-user"]);
}

async function expireLatestOtp() {
  throw new Error("Phone argument required for expireLatestOtp");
}

async function runCommand(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
  return { stdout, stderr };
}

async function readOtp(phone) {
  const deadline = Date.now() + 10_000;
  const regex = new RegExp(`(?:\\[SMS-DEV\\].*?${phone}:.*?(\\d{6})|\\[OTP-DEV\\]\\s+${phone}\\s+->\\s+(\\d{6}))`);
  while (Date.now() < deadline) {
    const log = readText(logPath);
    const lines = log.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        return match[1] || match[2];
      }
    }
    await delay(250);
  }
  throw new Error(`OTP not found in log for ${phone}`);
}

function pick(result) {
  return {
    status: result.status,
    success: result.body?.success ?? null,
    code: result.body?.code ?? null,
    message: result.body?.message ?? null,
  };
}

function protectedResult(result) {
  return {
    status: result.status,
    authorized: result.status === 200,
    success: result.body?.success ?? null,
    code: result.body?.code ?? null,
    message: result.body?.message ?? null,
  };
}

async function main() {
  const results = {};
  const phone = "9999999999";
  const countryCode = "+91";
  const password = String(process.env.SEED_TEST_USER_PASSWORD || "").trim();
  if (!password) {
    throw new Error("SEED_TEST_USER_PASSWORD is required");
  }
  const deviceA = "dev-A-auth";
  const deviceB = "dev-B-auth";
  const wrongDevice = "dev-wrong-otp";
  const expiredDevice = "dev-expired-otp";
  const attemptsDevice = "dev-attempts-otp";
  const multiDevice = "dev-multi-otp";
  const secondDevicePrimary = "dev-second-otp-a";
  const secondDeviceSecondary = "dev-second-otp-b";
  const runSeed = String(Date.now()).slice(-5);
  const makePhone = (prefix) => `${prefix}${runSeed}`.slice(0, 10);

  try {
    await seedUser();
    await startServer();

    const primeSend = await post("/auth/send-otp", { phone, countryCode, deviceId: deviceA });
    const primeOtp = await readOtp(phone);
    const primeVerify = await post("/auth/verify-otp", { phone, countryCode, otp: primeOtp, deviceId: deviceA });
    const primeLogout = await post("/auth/logout", {}, primeVerify.body.token);
    results.prime = { send: primeSend.body.success, verify: primeVerify.body.success, logout: primeLogout.body.success };

    const passwordSuccess = await post("/api/app/login-password", {
      phone,
      countryCode,
      password,
      deviceId: deviceA,
      userType: "customer",
    });
    results.password_success = pick(passwordSuccess);

    const wrongPassword = await post("/api/app/login-password", {
      phone,
      countryCode,
      password: "Wrong@123",
      deviceId: deviceA,
      userType: "customer",
    });
    results.password_wrong = pick(wrongPassword);

    const secondDevicePassword = await post("/api/app/login-password", {
      phone,
      countryCode,
      password,
      deviceId: deviceB,
      userType: "customer",
    });
    results.password_second_device = pick(secondDevicePassword);

    const passwordProfile = await get("/api/app/customer/profile", passwordSuccess.body.token);
    results.password_profile = protectedResult(passwordProfile);

    const passwordRefresh = await post("/api/app/auth/refresh", { deviceId: deviceA }, passwordSuccess.body.refreshToken);
    results.password_refresh = pick(passwordRefresh);

    const passwordRefreshReuse = await post("/api/app/auth/refresh", { deviceId: deviceA }, passwordSuccess.body.refreshToken);
    results.password_refresh_reuse = pick(passwordRefreshReuse);

    const otpSend = await post("/auth/send-otp", { phone, countryCode, deviceId: deviceA });
    const otpValue = await readOtp(phone);
    const otpVerify = await post("/auth/verify-otp", { phone, countryCode, otp: otpValue, deviceId: deviceA });
    results.otp_success = pick(otpVerify);

    const otpProfileBeforeRefresh = await get("/api/app/customer/profile", otpVerify.body.token);
    results.otp_profile_before_refresh = protectedResult(otpProfileBeforeRefresh);

    const otpRefresh = await post("/api/app/auth/refresh", { deviceId: deviceA }, otpVerify.body.refreshToken);
    results.otp_refresh = pick(otpRefresh);

    const otpProfile = await get("/api/app/customer/profile", otpRefresh.body.accessToken);
    results.otp_profile_after_refresh = protectedResult(otpProfile);

    const otpLogout = await post("/auth/logout", {}, otpRefresh.body.accessToken);
    results.otp_logout = pick(otpLogout);

    const afterLogout = await get("/api/app/customer/profile", otpRefresh.body.accessToken);
    results.after_logout = protectedResult(afterLogout);

    const wrongPhone = makePhone("88888");
    await post("/auth/send-otp", { phone: wrongPhone, countryCode, deviceId: wrongDevice });
    const wrongOtp = await post("/auth/verify-otp", { phone: wrongPhone, countryCode, otp: "000000", deviceId: wrongDevice });
    results.otp_wrong = pick(wrongOtp);

    const expiredPhone = makePhone("88887");
    await post("/auth/send-otp", { phone: expiredPhone, countryCode, deviceId: expiredDevice });
    const expiredOtp = await readOtp(expiredPhone);
    await runCommand("npm.cmd", ["run", "otp:expire", "--", expiredPhone, countryCode]);
    const expiredResult = await post("/auth/verify-otp", { phone: expiredPhone, countryCode, otp: expiredOtp, deviceId: expiredDevice });
    results.otp_expired = pick(expiredResult);

    const attemptsPhone = makePhone("88886");
    await post("/auth/send-otp", { phone: attemptsPhone, countryCode, deviceId: attemptsDevice });
    const attemptCodes = [];
    for (let i = 0; i < 6; i += 1) {
      const attemptResult = await post("/auth/verify-otp", { phone: attemptsPhone, countryCode, otp: "111111", deviceId: attemptsDevice });
      attemptCodes.push(attemptResult.body.code || null);
    }
    results.otp_too_many_attempts = attemptCodes;

    const multiPhone = makePhone("88885");
    results.otp_multiple_requests = [];
    for (let i = 0; i < 4; i += 1) {
      const multiResult = await post("/auth/send-otp", { phone: multiPhone, countryCode, deviceId: multiDevice });
      results.otp_multiple_requests.push(pick(multiResult));
    }

    const secondDevicePhone = makePhone("88884");
    await post("/auth/send-otp", { phone: secondDevicePhone, countryCode, deviceId: secondDevicePrimary });
    const secondOtpA = await readOtp(secondDevicePhone);
    const secondVerifyA = await post("/auth/verify-otp", { phone: secondDevicePhone, countryCode, otp: secondOtpA, deviceId: secondDevicePrimary });
    await post("/auth/send-otp", { phone: secondDevicePhone, countryCode, deviceId: secondDeviceSecondary });
    const secondOtpB = await readOtp(secondDevicePhone);
    const secondVerifyB = await post("/auth/verify-otp", { phone: secondDevicePhone, countryCode, otp: secondOtpB, deviceId: secondDeviceSecondary });
    results.otp_second_device = pick(secondVerifyB);
    const oldDeviceAfterReset = await get("/api/app/customer/profile", secondVerifyA.body.token);
    results.otp_old_device_after_reset = protectedResult(oldDeviceAfterReset);

    const restartSend = await post("/auth/send-otp", { phone, countryCode, deviceId: deviceA });
    const restartOtp = await readOtp(phone);
    const restartVerify = await post("/auth/verify-otp", { phone, countryCode, otp: restartOtp, deviceId: deviceA });
    const restartToken = restartVerify.body.token;
    results.restart_login = pick(restartVerify);
    await stopServer();
    await delay(2000);
    await startServer();
    const afterRestart = await get("/api/app/customer/profile", restartToken);
    results.session_persists_after_restart = protectedResult(afterRestart);

    const socketUserId = restartVerify.body.user?.id;
    results.socket_valid = await socketAttempt({
      token: restartToken,
      userId: socketUserId,
      userType: "customer",
    });
    results.socket_invalid = await socketAttempt({
      token: "invalid-token",
      userId: socketUserId,
      userType: "customer",
    });
    results.socket_revoked = await socketAttempt({
      token: otpRefresh.body.accessToken,
      userId: otpVerify.body.user?.id,
      userType: "customer",
    });

    console.log(JSON.stringify(results, null, 2));
    console.log("---SERVER_LOG_TAIL---");
    console.log(readText(logPath).split(/\r?\n/).slice(-60).join("\n"));
    console.log("---SERVER_ERR_TAIL---");
    console.log(readText(errPath).split(/\r?\n/).slice(-60).join("\n"));
  } finally {
    await stopServer();
  }
}

async function socketAttempt({ token, userId, userType }) {
  return new Promise((resolve) => {
    const events = [];
    let settled = false;
    const socket = createSocketClient(baseUrl, {
      transports: ["websocket"],
      autoConnect: true,
      reconnection: false,
      timeout: 4000,
      query: {
        userId,
        userType,
        token,
      },
      auth: {
        token,
      },
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.disconnect(); } catch {}
      resolve({
        ...result,
        events,
      });
    };

    socket.on("connect", () => {
      events.push("connect");
      setTimeout(() => finish({ connected: true }), 800);
    });
    socket.on("auth:error", (payload) => {
      events.push(`auth:error:${payload?.message || "unknown"}`);
      finish({ connected: false, code: "UNAUTHORIZED" });
    });
    socket.on("disconnect", (reason) => {
      events.push(`disconnect:${reason}`);
      if (!settled) finish({ connected: false, code: reason || "DISCONNECTED" });
    });
    socket.on("connect_error", (err) => {
      events.push(`connect_error:${err?.message || "unknown"}`);
      finish({ connected: false, code: "CONNECT_ERROR" });
    });

    setTimeout(() => finish({ connected: false, code: "TIMEOUT" }), 5000);
  });
}

main().catch(async (error) => {
  console.error(String(error?.stack || error));
  console.error("---SERVER_LOG_TAIL---");
  console.error(readText(logPath).split(/\r?\n/).slice(-80).join("\n"));
  console.error("---SERVER_ERR_TAIL---");
  console.error(readText(errPath).split(/\r?\n/).slice(-80).join("\n"));
  await stopServer();
  process.exitCode = 1;
});
