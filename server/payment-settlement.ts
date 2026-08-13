import { db } from "./db";
import { sql } from "drizzle-orm";
import { applyWalletChange, resolveDriverCreditLimit } from "./revenue-engine";

const rawDb = db;
const rawSql = sql;

type SettlementSource = "app_verify" | "webhook" | "retry_job";

type BaseOutcome = {
  status: "settled" | "already_processed" | "not_found";
  paymentType?: string;
  amount?: number;
  orderId?: string;
  paymentId?: string;
};

export type DriverPaymentOutcome = BaseOutcome & {
  flow?: "driver_wallet_topup" | "driver_subscription" | "driver_commission_payment";
  driverId?: string;
  tripId?: string | null;
  newBalance?: number;
  pendingBalance?: number;
  autoUnlocked?: boolean;
  validUntil?: string;
};

export type CustomerPaymentOutcome = BaseOutcome & {
  flow?: "customer_wallet_topup" | "customer_ride_payment";
  customerId?: string;
  tripId?: string | null;
  bookingIntentId?: string | null;
  newBalance?: number;
};

function toMoney(value: unknown): number {
  return Math.round(parseFloat(String(value ?? 0)) * 100) / 100;
}

function toDateOnly(date: Date) {
  return date.toISOString().split("T")[0];
}

function parseContext(row: any) {
  const ctx = row?.payment_context;
  if (!ctx) return {} as Record<string, any>;
  if (typeof ctx === "object") return ctx as Record<string, any>;
  try {
    return JSON.parse(String(ctx));
  } catch {
    return {} as Record<string, any>;
  }
}

async function maybeCompleteTripFromDriverPayment(tx: any, tripId: string | null | undefined, paymentId: string, orderId: string) {
  if (!tripId) return;
  const tripState = await tx.execute(rawSql`
    SELECT current_status
    FROM trip_requests
    WHERE id=${tripId}::uuid
    LIMIT 1
  `);
  const currentStatus = String((tripState.rows[0] as any)?.current_status || "");
  if (currentStatus !== "completed") {
    const { transitionRideState } = await import("./ride-state");
    await transitionRideState(String(tripId), "completed", {
      actorType: "system",
      event: "COMPLETED",
      data: { source: "payment_settlement", paymentId, orderId },
      extraSetters: [rawSql`payment_status='paid'`],
    }).catch(() => null);
  }
}

