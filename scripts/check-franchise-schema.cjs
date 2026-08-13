require("dotenv").config({ path: ".env", override: true });
const { Pool } = require("pg");

async function main() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const required = [
    "commission_type","commission_flat","address","city","pincode","bank_name",
    "bank_account","bank_ifsc","gst_number","pan_number","agreement_date",
    "contract_end_date","min_guaranteed","payout_cycle","total_paid_out","notes",
    "photo_url","whatsapp","alt_contact_name","alt_contact_phone","franchise_type",
    "service_area_desc","website","bank_holder_name","state",
  ];
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='franchisees' AND column_name = ANY($1::text[])`,
    [required],
  );
  const present = new Set(r.rows.map((row) => row.column_name));
  const missing = required.filter((c) => !present.has(c));
  console.log(JSON.stringify({ present: [...present].sort(), missing }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
