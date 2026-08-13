import { db } from "../server/db";
import { sql } from "drizzle-orm";

const rawDb = db;
const rawSql = sql;

function normalizePhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function run() {
  const phone = normalizePhone(process.argv[2] || "");
  const countryCode = String(process.argv[3] || "+91").trim() || "+91";

  if (!phone) {
    throw new Error("Phone argument required");
  }

  await rawDb.execute(rawSql`
    UPDATE otp_codes
    SET expires_at = NOW() - INTERVAL '1 minute'
    WHERE id IN (
      SELECT id
      FROM otp_codes
      WHERE phone=${phone}
        AND country_code=${countryCode}
      ORDER BY created_at DESC
      LIMIT 1
    )
  `);

  console.log(
    JSON.stringify(
      {
        success: true,
        expired: {
          phone,
          countryCode,
        },
      },
      null,
      2,
    ),
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[expire-latest-otp] failed:", err?.message || String(err));
    process.exit(1);
  });
