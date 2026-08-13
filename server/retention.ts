/**
 * Customer Retention System
 *
 * Detects inactive customers and sends promotional notifications to re-engage them.
 *
 * Rules:
 * - Inactive > 7 days → send ₹50 off promotion
 * - Inactive > 14 days → send ₹100 off promotion
 * - Inactive > 30 days → send ₹150 off "We miss you" campaign
 *
 * Uses FCM push notifications + in-app promo codes.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { notifyUser } from "./notification-service";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RetentionRule {
  inactiveDays: number;
  discountAmount: number;
  messageTitle: string;
  messageBody: string;
  promoCode: string;
}

export interface RetentionCampaignResult {
  totalInactive: number;
  notificationsSent: number;
  promoCodesGenerated: number;
  errors: number;
}

// ── Retention rules ──────────────────────────────────────────────────────────

const RETENTION_RULES: RetentionRule[] = [
  {
    inactiveDays: 7,
    discountAmount: 50,
    messageTitle: "🎉 We miss you!",
    messageBody: "₹50 off on your next ride! Use code {PROMO}. Book now on JAGO Pro!",
    promoCode: "COMEBACK50",
  },
  {
    inactiveDays: 14,
    discountAmount: 100,
    messageTitle: "💰 Special offer just for you!",
    messageBody: "Get ₹100 off your next ride! Use code {PROMO}. Limited time offer!",
    promoCode: "MISS100",
  },
  {
    inactiveDays: 30,
    discountAmount: 150,
    messageTitle: "🚗 Come back to JAGO Pro!",
    messageBody: "We really miss you! Here's ₹150 off. Use code {PROMO}. Ride with us today!",
    promoCode: "RETURN150",
  },
];

// ── Core retention functions ────────────────────────────────────────────────

/**
 * Detect inactive customers and send retention notifications.
 * Called periodically (daily or every 6 hours).
 */
export async function runRetentionCampaign(): Promise<RetentionCampaignResult> {
  const result: RetentionCampaignResult = {
    totalInactive: 0,
    notificationsSent: 0,
    promoCodesGenerated: 0,
    errors: 0,
  };

  try {
    for (const rule of RETENTION_RULES) {
      // Find customers inactive for exactly this window (to avoid double-sending)
      const minDays = rule.inactiveDays;
      const maxDays = rule === RETENTION_RULES[RETENTION_RULES.length - 1]
        ? 365 // Last rule catches all long-inactive
        : RETENTION_RULES[RETENTION_RULES.indexOf(rule) + 1].inactiveDays;

      const inactiveUsers = await rawDb.execute(rawSql`
        SELECT u.id, u.full_name, u.phone,
          (SELECT ud.fcm_token FROM user_devices ud WHERE ud.user_id = u.id AND ud.fcm_token IS NOT NULL ORDER BY ud.updated_at DESC LIMIT 1) as fcm_token,
          (SELECT MAX(t.created_at) FROM trip_requests t WHERE t.customer_id = u.id) as last_trip_at
        FROM users u
        WHERE u.user_type = 'customer'
          AND u.is_active = true
          AND u.id NOT IN (
            SELECT customer_id FROM trip_requests
            WHERE created_at > NOW() - INTERVAL '${rawSql.raw(String(minDays))} days'
              AND customer_id IS NOT NULL
          )
          AND u.id IN (
            SELECT customer_id FROM trip_requests
            WHERE customer_id IS NOT NULL
          )
          AND u.id NOT IN (
            SELECT user_id FROM retention_notifications
            WHERE campaign_code = ${rule.promoCode}
              AND sent_at > NOW() - INTERVAL '${rawSql.raw(String(minDays))} days'
          )
        LIMIT 100
      `);

      result.totalInactive += inactiveUsers.rows.length;

      for (const row of inactiveUsers.rows) {
        const user = row as any;
        const personalCode = `${rule.promoCode}_${(user.id as string).substring(0, 8).toUpperCase()}`;

        try {
          // Create promo code for this user
          await rawDb.execute(rawSql`
            INSERT INTO retention_promos (user_id, promo_code, discount_amount, valid_until, is_used)
            VALUES (${user.id}::uuid, ${personalCode}, ${rule.discountAmount}, NOW() + INTERVAL '7 days', false)
            ON CONFLICT (user_id, promo_code) DO NOTHING
          `);
          result.promoCodesGenerated++;

          const body = rule.messageBody.replace("{PROMO}", personalCode);
          await notifyUser(user.id, "promo", {
            type: "retention_promo",
            promoCode: personalCode,
            discountAmount: rule.discountAmount,
            body,
          }, {
            title: rule.messageTitle,
            body,
            channelId: "promotions",
          });

          result.notificationsSent++;
          await rawDb.execute(rawSql`
            INSERT INTO retention_notifications (user_id, campaign_code, discount_amount, promo_code, message_title, message_body, sent_at, delivered)
            VALUES (${user.id}::uuid, ${rule.promoCode}, ${rule.discountAmount}, ${personalCode}, ${rule.messageTitle}, ${body}, NOW(), true)
          `);
        } catch (e: any) {
          result.errors++;
          console.error(`[RETENTION] Error for user ${user.id}:`, e.message);
        }
      }
    }

    console.log(`[RETENTION] Campaign: ${result.notificationsSent} notifications sent, ${result.promoCodesGenerated} promos created`);
  } catch (e: any) {
    console.error("[RETENTION] Campaign error:", e.message);
  }

  return result;
}

