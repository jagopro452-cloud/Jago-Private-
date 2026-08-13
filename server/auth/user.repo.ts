import { db } from "../db";
import { sql } from "drizzle-orm";

const rawSql = sql;
const rawDb = db;

export type AuthUserRecord = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  userType: string;
  isActive: boolean;
  isLocked: boolean;
  lockReason: string | null;
  passwordHash: string | null;
  profilePhoto: string | null;
  rating: number;
};

function normalizePhoneCandidates(phone: string, countryCode?: string): string[] {
  const digits = String(phone || "").replace(/\D/g, "");
  const ccDigits = String(countryCode || "").replace(/\D/g, "");
  const candidates = new Set<string>();

  if (digits) {
    candidates.add(digits);
    if (digits.length > 10) {
      candidates.add(digits.slice(-10));
    }
  }

  if (digits && ccDigits && digits.startsWith(ccDigits)) {
    const local = digits.slice(ccDigits.length);
    if (local) {
      candidates.add(local);
      if (local.length > 10) {
        candidates.add(local.slice(-10));
      }
    }
  }

  return Array.from(candidates).filter(Boolean);
}

export async function findUserByPhoneForLogin(params: {
  phone: string;
  countryCode?: string;
  userType: string;
}): Promise<AuthUserRecord | null> {
  const phoneCandidates = normalizePhoneCandidates(params.phone, params.countryCode);
  if (!phoneCandidates.length) return null;

  const phoneBindings = phoneCandidates.map((candidate) => rawSql`${candidate}`);

  const userRes = await rawDb.execute(rawSql`
    SELECT
      id,
      phone,
      full_name,
      email,
      user_type,
      is_active,
      is_locked,
      lock_reason,
      password_hash,
      profile_photo,
      rating
    FROM users
    WHERE phone IN (${rawSql.join(phoneBindings, rawSql`, `)})
      AND user_type = ${params.userType}
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
  `);

  const row = userRes.rows[0] as any;
  if (!row) return null;

  return {
    id: String(row.id),
    phone: String(row.phone || ""),
    fullName: row.full_name ? String(row.full_name) : null,
    email: row.email ? String(row.email) : null,
    userType: String(row.user_type || params.userType),
    isActive: !!row.is_active,
    isLocked: !!row.is_locked,
    lockReason: row.lock_reason ? String(row.lock_reason) : null,
    passwordHash: row.password_hash ? String(row.password_hash) : null,
    profilePhoto: row.profile_photo ? String(row.profile_photo) : null,
    rating: Number(row.rating || 5),
  };
}