async function settleDriverCommissionPayment(tx: any, rec: any, paymentId: string) {
  const driverId = String(rec.driver_id);
  const amount = toMoney(rec.amount);
  const balances = await tx.execute(rawSql`
    SELECT wallet_balance, pending_commission_balance, pending_gst_balance, total_pending_balance, is_locked
    FROM users
    WHERE id=${driverId}::uuid
    FOR UPDATE
  `);
  if (!balances.rows.length) throw new Error("Driver not found for commission settlement");

  const userRow = balances.rows[0] as any;
  const prevTotal = toMoney(userRow.total_pending_balance);
  const prevCommission = toMoney(userRow.pending_commission_balance);
  const prevGst = toMoney(userRow.pending_gst_balance);
  const paidPaise = Math.round(amount * 100);
  const totalPaise = Math.round(prevTotal * 100);
  const gstPaise = Math.round(prevGst * 100);
  const commissionPaise = Math.round(prevCommission * 100);
  const gstRedPaise = Math.min(
    gstPaise,
    totalPaise > 0 ? Math.round((paidPaise * gstPaise) / totalPaise) : 0,
  );
  const commRedPaise = Math.min(commissionPaise, Math.max(0, paidPaise - gstRedPaise));
  const newPendingBalance = Math.max(0, Math.round((totalPaise - paidPaise)) / 100);
  const newPendingCommission = Math.max(0, Math.round((commissionPaise - commRedPaise)) / 100);
  const newPendingGst = Math.max(0, Math.round((gstPaise - gstRedPaise)) / 100);

  const walletChange = await applyWalletChange({
    userId: driverId,
    amount,
    type: "CREDIT",
    reason: "commission_payment",
    refId: paymentId,
    metadata: { paymentType: "commission_payment" },
    tx,
  });

  const unlockThreshold = -(await resolveDriverCreditLimit(driverId));
  const autoUnlocked = walletChange.newBalance >= unlockThreshold && Boolean(userRow.is_locked);

  // P0 FIX: this UPDATE used to also write pending_payment_amount, a column
  // that does not exist on users anywhere in the schema (confirmed via the
  // corrected architecture pass earlier this session - only
  // trip_requests.pending_payment_amount exists, a different table/concept).
  // Every commission-dues payment through this real path
  // (create-order -> verify-payment -> settleDriverPaymentByOrder) crashed
  // with "column does not exist" before this fix. wallet_balance (via
  // applyWalletChange above) and is_locked are the real, canonical fields;
  // total_pending_balance/pending_commission_balance/pending_gst_balance are
  // real schema-backed columns already correctly maintained by this function.
  await tx.execute(rawSql`
    UPDATE users
    SET pending_commission_balance=${newPendingCommission},
        pending_gst_balance=${newPendingGst},
        total_pending_balance=${newPendingBalance},
        is_locked=${autoUnlocked ? false : Boolean(userRow.is_locked)},
        lock_reason=${autoUnlocked ? null : userRow.lock_reason ?? null},
        locked_at=${autoUnlocked ? null : userRow.locked_at ?? null},
        updated_at=NOW()
    WHERE id=${driverId}::uuid
  `);

  await tx.execute(rawSql`
    INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
    VALUES (${driverId}::uuid, ${"Commission settlement via Razorpay"}, ${amount}, 0, ${walletChange.newBalance}, ${"commission_payment"}, ${paymentId})
    ON CONFLICT (ref_transaction_id, transaction_type) WHERE ref_transaction_id IS NOT NULL DO NOTHING
  `);

  await tx.execute(rawSql`
    INSERT INTO commission_settlements (
      driver_id, trip_id, settlement_type, commission_amount, gst_amount, total_amount,
      direction, balance_before, balance_after, description, razorpay_order_id, razorpay_payment_id
    )
    VALUES (
      ${driverId}::uuid,
      ${rec.trip_id || null}::uuid,
      'commission_payment',
      ${commRedPaise / 100},
      ${gstRedPaise / 100},
      ${amount},
      'credit',
      ${prevTotal},
      ${newPendingBalance},
      ${rec.description || "Commission settlement via Razorpay"},
      ${rec.razorpay_order_id || null},
      ${paymentId}
    )
    ON CONFLICT (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL DO NOTHING
  `);

  return {
    driverId,
    amount,
    newBalance: walletChange.newBalance,
    pendingBalance: newPendingBalance,
    autoUnlocked,
  };
}

