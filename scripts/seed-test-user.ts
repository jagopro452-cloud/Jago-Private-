import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../server/utils/crypto";

const rawDb = db;
const rawSql = sql;

async function run() {
  const phone = "9999999999";
  const userType = "customer";
  const password = String(process.env.SEED_TEST_USER_PASSWORD || "").trim();
  if (!password) {
    throw new Error("SEED_TEST_USER_PASSWORD is required");
  }
  const passwordHash = await hashPassword(password);

  const existing = await rawDb.execute(rawSql`
    SELECT id
    FROM users
    WHERE phone=${phone}
      AND user_type=${userType}
    LIMIT 1
  `);

  if (existing.rows.length) {
    await rawDb.execute(rawSql`
      UPDATE users
      SET
        full_name='QA Test User',
        is_active=true,
        is_locked=false,
        lock_reason=NULL,
        password_hash=${passwordHash},
        auth_token=NULL,
        auth_token_expires_at=NULL,
        refresh_token=NULL,
        refresh_token_expires_at=NULL,
        updated_at=NOW()
      WHERE id=${(existing.rows[0] as any).id}::uuid
    `);
  } else {
    await rawDb.execute(rawSql`
      INSERT INTO users (
        id,
        full_name,
        phone,
        user_type,
        is_active,
        is_locked,
        password_hash
      )
      VALUES (
        gen_random_uuid(),
        'QA Test User',
        ${phone},
        ${userType},
        true,
        false,
        ${passwordHash}
      )
    `);
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        seeded: {
          phone,
          passwordConfigured: true,
          userType,
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
    console.error("[seed-test-user] failed:", err?.message || String(err));
    process.exit(1);
  });
