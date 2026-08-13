#!/usr/bin/env node
/**
 * H1 Phase 2 orphan recovery verification script.
 * Runs against DATABASE_URL when available.
 */
const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const crypto = require("node:crypto");

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    record("DATABASE_URL configured", false, "skipped DB tests");
    printSummary();
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const schema = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='booking_intents'
        AND column_name IN ('recovery_attempts','last_recovery_at','recovered_at','recovery_error')
    `);
    record(
      "Migration columns exist",
      schema.rows.length === 4,
      `found ${schema.rows.length}/4`,
    );

    const auditTbl = await client.query(
      `SELECT to_regclass('public.payment_recovery_events') AS tbl`,
    );
    record(
      "payment_recovery_events table exists",
      Boolean(auditTbl.rows[0]?.tbl),
    );

    const {
      findRecoverableOrphanPayments,
      recoverBookingFromIntent,
      validateBookingDraft,
      parseBookingDraft,
      ORPHAN_RECOVERY_MAX_ATTEMPTS,
    } = await import("../server/payment-orphan-recovery.ts");

    record(
      "Invalid bookingDraft validation",
      !validateBookingDraft({}).ok,
      validateBookingDraft({}).error || "",
    );

    const customer = await client.query(
      `SELECT id FROM users WHERE role='customer' LIMIT 1`,
    );
    if (!customer.rows.length) {
      record("Seed customer available", false, "no customer row");
      printSummary();
      return;
    }
    const customerId = customer.rows[0].id;
    const intentId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const orderId = `order_test_${Date.now()}`;
    const rzpPaymentId = `pay_test_${Date.now()}`;

    const draft = {
      pickupAddress: "MG Road",
      pickupLat: 12.9716,
      pickupLng: 77.5946,
      destinationAddress: "Indiranagar",
      destinationLat: 12.9784,
      destinationLng: 77.6408,
      vehicleType: "Cab",
      estimatedFare: 120,
      paymentMethod: "online",
      customerId,
      tripType: "normal",
    };

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO booking_intents (
        id, customer_id, status, quoted_amount, payment_method, trip_type,
        razorpay_order_id, razorpay_payment_id, payload, updated_at
      ) VALUES ($1,$2,'payment_verified',120,'online','normal',$3,$4,$5::jsonb,NOW() - INTERVAL '2 minutes')`,
      [
        intentId,
        customerId,
        orderId,
        rzpPaymentId,
        JSON.stringify({ bookingDraft: draft }),
      ],
    );
    await client.query(
      `INSERT INTO customer_payments (
        id, customer_id, booking_intent_id, amount, payment_type,
        razorpay_order_id, razorpay_payment_id, status, verified_at
      ) VALUES ($1,$2,$3,120,'ride_payment',$4,$5,'completed',NOW())`,
      [paymentId, customerId, intentId, orderId, rzpPaymentId],
    );
    await client.query("COMMIT");

    const orphans = await findRecoverableOrphanPayments({
      graceSeconds: 0,
      batchSize: 5,
    });
    const found = orphans.some((o) => o.bookingIntentId === intentId);
    record("Worker detector finds orphan", found);

    const recovered = await recoverBookingFromIntent({
      bookingIntentId: intentId,
      customerId,
      source: "api",
    });
    record(
      "Recover booking from intent",
      recovered.status === "recovered" || recovered.status === "already_exists",
      recovered.status,
    );

    const duplicate = await recoverBookingFromIntent({
      bookingIntentId: intentId,
      customerId,
      source: "api",
    });
    record(
      "No duplicate trip creation",
      duplicate.status === "already_exists",
      duplicate.status,
    );

    const intentAfter = await client.query(
      `SELECT status, trip_id FROM booking_intents WHERE id=$1`,
      [intentId],
    );
    record(
      "Recovered intent status",
      intentAfter.rows[0]?.status === "recovered" && intentAfter.rows[0]?.trip_id,
      intentAfter.rows[0]?.status,
    );

    const paymentAfter = await client.query(
      `SELECT trip_id FROM customer_payments WHERE id=$1`,
      [paymentId],
    );
    record(
      "Recovered trip linked on payment",
      Boolean(paymentAfter.rows[0]?.trip_id),
    );

    const badIntentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO booking_intents (
        id, customer_id, status, quoted_amount, payment_method, trip_type,
        razorpay_order_id, razorpay_payment_id, payload, updated_at
      ) VALUES ($1,$2,'payment_verified',80,'online','normal',$3,$4,'{}'::jsonb,NOW() - INTERVAL '2 minutes')`,
      [badIntentId, customerId, `order_bad_${Date.now()}`, `pay_bad_${Date.now()}`],
    );
    const badResult = await recoverBookingFromIntent({
      bookingIntentId: badIntentId,
      customerId,
      source: "api",
    });
    record(
      "Invalid bookingDraft -> recovery_failed",
      badResult.status === "missing_draft",
      badResult.status,
    );

    const maxIntentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO booking_intents (
        id, customer_id, status, quoted_amount, payment_method, trip_type,
        razorpay_order_id, razorpay_payment_id, payload, recovery_attempts, updated_at
      ) VALUES ($1,$2,'recovery_failed',80,'online','normal',$3,$4,$5::jsonb,$6,NOW() - INTERVAL '2 minutes')`,
      [
        maxIntentId,
        customerId,
        `order_max_${Date.now()}`,
        `pay_max_${Date.now()}`,
        JSON.stringify({ bookingDraft: draft }),
        ORPHAN_RECOVERY_MAX_ATTEMPTS,
      ],
    );
    const maxOrphans = await findRecoverableOrphanPayments({ graceSeconds: 0 });
    record(
      "Max recovery attempts excluded",
      !maxOrphans.some((o) => o.bookingIntentId === maxIntentId),
    );

    record(
      "parseBookingDraft extracts draft",
      Boolean(parseBookingDraft({ bookingDraft: draft })),
    );

    // cleanup test rows
    await client.query(
      `DELETE FROM payment_recovery_events WHERE booking_intent_id IN ($1,$2,$3)`,
      [intentId, badIntentId, maxIntentId],
    );
    const tripId = intentAfter.rows[0]?.trip_id;
    if (tripId) {
      await client.query(`DELETE FROM trip_requests WHERE id=$1`, [tripId]);
    }
    await client.query(`DELETE FROM customer_payments WHERE booking_intent_id IN ($1,$2,$3)`, [
      intentId,
      badIntentId,
      maxIntentId,
    ]);
    await client.query(`DELETE FROM booking_intents WHERE id IN ($1,$2,$3)`, [
      intentId,
      badIntentId,
      maxIntentId,
    ]);
  } catch (err) {
    record("Test harness", false, err.message);
  } finally {
    client.release();
    await pool.end();
    printSummary();
  }
}

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