async function settleDriverSubscription(tx: any, rec: any, paymentId: string, source: SettlementSource, overridePlanId?: string | null, overrideInsurancePlanId?: string | null) {
  const context = parseContext(rec);
  const driverId = String(rec.driver_id);
  const planId = overridePlanId || rec.plan_id || context.planId || null;
  const insurancePlanId = overrideInsurancePlanId || rec.insurance_plan_id || context.insurancePlanId || null;
  if (!planId) throw new Error(`Subscription payment ${rec.id} is missing plan context`);

  // Serialize all concurrent settlements for this driver on a per-driver advisory lock.
  // Without this, the deactivate-old + insert-new pair below is not atomic across transactions:
  // under 3+-way concurrency, multiple transactions can each find zero rows to deactivate
  // (because the row they'd deactivate hasn't been inserted yet by a sibling transaction) and
  // each insert its own active row, leaving more than one is_active=true row for the same driver.
  // Verified via direct 5-way concurrent execution before this fix: resulted in 2 active rows.
  await tx.execute(rawSql`SELECT pg_advisory_xact_lock(hashtext(${driverId}))`);

  const planR = await tx.execute(rawSql`SELECT * FROM subscription_plans WHERE id=${planId}::uuid LIMIT 1`);
  if (!planR.rows.length) throw new Error("Subscription plan not found");
  const plan = planR.rows[0] as any;
  const planBasePaise = Math.round(toMoney(plan.price) * 100);
  const gstPctR = await tx.execute(rawSql`SELECT value FROM revenue_model_settings WHERE key_name='sub_gst_pct' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
  const gstPct = parseFloat((gstPctR.rows[0] as any)?.value || "18");
  const gstAmt = Math.round((planBasePaise * gstPct) / 100) / 100;

  let insuranceAmt = 0;
  if (insurancePlanId) {
    const insR = await tx.execute(rawSql`
      SELECT premium_monthly, premium_daily
      FROM insurance_plans
      WHERE id=${insurancePlanId}::uuid AND is_active=true
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));
    if (insR.rows.length) {
      const ins = insR.rows[0] as any;
      insuranceAmt = Math.round(parseFloat(ins.premium_monthly || ins.premium_daily * 30 || 0) * 100) / 100;
    }
  }

  const startDate = toDateOnly(new Date());
  const endDate = toDateOnly(new Date(Date.now() + Number(plan.duration_days || plan.durationDays || 30) * 86400000));
  const totalPaid = toMoney(rec.amount);

  await tx.execute(rawSql`
    UPDATE driver_subscriptions
    SET is_active=false, subscription_status='replaced', updated_at=NOW()
    WHERE driver_id=${driverId}::uuid AND is_active=true
  `);

  // P0 FIX: this INSERT used to also write plan_base_price, a column that
  // does not exist on driver_subscriptions (verified: zero references to
  // it anywhere else in server/ or client/ - not read by any admin page,
  // report, or API response). Removed rather than added to schema per
  // "do not blindly add columns" - it's fully derivable when needed via
  // plan_id -> subscription_plans.price (already done at routes.ts:7468).
  // gst_amount/insurance_amount/insurance_plan_id ARE genuinely needed
  // (real driver-app feature, real money charged) - added via migration
  // 0009 instead. planBasePaise itself is still used above, just for the
  // GST calculation, not persisted as its own column.
  await tx.execute(rawSql`
    INSERT INTO driver_subscriptions (
      driver_id, plan_id, start_date, end_date,
      payment_amount, gst_amount, insurance_amount, insurance_plan_id,
      payment_status, is_active, razorpay_payment_id, razorpay_order_id, subscription_status
    )
    VALUES (
      ${driverId}::uuid, ${planId}::uuid, ${startDate}, ${endDate},
      ${totalPaid}, ${gstAmt}, ${insuranceAmt}, ${insurancePlanId || null}::uuid,
      'paid', true, ${paymentId}, ${rec.razorpay_order_id || null}, 'active'
    )
    ON CONFLICT (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL DO UPDATE
    SET is_active=true,
        payment_status='paid',
        subscription_status='active',
        start_date=EXCLUDED.start_date,
        end_date=EXCLUDED.end_date,
        updated_at=NOW()
  `);

  await tx.execute(rawSql`
    INSERT INTO admin_revenue (driver_id, amount, revenue_type, breakdown)
    VALUES (
      ${driverId}::uuid,
      ${totalPaid},
      'subscription_purchase',
      ${JSON.stringify({
        planId,
        insurancePlanId,
        totalPaid,
        source,
        paymentId,
        orderId: rec.razorpay_order_id,
      })}::jsonb
    )
    ON CONFLICT DO NOTHING
  `);

  return {
    driverId,
    amount: totalPaid,
    validUntil: endDate,
  };
}

