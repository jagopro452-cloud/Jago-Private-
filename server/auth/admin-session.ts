import crypto from "crypto";
import { db as rawDb } from "../db";
import { sql as rawSql } from "drizzle-orm";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 12;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

type AccessTokenPayload = {
  sub: string;
  role: string;
  deviceId: string;
  typ: "admin_access";
  iat: number;
  exp: number;
  jti: string;
};

type SessionContext = {
  deviceId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

let adminAuthSchemaReady: Promise<void> | null = null;

async function assertTableExists(tableName: string) {
  const result = await rawDb.execute(rawSql`
    SELECT to_regclass(${`public.${tableName}`}) AS table_name
  `);
  if (!(result.rows[0] as any)?.table_name) {
    throw new Error(`Missing required table "${tableName}". Apply SQL migrations before starting the API.`);
  }
}

async function ensureAdminAuthSchemaInner() {
  await assertTableExists("admin_sessions");
  await assertTableExists("admin_refresh_tokens");
}

async function ensureAdminAuthSchema() {
  if (!adminAuthSchemaReady) {
    adminAuthSchemaReady = ensureAdminAuthSchemaInner().catch((error) => {
      adminAuthSchemaReady = null;
      throw error;
    });
  }
  await adminAuthSchemaReady;
}

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
  return "dev-insecure-admin-secret-change-me";
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
  const expectedSignature = base64UrlEncode(
    crypto.createHmac("sha256", getJwtSecret()).update(`${headerPart}.${payloadPart}`).digest(),
  );
  if (!crypto.timingSafeEqual(Buffer.from(signaturePart), Buffer.from(expectedSignature))) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as AccessTokenPayload;
    if (payload.typ !== "admin_access") return null;
    if (!payload.sub || !payload.role || !payload.deviceId || !payload.exp || !payload.iat) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function createOpaqueToken(adminId: string, bytes = 48) {
  return `${adminId}:${crypto.randomBytes(bytes).toString("hex")}`;
}

async function findAdminRole(adminId: string) {
  await ensureAdminAuthSchema();
  const result = await rawDb.execute(rawSql`
    SELECT role
    FROM admins
    WHERE id=${adminId}::uuid
      AND is_active=true
    LIMIT 1
  `);
  return String((result.rows[0] as any)?.role || "").toLowerCase() || null;
}

async function createAdminSessionRecord(
  adminId: string,
  token: string,
  expiresAtIso: string,
  context: SessionContext,
) {
  await ensureAdminAuthSchema();
  const result = await rawDb.execute(rawSql`
    INSERT INTO admin_sessions (admin_id, token, device_id, ip_address, user_agent, expires_at, last_active_at)
    VALUES (
      ${adminId}::uuid,
      ${token},
      ${context.deviceId},
      ${context.ipAddress || null},
      ${context.userAgent || null},
      ${expiresAtIso}::timestamp,
      NOW()
    )
    RETURNING id
  `);
  return String((result.rows[0] as any).id);
}

async function createAdminRefreshTokenRecord(
  adminId: string,
  sessionId: string,
  token: string,
  expiresAtIso: string,
  context: SessionContext,
) {
  await ensureAdminAuthSchema();
  await rawDb.execute(rawSql`
    INSERT INTO admin_refresh_tokens (admin_id, session_id, token, device_id, ip_address, user_agent, expires_at, revoked)
    VALUES (
      ${adminId}::uuid,
      ${sessionId}::uuid,
      ${token},
      ${context.deviceId},
      ${context.ipAddress || null},
      ${context.userAgent || null},
      ${expiresAtIso}::timestamp,
      false
    )
  `);
}

async function findAdminSessionByToken(token: string) {
  await ensureAdminAuthSchema();
  const result = await rawDb.execute(rawSql`
    SELECT s.id, s.admin_id, s.device_id, s.expires_at, a.role
    FROM admin_sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.token=${token}
      AND s.revoked=false
      AND s.expires_at > NOW()
      AND a.is_active=true
    LIMIT 1
  `);
  return (result.rows[0] as any) || null;
}

async function findAdminRefreshToken(token: string) {
  await ensureAdminAuthSchema();
  const result = await rawDb.execute(rawSql`
    SELECT rt.id, rt.admin_id, rt.session_id, rt.token, rt.device_id, rt.expires_at, rt.revoked, a.is_active
    FROM admin_refresh_tokens rt
    JOIN admins a ON a.id = rt.admin_id
    WHERE rt.token=${token}
      AND rt.revoked=false
      AND rt.expires_at > NOW()
    LIMIT 1
  `);
  return (result.rows[0] as any) || null;
}

async function revokeAdminSessionById(sessionId: string) {
  await ensureAdminAuthSchema();
  await rawDb.execute(rawSql`
    UPDATE admin_sessions
    SET revoked=true, revoked_at=NOW()
    WHERE id=${sessionId}::uuid
      AND revoked=false
  `);
}

async function revokeAdminRefreshTokensBySession(sessionId: string) {
  await ensureAdminAuthSchema();
  await rawDb.execute(rawSql`
    UPDATE admin_refresh_tokens
    SET revoked=true, revoked_at=NOW()
    WHERE session_id=${sessionId}::uuid
      AND revoked=false
  `);
}

async function revokeAdminRefreshToken(token: string, replacedByToken?: string | null) {
  await ensureAdminAuthSchema();
  await rawDb.execute(rawSql`
    UPDATE admin_refresh_tokens
    SET revoked=true,
        revoked_at=NOW(),
        replaced_by_token=${replacedByToken || null}
    WHERE token=${token}
      AND revoked=false
  `);
}

async function touchAdminSession(token: string) {
  await ensureAdminAuthSchema();
  await rawDb.execute(rawSql`
    UPDATE admin_sessions
    SET last_active_at=NOW()
    WHERE token=${token}
      AND revoked=false
  `).catch(() => undefined);
}

export async function issueAdminSession(
  adminId: string,
  context: SessionContext,
) {
  const role = (await findAdminRole(adminId)) || "admin";
  const now = Math.floor(Date.now() / 1000);
  const accessPayload: AccessTokenPayload = {
    sub: adminId,
    role,
    deviceId: context.deviceId,
    typ: "admin_access",
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };
  const accessToken = signJwt(accessPayload);
  const accessExpiresAt = new Date(accessPayload.exp * 1000).toISOString();
  const sessionId = await createAdminSessionRecord(adminId, accessToken, accessExpiresAt, context);
  const refreshToken = createOpaqueToken(adminId);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
  await createAdminRefreshTokenRecord(adminId, sessionId, refreshToken, refreshExpiresAt, context);
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: accessExpiresAt,
    refreshTokenExpiresAt: refreshExpiresAt,
  };
}

