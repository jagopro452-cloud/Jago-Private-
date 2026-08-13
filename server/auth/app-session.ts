import crypto from "crypto";
import { db as rawDb } from "../db";
import { sql as rawSql } from "drizzle-orm";
import {
  createOpaqueToken,
  createRefreshTokenRecord,
  createSessionRecord,
  findRefreshToken,
  findSessionByToken,
  revokeRefreshToken,
  revokeRefreshTokensBySession,
  revokeSessionById,
  touchSession,
} from "./session.repo";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 12;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

type AccessTokenPayload = {
  sub: string;
  userType: string;
  deviceId: string;
  typ: "access";
  iat: number;
  exp: number;
  jti: string;
};

type SessionContext = {
  deviceId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function getJwtSecret() {
  const secret = String(process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || "").trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_JWT_SECRET or JWT_SECRET is required in production");
  }
  return "dev-insecure-auth-secret-change-me";
}

function signJwt(payload: AccessTokenPayload) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = crypto
    .createHmac("sha256", getJwtSecret())
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function verifyJwt(token: string): AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSignature = base64UrlEncode(
    crypto.createHmac("sha256", getJwtSecret()).update(signingInput).digest(),
  );
  if (!crypto.timingSafeEqual(Buffer.from(signaturePart), Buffer.from(expectedSignature))) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as AccessTokenPayload;
    if (payload.typ !== "access") return null;
    if (!payload.sub || !payload.userType || !payload.deviceId || !payload.exp || !payload.iat) {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function lookupUserType(userId: string) {
  const result = await rawDb.execute(rawSql`
    SELECT user_type FROM users WHERE id=${userId}::uuid AND is_active=true LIMIT 1
  `);
  return String((result.rows[0] as any)?.user_type || "").toLowerCase() || null;
}

export async function issueAppSession(
  userId: string,
  userType: string,
  context: SessionContext,
) {
  const now = Math.floor(Date.now() / 1000);
  const accessPayload: AccessTokenPayload = {
    sub: userId,
    userType,
    deviceId: context.deviceId,
    typ: "access",
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };
  const accessToken = signJwt(accessPayload);
  const accessExpiresAt = new Date(accessPayload.exp * 1000).toISOString();
  const sessionId = await createSessionRecord(userId, accessToken, accessExpiresAt, context);
  const refreshToken = createOpaqueToken(userId, 48);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
  await createRefreshTokenRecord(userId, sessionId, refreshToken, refreshExpiresAt, context);
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: accessExpiresAt,
    refreshTokenExpiresAt: refreshExpiresAt,
  };
}

export async function authenticateAppAccessToken(token: string) {
  const payload = verifyJwt(token);
  if (!payload) return null;
  const session = await findSessionByToken(token);
  if (!session) return null;
  if (String(session.user_type || "").toLowerCase() !== payload.userType) return null;
  if (String(session.user_id || "") !== payload.sub) return null;
  await touchSession(token);
  return {
    userId: payload.sub,
    userType: payload.userType,
    deviceId: payload.deviceId,
    sessionId: String(session.id),
  };
}

export async function refreshAppSession(
  refreshToken: string,
  context: SessionContext,
) {
  const existing = await findRefreshToken(refreshToken);
  if (!existing || existing.is_active === false) return null;
  const userId = String(existing.user_id || "");
  const userType = await lookupUserType(userId);
  if (!userType) return null;
  await revokeRefreshToken(refreshToken, null);
  await revokeSessionById(String(existing.session_id));
  await revokeRefreshTokensBySession(String(existing.session_id));
  return issueAppSession(userId, userType, {
    deviceId: context.deviceId || String(existing.device_id || ""),
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

export async function revokeAppSession(
  accessToken: string,
  refreshToken?: string | null,
) {
  const session = await findSessionByToken(accessToken);
  if (!session) return;
  await revokeSessionById(String(session.id));
  await revokeRefreshTokensBySession(String(session.id));
  if (refreshToken) {
    await revokeRefreshToken(refreshToken, null);
  }
}
