import { db } from "../db";
import { sql } from "drizzle-orm";

const rawDb = db;
const rawSql = sql;

export type OtpCodeRecord = {
  id: string;
  phone: string;
  countryCode: string;
  otpHash: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
};

export type OtpUserRecord = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  userType: string;
  isActive: boolean;
  isLocked: boolean;
  lockReason: string | null;
  profilePhoto: string | null;
  rating: number;
};

function normalizePhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeCountryCode(countryCode?: string): string {
  const digits = String(countryCode || "+91").replace(/[^\d+]/g, "");
  if (!digits) return "+91";
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function mapOtpRow(row: any): OtpCodeRecord {
  return {
    id: String(row.id),
    phone: String(row.phone),
    countryCode: String(row.country_code || "+91"),
    otpHash: String(row.otp_hash),
    expiresAt: new Date(row.expires_at),
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 5),
    createdAt: new Date(row.created_at),
  };
}

function mapUserRow(row: any): OtpUserRecord {
  return {
    id: String(row.id),
    phone: String(row.phone || ""),
    fullName: row.full_name ? String(row.full_name) : null,
    email: row.email ? String(row.email) : null,
    userType: String(row.user_type || "customer"),
    isActive: !!row.is_active,
    isLocked: !!row.is_locked,
    lockReason: row.lock_reason ? String(row.lock_reason) : null,
    profilePhoto: row.profile_photo ? String(row.profile_photo) : null,
    rating: Number(row.rating || 5),
  };
}

export async function countRecentOtpRequests(params: {
  phone: string;
  countryCode?: string;
  sinceMinutes: number;
}): Promise<number> {
  const phone = normalizePhone(params.phone);
  const countryCode = normalizeCountryCode(params.countryCode);
  const res = await rawDb.execute(rawSql`
    SELECT COUNT(*) AS cnt
    FROM otp_codes
    WHERE phone=${phone}
      AND country_code=${countryCode}
      AND created_at > NOW() - (${params.sinceMinutes} * INTERVAL '1 minute')
  `);
  return Number((res.rows[0] as any)?.cnt || 0);
}

export async function replaceOtpCode(params: {
  phone: string;
  countryCode?: string;
  otpHash: string;
  expiresInSeconds: number;
  maxAttempts: number;
}): Promise<void> {
  const phone = normalizePhone(params.phone);
  const countryCode = normalizeCountryCode(params.countryCode);

  await rawDb.execute(rawSql`
    INSERT INTO otp_codes (
      id,
      phone,
      country_code,
      otp_hash,
      expires_at,
      attempts,
      max_attempts,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      ${phone},
      ${countryCode},
      ${params.otpHash},
      NOW() + (${params.expiresInSeconds} * INTERVAL '1 second'),
      0,
      ${params.maxAttempts},
      NOW()
    )
    ON CONFLICT (phone, country_code)
    DO UPDATE SET
      otp_hash     = EXCLUDED.otp_hash,
      expires_at   = EXCLUDED.expires_at,
      attempts     = 0,
      max_attempts = EXCLUDED.max_attempts,
      created_at   = NOW()
  `);
}

export async function findLatestOtpCode(params: {
  phone: string;
  countryCode?: string;
}): Promise<OtpCodeRecord | null> {
  const phone = normalizePhone(params.phone);
  const countryCode = normalizeCountryCode(params.countryCode);
  const res = await rawDb.execute(rawSql`
    SELECT id, phone, country_code, otp_hash, expires_at, attempts, max_attempts, created_at
    FROM otp_codes
    WHERE phone=${phone}
      AND country_code=${countryCode}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = res.rows[0] as any;
  return row ? mapOtpRow(row) : null;
}

export async function incrementOtpAttempts(id: string): Promise<void> {
  await rawDb.execute(rawSql`
    UPDATE otp_codes
    SET attempts = COALESCE(attempts, 0) + 1
    WHERE id=${id}::uuid
  `);
}

export async function deleteOtpCode(id: string): Promise<void> {
  await rawDb.execute(rawSql`DELETE FROM otp_codes WHERE id=${id}::uuid`);
}

export async function findUserByOtpPhone(params: {
  phone: string;
  userType: string;
}): Promise<OtpUserRecord | null> {
  const phone = normalizePhone(params.phone);
  const res = await rawDb.execute(rawSql`
    SELECT
      id,
      phone,
      full_name,
      email,
      user_type,
      is_active,
      is_locked,
      lock_reason,
      profile_photo,
      rating
    FROM users
    WHERE phone=${phone}
      AND user_type=${params.userType}
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
  `);
  const row = res.rows[0] as any;
  return row ? mapUserRow(row) : null;
}

export async function createOtpUser(params: {
  phone: string;
  userType: string;
  fullName?: string;
}): Promise<OtpUserRecord> {
  const phone = normalizePhone(params.phone);
  const fullName = String(params.fullName || `User_${phone.slice(-4)}`).trim();
  const res = await rawDb.execute(rawSql`
    INSERT INTO users (
      id,
      full_name,
      phone,
      user_type,
      is_active,
      is_locked,
      wallet_balance
    )
    VALUES (
      gen_random_uuid(),
      ${fullName},
      ${phone},
      ${params.userType},
      true,
      false,
      0
    )
    RETURNING
      id,
      phone,
      full_name,
      email,
      user_type,
      is_active,
      is_locked,
      lock_reason,
      profile_photo,
      rating
  `);
  return mapUserRow(res.rows[0] as any);
}
