# Migration Authority

The production runtime owns one ordered SQL migration chain:

1. `migrations/*.sql` — authoritative baseline and feature increments.
2. `server/migrations/*.sql` — production hardening applied after the root chain.
3. `migrations_archive_2026-07-30/` — historical reference only; never executed.

The runtime records names as `root:<filename>` and `server:<filename>` in the `migrations` table. Legacy unscoped records remain recognized for upgrade compatibility.

For an empty database, `migrations/0000_baseline.sql` is executed before every increment. For an existing database containing `public.users`, the baseline is recorded without replay and only subsequent migrations run. Any migration failure blocks startup and is not recorded as applied.

The runtime uses the ordered SQL files directly. A Drizzle `meta/_journal.json` is therefore not required. `drizzle.config.ts` remains the schema-generation configuration, but generated SQL must be reviewed and committed into the authoritative root chain before release.

Run `node scripts/verify-migration-chain.cjs` against local PostgreSQL to verify fresh replay, idempotent replay, and existing-database upgrade. The verifier refuses non-local database hosts.
