const { Pool } = require("pg");

async function check(db) {
  const pool = new Pool({ connectionString: `postgresql://postgres:postgres@localhost:5432/${db}` });
  const r = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('parcel_orders','franchisees','driver_pool_sessions') ORDER BY tablename",
  );
  console.log(db + ":", r.rows.map((x) => x.tablename).join(", ") || "(missing)");
  await pool.end();
}

(async () => {
  await check("jago");
  await check("postgres");
})();
