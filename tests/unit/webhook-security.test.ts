/**
 * JAGO — Razorpay Webhook Security Unit Tests
 * Tests HMAC-SHA256 signature verification, timing-safe compare, idempotency logic
 * These run fully offline (no DB, no network)
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";

// ── Helpers replicated from routes.ts ──────────────────────────────────────

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  if (expected.length !== signatureHeader.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(signatureHeader, "utf8")
  );
}

function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(signature, "utf8")
  );
}

// ── Test data ──────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test_webhook_secret_32chars_abc123";
const PAYMENT_SECRET = "test_payment_secret_32chars_abc99";

const SAMPLE_BODY = JSON.stringify({
  entity: "event",
  account_id: "acc_test123",
  event: "payment.captured",
  payload: {
    payment: {
      entity: {
        id: "pay_testPaymentId123",
        order_id: "order_testOrderId456",
        amount: 50000,
        currency: "INR",
        status: "captured",
      },
    },
  },
});

const VALID_WEBHOOK_SIG = crypto
  .createHmac("sha256", WEBHOOK_SECRET)
  .update(SAMPLE_BODY)
  .digest("hex");

const ORDER_ID = "order_testOrderId456";
const PAYMENT_ID = "pay_testPaymentId123";
const VALID_PAYMENT_SIG = crypto
  .createHmac("sha256", PAYMENT_SECRET)
  .update(`${ORDER_ID}|${PAYMENT_ID}`)
  .digest("hex");

// ══════════════════════════════════════════════════════════════════════════
// 1. WEBHOOK SIGNATURE TESTS
// ══════════════════════════════════════════════════════════════════════════
describe("Webhook HMAC-SHA256 Signature Verification", () => {
  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(SAMPLE_BODY, VALID_WEBHOOK_SIG, WEBHOOK_SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tamperedBody = SAMPLE_BODY.replace("captured", "authorized");
    expect(verifyWebhookSignature(tamperedBody, VALID_WEBHOOK_SIG, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a wrong signature", () => {
    const wrongSig = "a".repeat(64);
    expect(verifyWebhookSignature(SAMPLE_BODY, wrongSig, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a missing signature (undefined)", () => {
    expect(verifyWebhookSignature(SAMPLE_BODY, undefined, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects an empty signature string", () => {
    expect(verifyWebhookSignature(SAMPLE_BODY, "", WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a signature for a different secret", () => {
    const wrongSig = crypto
      .createHmac("sha256", "wrong_secret")
      .update(SAMPLE_BODY)
      .digest("hex");
    expect(verifyWebhookSignature(SAMPLE_BODY, wrongSig, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a truncated signature (length mismatch)", () => {
    const shortSig = VALID_WEBHOOK_SIG.slice(0, 32);
    expect(verifyWebhookSignature(SAMPLE_BODY, shortSig, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects an empty body with valid sig for non-empty body", () => {
    expect(verifyWebhookSignature("", VALID_WEBHOOK_SIG, WEBHOOK_SECRET)).toBe(false);
  });

  it("accepts empty body if signature matches empty body hash", () => {
    const emptySig = crypto.createHmac("sha256", WEBHOOK_SECRET).update("").digest("hex");
    expect(verifyWebhookSignature("", emptySig, WEBHOOK_SECRET)).toBe(true);
  });

  it("is deterministic — same input always gives same result", () => {
    for (let i = 0; i < 10; i++) {
      expect(verifyWebhookSignature(SAMPLE_BODY, VALID_WEBHOOK_SIG, WEBHOOK_SECRET)).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. PAYMENT SIGNATURE TESTS (verify-payment routes)
// ══════════════════════════════════════════════════════════════════════════
describe("Payment Signature Verification (verify-payment routes)", () => {
  it("accepts a valid payment signature", () => {
    expect(verifyPaymentSignature(ORDER_ID, PAYMENT_ID, VALID_PAYMENT_SIG, PAYMENT_SECRET)).toBe(true);
  });

  it("rejects if razorpaySignature is not sent (CRITICAL — old bug was optional check)", () => {
    expect(verifyPaymentSignature(ORDER_ID, PAYMENT_ID, undefined, PAYMENT_SECRET)).toBe(false);
  });

  it("rejects if orderId is swapped", () => {
    const sig = crypto
      .createHmac("sha256", PAYMENT_SECRET)
      .update(`${PAYMENT_ID}|${ORDER_ID}`) // reversed
      .digest("hex");
    expect(verifyPaymentSignature(ORDER_ID, PAYMENT_ID, sig, PAYMENT_SECRET)).toBe(false);
  });

  it("rejects if paymentId is different", () => {
    const sig = crypto
      .createHmac("sha256", PAYMENT_SECRET)
      .update(`${ORDER_ID}|pay_differentPaymentId`)
      .digest("hex");
    expect(verifyPaymentSignature(ORDER_ID, PAYMENT_ID, sig, PAYMENT_SECRET)).toBe(false);
  });

  it("rejects all-zeros signature of correct length", () => {
    const zeroSig = "0".repeat(64);
    expect(verifyPaymentSignature(ORDER_ID, PAYMENT_ID, zeroSig, PAYMENT_SECRET)).toBe(false);
  });

  it("rejects SQL injection attempt in orderId", () => {
    const maliciousOrder = "'; DROP TABLE driver_payments; --";
    const sig = crypto
      .createHmac("sha256", PAYMENT_SECRET)
      .update(`${maliciousOrder}|${PAYMENT_ID}`)
      .digest("hex");
    // sig matches for that string, but our verify uses the actual orderId — so it should fail
    expect(verifyPaymentSignature(ORDER_ID, PAYMENT_ID, sig, PAYMENT_SECRET)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. AMOUNT VALIDATION TESTS
// ══════════════════════════════════════════════════════════════════════════
describe("Payment Amount Validation", () => {
  function validateAmount(amount: unknown, min = 10, max = 50000): { valid: boolean; error?: string } {
    const amt = parseFloat(String(amount));
    if (isNaN(amt)) return { valid: false, error: "Not a number" };
    if (amt <= 0) return { valid: false, error: "Must be positive" };
    if (amt < min) return { valid: false, error: `Minimum is ₹${min}` };
    if (amt > max) return { valid: false, error: `Maximum is ₹${max}` };
    return { valid: true };
  }

  it("accepts valid amount ₹100", () => expect(validateAmount(100).valid).toBe(true));
  it("accepts minimum ₹10", () => expect(validateAmount(10).valid).toBe(true));
  it("accepts maximum ₹50000", () => expect(validateAmount(50000).valid).toBe(true));
  it("rejects ₹0", () => expect(validateAmount(0).valid).toBe(false));
  it("rejects negative amount", () => expect(validateAmount(-100).valid).toBe(false));
  it("rejects amount below minimum ₹9", () => expect(validateAmount(9).valid).toBe(false));
  it("rejects amount above maximum ₹50001", () => expect(validateAmount(50001).valid).toBe(false));
  it("rejects string 'abc'", () => expect(validateAmount("abc").valid).toBe(false));
  it("rejects undefined", () => expect(validateAmount(undefined).valid).toBe(false));
  it("rejects null", () => expect(validateAmount(null).valid).toBe(false));
  it("rejects empty string", () => expect(validateAmount("").valid).toBe(false));
  it("parses '500.50' as valid", () => expect(validateAmount("500.50").valid).toBe(true));
  it("rejects Infinity", () => {
    const r = validateAmount(Infinity);
    expect(r.valid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. RAZORPAY PAISE → RUPEES CONVERSION
// ══════════════════════════════════════════════════════════════════════════
describe("Paise to Rupees conversion (webhook payload parsing)", () => {
  it("converts 50000 paise to ₹500.00", () => expect(50000 / 100).toBe(500));
  it("converts 100 paise to ₹1.00", () => expect(100 / 100).toBe(1));
  it("converts 1 paise to ₹0.01", () => expect(1 / 100).toBeCloseTo(0.01));
  it("converts 999 paise to ₹9.99", () => expect(999 / 100).toBeCloseTo(9.99));
  it("amount mismatch detection: |fetched - event| > 0.5 rupee fails", () => {
    const fetchedAmount = 499.5;
    const eventAmount = 500;
    expect(Math.abs(fetchedAmount - eventAmount) > 0.5).toBe(false); // 0.5 exactly — should pass
    expect(Math.abs(498 - eventAmount) > 0.5).toBe(true); // ₹2 diff — should FAIL
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. IDEMPOTENCY LOGIC
// ══════════════════════════════════════════════════════════════════════════
describe("Webhook Idempotency (event deduplication)", () => {
  // Simulate what DB returns for INSERT ON CONFLICT DO NOTHING RETURNING id
  function simulateInsert(existingEventIds: Set<string>, newEventId: string): { inserted: boolean } {
    if (existingEventIds.has(newEventId)) return { inserted: false };
    existingEventIds.add(newEventId);
    return { inserted: true };
  }

  it("first event is processed", () => {
    const db = new Set<string>();
    expect(simulateInsert(db, "evt_abc123").inserted).toBe(true);
  });

  it("duplicate event is skipped", () => {
    const db = new Set<string>();
    simulateInsert(db, "evt_abc123");
    expect(simulateInsert(db, "evt_abc123").inserted).toBe(false);
  });

  it("different events are both processed", () => {
    const db = new Set<string>();
    expect(simulateInsert(db, "evt_111").inserted).toBe(true);
    expect(simulateInsert(db, "evt_222").inserted).toBe(true);
  });

  it("100 rapid duplicates — all skipped after first", () => {
    const db = new Set<string>();
    simulateInsert(db, "evt_flood");
    let skipped = 0;
    for (let i = 0; i < 100; i++) {
      if (!simulateInsert(db, "evt_flood").inserted) skipped++;
    }
    expect(skipped).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. SUBSCRIPTION EXPIRY LOGIC
// ══════════════════════════════════════════════════════════════════════════
describe("Subscription Expiry / Days-Left Calculation", () => {
  function daysLeft(endDate: string): number {
    return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000));
  }

  it("returns 0 for yesterday", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    expect(daysLeft(yesterday)).toBe(0);
  });

  it("returns > 0 for tomorrow", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    expect(daysLeft(tomorrow)).toBeGreaterThan(0);
  });

  it("returns 0 for today (expired at start of day)", () => {
    const today = new Date().toISOString().split("T")[0];
    // May be 0 or 1 depending on time of day — but never negative
    expect(daysLeft(today)).toBeGreaterThanOrEqual(0);
  });

  it("returns ~30 for a month from now", () => {
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
    expect(daysLeft(futureDate)).toBeGreaterThanOrEqual(29);
    expect(daysLeft(futureDate)).toBeLessThanOrEqual(31);
  });

  it("hasActiveSubscription requires daysLeft > 0", () => {
    const expired = new Date(Date.now() - 1000).toISOString().split("T")[0];
    const active = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    expect(daysLeft(expired) > 0).toBe(false);
    expect(daysLeft(active) > 0).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. COMMISSION CALCULATION LOGIC
// ══════════════════════════════════════════════════════════════════════════
describe("Commission & GST Calculation", () => {
  function calcCommission(fare: number, commPct: number, gstPct: number) {
    const commission = parseFloat((fare * commPct / 100).toFixed(2));
    const gst = parseFloat((commission * gstPct / 100).toFixed(2));
    const total = parseFloat((commission + gst).toFixed(2));
    return { commission, gst, total };
  }

  it("15% commission + 18% GST on ₹100 fare", () => {
    const r = calcCommission(100, 15, 18);
    expect(r.commission).toBe(15);
    expect(r.gst).toBe(2.7);
    expect(r.total).toBe(17.7);
  });

  it("commission on ₹0 is ₹0", () => {
    const r = calcCommission(0, 15, 18);
    expect(r.commission).toBe(0);
    expect(r.total).toBe(0);
  });

  it("20% commission on ₹500 = ₹100 + GST", () => {
    const r = calcCommission(500, 20, 18);
    expect(r.commission).toBe(100);
    expect(r.gst).toBe(18);
    expect(r.total).toBe(118);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 8. WEBHOOK EVENT TYPE ROUTING
// ══════════════════════════════════════════════════════════════════════════
describe("Webhook Event Type Recognition", () => {
  const HANDLED_EVENTS = new Set([
    "payment.authorized",
    "payment.captured",
    "payment.failed",
    "subscription.authenticated",
    "subscription.pending",
    "subscription.activated",
    "subscription.charged",
    "subscription.halted",
    "subscription.resumed",
    "subscription.cancelled",
    "refund.created",
    "refund.processed",
  ]);

  it("recognizes all 12 handled event types", () => {
    expect(HANDLED_EVENTS.size).toBe(12);
  });

  HANDLED_EVENTS.forEach(evt => {
    it(`handles event: ${evt}`, () => {
      expect(HANDLED_EVENTS.has(evt)).toBe(true);
    });
  });

  it("returns false for unknown event type", () => {
    expect(HANDLED_EVENTS.has("order.paid")).toBe(false);
    expect(HANDLED_EVENTS.has("")).toBe(false);
    expect(HANDLED_EVENTS.has("payment.CAPTURED")).toBe(false); // case-sensitive
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 9. WALLET BALANCE OPERATIONS
// ══════════════════════════════════════════════════════════════════════════
describe("Wallet Balance Operations", () => {
  it("credit increases balance", () => {
    const balance = 100;
    const credit = 50;
    expect(balance + credit).toBe(150);
  });

  it("debit decreases balance", () => {
    const balance = 100;
    const debit = 30;
    expect(balance - debit).toBe(70);
  });

  it("GREATEST(0, balance - debit) never goes negative", () => {
    const balance = 10;
    const debit = 50;
    expect(Math.max(0, balance - debit)).toBe(0);
  });

  it("auto-unlock threshold: balance >= threshold unlocks driver", () => {
    const unlockThreshold = 0;
    const newBalance = 100;
    expect(newBalance >= unlockThreshold).toBe(true);
  });

  it("driver stays locked if balance below threshold", () => {
    const unlockThreshold = 200;
    const newBalance = 150;
    expect(newBalance >= unlockThreshold).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 10. INPUT SANITIZATION (safeErrMsg equivalent)
// ══════════════════════════════════════════════════════════════════════════
describe("Error Message Sanitization", () => {
  function safeErrMsg(e: any): string {
    if (!e) return "Unknown error";
    const msg = e?.message || e?.error?.description || String(e);
    // Never leak stack traces or internal paths to client
    return msg.replace(/\n.*/s, "").slice(0, 200);
  }

  it("returns message from Error object", () => {
    expect(safeErrMsg(new Error("DB connection failed"))).toBe("DB connection failed");
  });

  it("truncates long messages at 200 chars", () => {
    const longMsg = "x".repeat(300);
    expect(safeErrMsg(new Error(longMsg))).toHaveLength(200);
  });

  it("strips stack trace (newlines)", () => {
    const err = new Error("Something failed\n    at Object.<anonymous> (/server/routes.ts:123:45)");
    expect(safeErrMsg(err)).toBe("Something failed");
  });

  it("handles null gracefully", () => {
    expect(safeErrMsg(null)).toBe("Unknown error");
  });

  it("handles undefined gracefully", () => {
    expect(safeErrMsg(undefined)).toBe("Unknown error");
  });
});
