import { rawDb, rawSql } from "./db";

/**
 * Single source of truth for a user's aggregate `rating`, across every
 * module that rates users (rides/parcel via `reviews`, Local/Outstation
 * Pool and Car Sharing via `pool_ratings`). Both tables record individual
 * rating events; this recomputes a real AVG() from both combined, so the
 * value can never drift and is identical regardless of which module's
 * rating call fires last for a given user.
 *
 * Do not reintroduce an incremental counter (e.g. total_ratings) — that
 * column does not exist on users and every prior attempt to maintain one
 * silently crashed or silently no-opped in production.
 */
export async function recomputeUserRating(userId: string, tx?: { execute: typeof rawDb.execute }): Promise<void> {
  const executor = tx || rawDb;
  await executor.execute(rawSql`
    UPDATE users SET rating = (
      SELECT COALESCE(AVG(combined.rating), 0) FROM (
        SELECT rating FROM reviews WHERE reviewee_id = ${userId}::uuid
        UNION ALL
        SELECT overall_rating AS rating FROM pool_ratings WHERE to_user_id = ${userId}::uuid
      ) combined
    )
    WHERE id = ${userId}::uuid
  `);
}