export async function authenticateAdminAccessToken(token: string) {
  const payload = verifyJwt(token);
  if (!payload) return null;
  const session = await findAdminSessionByToken(token);
  if (!session) return null;
  if (String(session.admin_id || "") !== payload.sub) return null;
  if (String(session.role || "").toLowerCase() !== payload.role) return null;
  await touchAdminSession(token);
  return {
    adminId: payload.sub,
    role: payload.role,
    deviceId: payload.deviceId,
    sessionId: String(session.id),
  };
}

export async function refreshAdminSession(
  refreshToken: string,
  context: SessionContext,
) {
  const existing = await findAdminRefreshToken(refreshToken);
  if (!existing || existing.is_active === false) return null;
  const adminId = String(existing.admin_id || "");
  const role = await findAdminRole(adminId);
  if (!role) return null;
  await revokeAdminRefreshToken(refreshToken, null);
  await revokeAdminSessionById(String(existing.session_id));
  await revokeAdminRefreshTokensBySession(String(existing.session_id));
  return issueAdminSession(adminId, {
    deviceId: context.deviceId || String(existing.device_id || ""),
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

export async function revokeAdminSession(
  accessToken: string,
  refreshToken?: string | null,
) {
  const session = await findAdminSessionByToken(accessToken);
  if (!session) return;
  await revokeAdminSessionById(String(session.id));
  await revokeAdminRefreshTokensBySession(String(session.id));
  if (refreshToken) {
    await revokeAdminRefreshToken(refreshToken, null);
  }
}