export async function settleDriverPaymentByOrder(params: {
  orderId: string;
  paymentId: string;
  source: SettlementSource;
  driverId?: string | null;
  planId?: string | null;
  insurancePlanId?: string | null;
}): Promise<DriverPaymentOutcome> {
  const orderId = String(params.orderId || "").trim();
  const paymentId = String(params.paymentId || "").trim();
  if (!orderId || !paymentId) return { status: "not_found" };

  return rawDb.transaction(async (tx) => {
    const claim = await tx.execute(rawSql`
      UPDATE driver_payments
      SET razorpay_payment_id=${paymentId}, status='completed', verified_at=NOW()
      WHERE razorpay_order_id=${orderId}
        AND status='pending'
        ${params.driverId ? rawSql`AND driver_id=${params.driverId}::uuid` : rawSql``}
      RETURNING *
    `);
    if (!claim.rows.length) {
      const existing = await tx.execute(rawSql`
        SELECT driver_id, payment_type, trip_id
        FROM driver_payments
        WHERE razorpay_order_id=${orderId}
          ${params.driverId ? rawSql`AND driver_id=${params.driverId}::uuid` : rawSql``}
          AND status='completed'
        LIMIT 1
      `);
      return existing.rows.length
        ? {
            status: "already_processed",
            paymentType: String((existing.rows[0] as any).payment_type || ""),
            driverId: (existing.rows[0] as any).driver_id || undefined,
            tripId: (existing.rows[0] as any).trip_id || null,
            orderId,
            paymentId,
          }
        : { status: "not_found", orderId, paymentId };
    }

    const rec = claim.rows[0] as any;
    const paymentType = String(rec.payment_type || "");
    if (paymentType === "subscription") {
      const settled = await settleDriverSubscription(tx, rec, paymentId, params.source, params.planId, params.insurancePlanId);
      return {
        status: "settled",
        flow: "driver_subscription",
        paymentType,
        driverId: settled.driverId,
        amount: settled.amount,
        validUntil: settled.validUntil,
        orderId,
        paymentId,
      };
    }

    if (paymentType === "commission_payment") {
      const settled = await settleDriverCommissionPayment(tx, rec, paymentId);
      return {
        status: "settled",
        flow: "driver_commission_payment",
        paymentType,
        driverId: settled.driverId,
        amount: settled.amount,
        newBalance: settled.newBalance,
        pendingBalance: settled.pendingBalance,
        autoUnlocked: settled.autoUnlocked,
        tripId: rec.trip_id || null,
        orderId,
        paymentId,
      };
    }

    const walletChange = await applyWalletChange({
      userId: String(rec.driver_id),
      amount: toMoney(rec.amount),
      type: "CREDIT",
      reason: paymentType === "wallet_topup" ? "driver_wallet_topup" : paymentType || "driver_payment",
      refId: paymentId,
      metadata: {
        orderId,
        paymentType,
        source: params.source,
      },
      tx,
    });

    const unlockThreshold = -(await resolveDriverCreditLimit(String(rec.driver_id)));
    const userStateR = await tx.execute(rawSql`
      SELECT is_locked
      FROM users
      WHERE id=${rec.driver_id}::uuid
      LIMIT 1
    `);
    const wasLocked = Boolean((userStateR.rows[0] as any)?.is_locked);
    const autoUnlocked = walletChange.newBalance >= unlockThreshold && wasLocked;
    if (autoUnlocked) {
      await tx.execute(rawSql`
        UPDATE users
        SET is_locked=false, lock_reason=NULL, locked_at=NULL, updated_at=NOW()
        WHERE id=${rec.driver_id}::uuid
      `);
    }

    // P0 FIX: this block used to write users.pending_payment_amount, a column
    // that does not exist anywhere in the schema (verified: only trip_requests
    // has that name; see the corrected architecture report). Because it ran
    // inside this same transaction, it silently rolled back the wallet credit
    // and auto-unlock above on every real driver wallet top-up - the payment
    // was captured by Razorpay but never applied. wallet_balance (via
    // applyWalletChange above) and is_locked (above) are already the
    // canonical, sufficient state; this block was redundant even before it
    // was broken. Removed, not recreated - do not reintroduce
    // pending_payment_amount here or elsewhere.

    await tx.execute(rawSql`
      INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
      VALUES (
        ${rec.driver_id}::uuid,
        ${paymentType === "wallet_topup" ? "Driver wallet recharge via Razorpay" : "Driver payment settled"},
        ${toMoney(rec.amount)},
        0,
        ${walletChange.newBalance},
        ${paymentType === "wallet_topup" ? "driver_wallet_recharge" : paymentType || "driver_payment"},
        ${paymentId}
      )
      ON CONFLICT (ref_transaction_id, transaction_type) WHERE ref_transaction_id IS NOT NULL DO NOTHING
    `);

    await maybeCompleteTripFromDriverPayment(tx, rec.trip_id, paymentId, orderId);

    return {
      status: "settled",
      flow: "driver_wallet_topup",
      paymentType,
      driverId: String(rec.driver_id),
      tripId: rec.trip_id || null,
      amount: toMoney(rec.amount),
      newBalance: walletChange.newBalance,
      autoUnlocked,
      orderId,
      paymentId,
    };
  });
}