/**
 * Validate and apply a retention promo code during booking.
 */
export async function validateRetentionPromo(
  userId: string,
  promoCode: string
): Promise<{ valid: boolean; discountAmount: number; message: string }> {
  try {
    const r = await rawDb.execute(rawSql`
      SELECT id, discount_amount, valid_until, is_used
      FROM retention_promos
      WHERE user_id = ${userId}::uuid AND promo_code = ${promoCode}
      LIMIT 1
    `);

    if (!r.rows.length) {
      return { valid: false, discountAmount: 0, message: "Invalid promo code" };
    }

    const promo = r.rows[0] as any;
    if (promo.is_used) {
      return { valid: false, discountAmount: 0, message: "Promo code already used" };
    }
    if (new Date(promo.valid_until) < new Date()) {
      return { valid: false, discountAmount: 0, message: "Promo code expired" };
    }

    return {
      valid: true,
      discountAmount: Number(promo.discount_amount),
      message: `₹${promo.discount_amount} discount applied!`,
    };
  } catch (e: any) {
    console.error("[RETENTION] Promo validation error:", e.message);
    return { valid: false, discountAmount: 0, message: "Error validating code" };
  }
}

/**
 * Mark a retention promo as used after successful trip completion.
 */
export async function markPromoUsed(userId: string, promoCode: string): Promise<void> {
  try {
    await rawDb.execute(rawSql`
      UPDATE retention_promos SET is_used = true, used_at = NOW()
      WHERE user_id = ${userId}::uuid AND promo_code = ${promoCode}
    `);
  } catch (e: any) {
    console.error("[RETENTION] Mark used error:", e.message);
  }
}

/**
 * Get retention analytics for admin dashboard.
 */
export async function getRetentionAnalytics(): Promise<{
  totalInactiveCustomers: number;
  promosSent7d: number;
  promosRedeemed7d: number;
  redemptionRate: number;
  reactivatedCustomers: number;
}> {
  try {
    const stats = await rawDb.execute(rawSql`
      SELECT
        (SELECT COUNT(*) FROM users u
         WHERE u.user_type = 'customer' AND u.is_active = true
         AND u.id NOT IN (SELECT customer_id FROM trip_requests WHERE created_at > NOW() - INTERVAL '7 days' AND customer_id IS NOT NULL)
         AND u.id IN (SELECT customer_id FROM trip_requests WHERE customer_id IS NOT NULL)
        ) as inactive_customers,
        (SELECT COUNT(*) FROM retention_notifications WHERE sent_at > NOW() - INTERVAL '7 days') as promos_sent,
        (SELECT COUNT(*) FROM retention_promos WHERE is_used = true AND used_at > NOW() - INTERVAL '7 days') as promos_redeemed,
        (SELECT COUNT(DISTINCT rp.user_id) FROM retention_promos rp
         JOIN trip_requests t ON t.customer_id = rp.user_id
         WHERE rp.is_used = true AND t.created_at > rp.used_at AND t.created_at > NOW() - INTERVAL '7 days'
        ) as reactivated
    `);

    const r = stats.rows[0] as any;
    const sent = Number(r.promos_sent) || 0;
    const redeemed = Number(r.promos_redeemed) || 0;

    return {
      totalInactiveCustomers: Number(r.inactive_customers) || 0,
      promosSent7d: sent,
      promosRedeemed7d: redeemed,
      redemptionRate: sent > 0 ? Math.round((redeemed / sent) * 100) : 0,
      reactivatedCustomers: Number(r.reactivated) || 0,
    };
  } catch (e: any) {
    console.error("[RETENTION] Analytics error:", e.message);
    return { totalInactiveCustomers: 0, promosSent7d: 0, promosRedeemed7d: 0, redemptionRate: 0, reactivatedCustomers: 0 };
  }
}

// ── Background job ──────────────────────────────────────────────────────────

let retentionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the retention campaign background job — runs every 6 hours.
 */
export function startRetentionCampaignJob(): void {
  if (retentionInterval) return;
  retentionInterval = setInterval(() => {
    runRetentionCampaign().catch((e) => console.error("[RETENTION] Job error:", e.message));
  }, 6 * 60 * 60 * 1000); // Every 6 hours
  console.log("[RETENTION] Campaign job started (6 hour interval)");

  // Run first campaign after 30 second startup delay
  setTimeout(() => {
    runRetentionCampaign().catch((e) => console.error("[RETENTION] Initial run error:", e.message));
  }, 30000);
}

// ── DB table initialization ─────────────────────────────────────────────────

export async function initRetentionTables(): Promise<void> {
  try {
    await assertSchemaObjectsOrThrow({
      tables: ["retention_promos", "retention_notifications"],
    });

    console.log("[RETENTION] Schema verified");
  } catch (e: any) {
    console.error("[RETENTION] Table init error:", e.message);
  }
}
