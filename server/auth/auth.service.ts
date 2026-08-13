import { verifyPassword } from "../utils/crypto";
import { AuthApiError } from "./auth.errors";
import { findUserByPhoneForLogin } from "./user.repo";

type LoginInput = {
  phone?: string;
  password?: string;
  countryCode?: string;
  userType?: string;
  deviceId?: string;
};

type SessionIssuer = (
  userId: string,
  context: { deviceId: string; ipAddress?: string | null; userAgent?: string | null },
  options?: { allowDeviceReset?: boolean },
) => Promise<{
  accessToken: string;
  refreshToken: string;
}>;

function logAuth(level: "info" | "error", event: string, data: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  const line = `[AUTH] ${JSON.stringify(payload)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  console.info(line);
}

export async function loginWithPasswordService(
  input: LoginInput,
  issueSession: SessionIssuer,
  requestMeta: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const phone = String(input.phone || "").trim();
  const password = String(input.password || "");
  const countryCode = String(input.countryCode || "+91").trim();
  const userType = String(input.userType || "customer").trim().toLowerCase();
  const deviceId = String(input.deviceId || "").trim();

  logAuth("info", "LOGIN_ATTEMPT", {
    phone,
    countryCode,
    userType,
  });

  if (!phone || !password) {
    throw new AuthApiError(400, "INVALID_INPUT", "Phone and password required");
  }
  if (!deviceId) {
    throw new AuthApiError(400, "INVALID_INPUT", "Device ID required");
  }

  const user = await findUserByPhoneForLogin({ phone, countryCode, userType });
  logAuth("info", "LOGIN_USER_FETCH", {
    phone,
    countryCode,
    userType,
    found: !!user,
  });

  if (!user) {
    logAuth("error", "LOGIN_FAIL", {
      phone,
      countryCode,
      userType,
      reason: "USER_NOT_FOUND",
    });
    throw new AuthApiError(404, "USER_NOT_FOUND", "User not found");
  }

  if (!user.isActive || user.isLocked) {
    logAuth("error", "LOGIN_FAIL", {
      phone,
      countryCode,
      userType,
      userId: user.id,
      reason: "ACCOUNT_BLOCKED",
      lockReason: user.lockReason,
    });
    throw new AuthApiError(403, "ACCOUNT_BLOCKED", user.lockReason || "Account blocked");
  }

  if (!user.passwordHash) {
    logAuth("error", "LOGIN_FAIL", {
      phone,
      countryCode,
      userType,
      userId: user.id,
      reason: "PASSWORD_NOT_SET",
    });
    throw new AuthApiError(400, "PASSWORD_NOT_SET", "Password not set. Please use Forgot Password to set one.");
  }

  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    logAuth("error", "LOGIN_FAIL", {
      phone,
      countryCode,
      userType,
      userId: user.id,
      reason: "INVALID_PASSWORD",
    });
    throw new AuthApiError(401, "INVALID_PASSWORD", "Invalid password");
  }

  const session = await issueSession(user.id, {
    deviceId,
    ipAddress: requestMeta.ipAddress,
    userAgent: requestMeta.userAgent,
  });
  logAuth("info", "LOGIN_SUCCESS", {
    phone,
    countryCode,
    userType,
    userId: user.id,
  });

  return {
    success: true,
    token: session.accessToken,
    refreshToken: session.refreshToken,
    user: {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      email: user.email,
      userType: user.userType,
      profilePhoto: user.profilePhoto,
      rating: user.rating,
      isActive: user.isActive,
      isLocked: user.isLocked,
      lockReason: user.lockReason,
    },
  };
}
