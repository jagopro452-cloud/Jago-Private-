/**
 * config-db: reads config from process.env first, falls back to business_settings DB table.
 * This lets admin panel changes take effect without redeployment.
 *
 * Admin panel saves keys with these DB key names:
 *   fast2sms_api_key, razorpay_key_id, razorpay_key_secret, google_maps_key,
 *   twilio_account_sid, twilio_auth_token, twilio_phone_number
 */
import { pool } from "./db";

export async function getConf(envKey: string, dbKey?: string): Promise<string | undefined> {
  // Environment variable takes priority (set in DigitalOcean env vars)
  const envVal = process.env[envKey];
  if (envVal && envVal.trim().length > 0) return envVal.trim();

  // Fall back to admin-panel-saved DB setting
  if (!dbKey) return undefined;
  try {
    const r = await pool.query(
      "SELECT value FROM business_settings WHERE key_name = $1 LIMIT 1",
      [dbKey]
    );
    const val = r.rows[0]?.value;
    return val && String(val).trim().length > 0 ? String(val).trim() : undefined;
  } catch {
    return undefined;
  }
}
