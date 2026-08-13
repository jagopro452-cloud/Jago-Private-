import { sendCustomSms } from "../sms";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { AuthApiError } from "./auth.errors";
import {
  createOtpUser,
  deleteOtpCode,
  findLatestOtpCode,
  findUserByOtpPhone,
  incrementOtpAttempts,
  replaceOtpCode,
} from "./otp.repo";
import { countDistinctOtpPhonesForDevice, insertOtpRequestEvent, tryInsertOtpAttemptAtomic } from "./session.repo";

type IssueSession = (
  userId: string,
  context: { deviceId: string; ipAddress?: string | null; userAgent?: string | null },
  options?: { allowDeviceReset?: boolean },
) => Promise<{
  accessToken: string;
  refreshToken: string;
}>;

type SendOtpInput = {
  phone?: string;
  countryCode?: string;
  userType?: string;
  deviceId?: string;
};

type VerifyOtpInput = {
  phone?: string;
  countryCode?: string;
  otp?: string;
  userType?: string;
  name?: string;
  deviceId?: string;
};

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS = 3;
const OTP_REQUEST_WINDOW_MINUTES = 15;
const FAILURE_DELAY_MS = 400;

function logOtp(level: "info" | "error", event: string, data: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  const line = `[AUTH-OTP] ${JSON.stringify(payload)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  console.info(line);
}

function normalizePhone(phone?: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeCountryCode(countryCode?: string): string {
  const cleaned = String(countryCode || "+91").replace(/[^\d+]/g, "");
  if (!cleaned) return "+91";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function normalizeUserType(userType?: string): string {
  const normalized = String(userType || "customer").trim().toLowerCase();
  return normalized === "driver" ? "driver" : "customer";
}

// ── Dev-mode fixed OTP ───────────────────────────────────────────────────
// Lets testers log in with a predictable code (default "1234") instead of
// reading real SMS while Firebase Phone Auth isn't wired up yet. Off by
// default in production unless DEV_MODE is explicitly set to "true" — an
// operator has to opt in on a production box, it never turns on by itself.
// To integrate Firebase later: verify the Firebase ID token here instead of
// generateOtp()/hash comparison — the find-or-create-user and
// session-issue logic below stays unchanged.
export function isDevOtpEnabled(): boolean {
  const explicit = String(process.env.DEV_MODE ?? "").trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  // No explicit DEV_MODE set: default on everywhere except production.
  return String(process.env.NODE_ENV || "").trim() !== "production";
}

function getDevOtp(): string {
  return String(process.env.DEV_OTP || "1234").trim();
}

function generateOtp(): string {
  if (isDevOtpEnabled()) return getDevOtp();
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function formatUser(user: Awaited<ReturnType<typeof findUserByOtpPhone>> | Awaited<ReturnType<typeof createOtpUser>>) {
  return {
    id: user!.id,
    phone: user!.phone,
    fullName: user!.fullName,
    email: user!.email,
    userType: user!.userType,
    profilePhoto: user!.profilePhoto,
    rating: user!.rating,
    isActive: user!.isActive,
    isLocked: user!.isLocked,
    lockReason: user!.lockReason,
  };
}

async function slowFailure() {
  await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
}

export async function sendOtpService(input: SendOtpInput) {
  return sendOtpServiceWithMeta(input);
}

export async function sendOtpServiceWithMeta(
  input: SendOtpInput,
  requestMeta: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const phone = normalizePhone(input.phone);
  const countryCode = normalizeCountryCode(input.countryCode);
  const userType = normalizeUserType(input.userType);
  const deviceId = String(input.deviceId || "").trim();

  logOtp("info", "OTP_SEND_ATTEMPT", {
    phone,
    countryCode,
    userType,
    deviceId,
  });

  if (!phone) {
    throw new AuthApiError(400, "INVALID_INPUT", "Phone required");
  }
  if (phone.length !== 10) {
    throw new AuthApiError(400, "INVALID_INPUT", "Invalid phone number");
  }
  if (!deviceId) {
    throw new AuthApiError(400, "INVALID_INPUT", "Device ID required");
  }

  // Device-level check first (counts distinct phones attempted from this device)
  // Skipped in dev mode — testers repeatedly cycling through numbers against
  // the fixed OTP shouldn't get device-flagged the way real abuse would.
  const recentDistinctPhones = await countDistinctOtpPhonesForDevice(deviceId, OTP_REQUEST_WINDOW_MINUTES);
  if (recentDistinctPhones >= 5 && !isDevOtpEnabled()) {
    await insertOtpRequestEvent({
      phone, countryCode, deviceId,
      ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent,
      userType, eventType: "send", outcome: "DEVICE_FLAGGED",
    });
    logOtp("error", "OTP_FAIL", { phone, countryCode, userType, deviceId, reason: "TOO_MANY_REQUESTS", suspicious: true });
    throw new AuthApiError(429, "TOO_MANY_REQUESTS", "Please try again later");
  }

  // Atomic per-phone rate limit check + event insert in one SQL statement (no TOCTOU race).
  // Still recorded in dev mode (useful for observability), just not enforced —
  // testers repeatedly re-sending OTPs to the same number during a debugging
  // session shouldn't get locked out the way real abuse would.
  const { allowed, currentCount } = await tryInsertOtpAttemptAtomic({
    phone,
    countryCode,
    deviceId,
    ipAddress: requestMeta.ipAddress,
    userAgent: requestMeta.userAgent,
    userType,
    maxRequests: OTP_MAX_REQUESTS,
    windowMinutes: OTP_REQUEST_WINDOW_MINUTES,
  });
  if (!allowed && !isDevOtpEnabled()) {
    await insertOtpRequestEvent({
      phone, countryCode, deviceId,
      ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent,
      userType, eventType: "send", outcome: "TOO_MANY_REQUESTS",
    });
    logOtp("error", "OTP_FAIL", { phone, countryCode, userType, reason: "TOO_MANY_REQUESTS", currentCount });
    throw new AuthApiError(429, "TOO_MANY_REQUESTS", "Please try again later");
  }
  // OTP_ATTEMPT event already inserted atomically above — SMS failures also consume the slot

  const otp = generateOtp();
  const otpHash = await hashPassword(otp);

  await replaceOtpCode({
    phone,
    countryCode,
    otpHash,
    expiresInSeconds: Math.floor(OTP_EXPIRY_MS / 1000),
    maxAttempts: OTP_MAX_ATTEMPTS,
  });

  const smsSent = await sendCustomSms(
    phone,
    `Your JAGO OTP is ${otp}. It is valid for 5 minutes. Do not share it.`,
    { purpose: `${userType}_login`, userType },
  );

  if (!smsSent) {
    // Mark the pre-inserted attempt as failed delivery so ops can distinguish outage from abuse
    await insertOtpRequestEvent({
      phone, countryCode, deviceId,
      ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent,
      userType, eventType: "send", outcome: "SERVER_ERROR",
    });
    logOtp("error", "OTP_FAIL", { phone, countryCode, userType, reason: "SERVER_ERROR" });
    throw new AuthApiError(503, "SERVER_ERROR", "OTP delivery unavailable");
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(`[OTP-DEV] ${phone} -> ${otp}`);
  }

  logOtp("info", "OTP_SENT", {
    phone,
    countryCode,
    userType,
    deviceId,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS).toISOString(),
  });

  return {
    success: true,
    message: "OTP sent",
  };
}

export async function verifyOtpService(
  input: VerifyOtpInput,
  issueSession: IssueSession,
  requestMeta: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const phone = normalizePhone(input.phone);
  const countryCode = normalizeCountryCode(input.countryCode);
  const userType = normalizeUserType(input.userType);
  const otp = String(input.otp || "").trim();
  const deviceId = String(input.deviceId || "").trim();

  logOtp("info", "OTP_VERIFY_ATTEMPT", {
    phone,
    countryCode,
    userType,
  });

  if (!phone || !otp) {
    throw new AuthApiError(400, "INVALID_INPUT", "Phone and OTP required");
  }
  if (phone.length !== 10 || otp.length < 4 || otp.length > 6) {
    throw new AuthApiError(400, "INVALID_INPUT", "Invalid phone number or OTP");
  }
  if (!deviceId) {
    throw new AuthApiError(400, "INVALID_INPUT", "Device ID required");
  }

  const otpRecord = await findLatestOtpCode({ phone, countryCode });
  if (!otpRecord) {
    await slowFailure();
    await insertOtpRequestEvent({
      phone,
      countryCode,
      deviceId,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      userType,
      eventType: "verify",
      outcome: "INVALID_OTP",
    });
    logOtp("error", "OTP_FAIL", {
      phone,
      countryCode,
      userType,
      reason: "INVALID_OTP",
    });
    throw new AuthApiError(400, "INVALID_OTP", "Invalid OTP");
  }

  if (otpRecord.expiresAt.getTime() <= Date.now()) {
    await deleteOtpCode(otpRecord.id);
    await slowFailure();
    await insertOtpRequestEvent({
      phone,
      countryCode,
      deviceId,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      userType,
      eventType: "verify",
      outcome: "OTP_EXPIRED",
    });
    logOtp("error", "OTP_FAIL", {
      phone,
      countryCode,
      userType,
      reason: "OTP_EXPIRED",
    });
    throw new AuthApiError(400, "OTP_EXPIRED", "OTP expired");
  }

  if (otpRecord.attempts >= otpRecord.maxAttempts && !isDevOtpEnabled()) {
    await slowFailure();
    await insertOtpRequestEvent({
      phone,
      countryCode,
      deviceId,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      userType,
      eventType: "verify",
      outcome: "TOO_MANY_ATTEMPTS",
    });
    logOtp("error", "OTP_FAIL", {
      phone,
      countryCode,
      userType,
      reason: "TOO_MANY_ATTEMPTS",
    });
    throw new AuthApiError(429, "TOO_MANY_ATTEMPTS", "Too many attempts");
  }

  const valid = await verifyPassword(otp, otpRecord.otpHash);
  if (!valid) {
    await incrementOtpAttempts(otpRecord.id);
    await slowFailure();
    await insertOtpRequestEvent({
      phone,
      countryCode,
      deviceId,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      userType,
      eventType: "verify",
      outcome: "INVALID_OTP",
    });
    logOtp("error", "OTP_FAIL", {
      phone,
      countryCode,
      userType,
      reason: "INVALID_OTP",
    });
    throw new AuthApiError(400, "INVALID_OTP", "Invalid OTP");
  }

  await deleteOtpCode(otpRecord.id);

  let user = await findUserByOtpPhone({ phone, userType });
  let isNewUser = false;
  if (!user) {
    // Driver accounts require the full KYC onboarding wizard (license,
    // vehicle docs, selfie) — OTP login must never silently create a bare
    // driver record. Customers have no such requirement, so phone + OTP is
    // enough to stand up an account (mirrors the "find or create" flow the
    // product asked for).
    if (userType === "driver") {
      await slowFailure();
      await insertOtpRequestEvent({
        phone,
        countryCode,
        deviceId,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
        userType,
        eventType: "verify",
        outcome: "USER_NOT_FOUND",
      });
      logOtp("error", "OTP_FAIL", {
        phone,
        countryCode,
        userType,
        reason: "USER_NOT_FOUND",
      });
      throw new AuthApiError(404, "USER_NOT_FOUND", "No driver account found for this number. Please complete registration first.");
    }
    user = await createOtpUser({
      phone,
      userType,
      fullName: input.name,
    });
    isNewUser = true;
  }

  const session = await issueSession(user.id, {
    deviceId,
    ipAddress: requestMeta.ipAddress,
    userAgent: requestMeta.userAgent,
  }, {
    allowDeviceReset: true,
  });

  logOtp("info", "OTP_SUCCESS", {
    phone,
    countryCode,
    userType,
    userId: user.id,
    deviceId,
  });
  await insertOtpRequestEvent({
    phone,
    countryCode,
    deviceId,
    ipAddress: requestMeta.ipAddress,
    userAgent: requestMeta.userAgent,
    userType,
    eventType: "verify",
    outcome: "OTP_SUCCESS",
  });

  return {
    success: true,
    isNewUser,
    token: session.accessToken,
    refreshToken: session.refreshToken,
    user: formatUser(user),
  };
}
