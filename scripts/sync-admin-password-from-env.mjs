import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env"), override: true });

const email = process.env.ADMIN_EMAIL || "kiranatmakuri518@gmail.com";
const password = process.env.ADMIN_PASSWORD || "Greeshmant@2023";
const hash = await bcrypt.hash(password.trim(), 12);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const result = await pool.query(
  `UPDATE admins SET password = $1, is_active = true WHERE LOWER(email) = LOWER($2) RETURNING id, email`,
  [hash, email]
);

console.log("Synced admin password from .env for:", email);
console.log("Password length:", password.length);
console.log("Updated rows:", result.rowCount, result.rows[0] || null);
await pool.end();