export async function settleCustomerWalletPaymentByOrder(params: {
  orderId: string;
  paymentId: string;
  source: SettlementSource;
  customerId?: string | null;
}): Promise<CustomerPaymentOutcome> {
  const orderId = String(params.orderId || "").trim();
  const paymentId = String(params.paymentId || "").trim();
  if (!orderId || !paymentId) return { status: "not_found" };

  return rawDb.transaction(async (tx) => {
    const claim = await tx.execute(rawSql`
      UPDATE customer_payments
      SET razorpay_payment_id=${paymentId}, status='completed', verified_at=NOW()
      WHERE razorpay_order_id=${orderId}
        AND payment_type='wallet_topup'
        AND status='pending'
        ${params.customerId ? rawSql`AND customer_id=${params.customerId}::uuid` : rawSql``}
      RETURNING customer_id, amount
    `);
    if (!claim.rows.length) {
      const existing = await tx.execute(rawSql`
        SELECT customer_id
        FROM customer_payments
        WHERE razorpay_order_id=${orderId}
          AND payment_type='wallet_topup'
          AND status='completed'
          ${params.customerId ? rawSql`AND customer_id=${params.customerId}::uuid` : rawSql``}
        LIMIT 1
      `);
      return existing.rows.length
        ? {
            status: "already_processed",
            flow: "customer_wallet_topup",
            paymentType: "wallet_topup",
            customerId: String((existing.rows[0] as any).customer_id),
            orderId,
            paymentId,
          }
        : { status: "not_found", orderId, paymentId };
    }

    const rec = claim.rows[0] as any;
    const amount = toMoney(rec.amount);
    const walletChange = await applyWalletChange({
      userId: String(rec.customer_id),
      amount,
      type: "CREDIT",
      reason: "customer_wallet_topup",
      refId: paymentId,
      metadata: { orderId, source: params.source },
      tx,
    });

    await tx.execute(rawSql`
      INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
      VALUES (${rec.customer_id}::uuid, ${"Wallet recharge via Razorpay"}, ${amount}, 0, ${walletChange.newBalance}, ${"wallet_recharge"}, ${paymentId})
      ON CONFLICT (ref_transaction_id, transaction_type) WHERE ref_transaction_id IS NOT NULL DO NOTHING
    `);

    return {
      status: "settled",
      flow: "customer_wallet_topup",
      paymentType: "wallet_topup",
      customerId: String(rec.customer_id),
      amount,
      newBalance: walletChange.newBalance,
      orderId,
      paymentId,
    };
  });
}

export async function settleCustomerRidePaymentByOrder(params: {
  orderId: string;
  paymentId: string;
  source: SettlementSource;
  customerId?: string | null;
}): Promise<CustomerPaymentOutcome> {
  const orderId = String(params.orderId || "").trim();
  const paymentId = String(params.paymentId || "").trim();
  if (!orderId || !paymentId) return { status: "not_found" };

  return rawDb.transaction(async (tx) => {
    const claim = await tx.execute(rawSql`
      UPDATE customer_payments
      SET razorpay_payment_id=${paymentId}, status='completed', verified_at=NOW()
      WHERE razorpay_order_id=${orderId}
        AND payment_type='ride_payment'
        AND status='pending'
        ${params.customerId ? rawSql`AND customer_id=${params.customerId}::uuid` : rawSql``}
      RETURNING customer_id, amount, trip_id, booking_intent_id
    `);
    if (!claim.rows.length) {
      const existing = await tx.execute(rawSql`
        SELECT customer_id, trip_id, booking_intent_id
        FROM customer_payments
        WHERE razorpay_order_id=${orderId}
          AND payment_type='ride_payment'
          AND status='completed'
          ${params.customerId ? rawSql`AND customer_id=${params.customerId}::uuid` : rawSql``}
        LIMIT 1
      `);
      return existing.rows.length
        ? {
            status: "already_processed",
            flow: "customer_ride_payment",
            paymentType: "ride_payment",
            customerId: String((existing.rows[0] as any).customer_id),
            tripId: (existing.rows[0] as any).trip_id || null,
            bookingIntentId: (existing.rows[0] as any).booking_intent_id || null,
            orderId,
            paymentId,
          }
        : { status: "not_found", orderId, paymentId };
    }

    const rec = claim.rows[0] as any;
    if (rec.booking_intent_id) {
      await tx.execute(rawSql`
        UPDATE booking_intents
        SET status=CASE WHEN status='booked' THEN status ELSE 'payment_verified' END,
            razorpay_order_id=${orderId},
            razorpay_payment_id=${paymentId},
            updated_at=NOW()
        WHERE id=${rec.booking_intent_id}::uuid
      `);
    }

    if (rec.trip_id) {
      await tx.execute(rawSql`
        UPDATE trip_requests
        SET payment_status='paid_online',
            razorpay_payment_id=${paymentId},
            updated_at=NOW()
        WHERE id=${rec.trip_id}::uuid
          AND customer_id=${rec.customer_id}::uuid
          AND current_status NOT IN ('completed', 'cancelled')
      `);
    }

    return {
      status: "settled",
      flow: "customer_ride_payment",
      paymentType: "ride_payment",
      customerId: String(rec.customer_id),
      amount: toMoney(rec.amount),
      tripId: rec.trip_id || null,
      bookingIntentId: rec.booking_intent_id || null,
      orderId,
      paymentId,
    };
  });
}
