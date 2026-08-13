import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlLike = {
  queryChunks?: Array<{ value?: string[] } | unknown>;
};

function sqlText(query: SqlLike) {
  return (query.queryChunks || [])
    .map((chunk) => {
      if (chunk && typeof chunk === "object" && "value" in (chunk as any)) {
        return ((chunk as any).value || []).join("");
      }
      return "?";
    })
    .join("");
}

function sqlValues(query: SqlLike) {
  return (query.queryChunks || []).filter((chunk) => !(chunk && typeof chunk === "object" && "value" in (chunk as any)));
}

function createMutex() {
  let queue = Promise.resolve();
  return async <T>(fn: () => Promise<T>) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

describe("Financial concurrency hardening", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("payment replay simulation settles exactly once under 1000 concurrent replays", async () => {
    const paymentRow = {
      customer_id: "cust-1",
      amount: 249.5,
      trip_id: "trip-1",
      booking_intent_id: "intent-1",
      status: "pending",
      razorpay_payment_id: null as string | null,
    };
    const bookingIntent = { status: "pending", razorpay_order_id: null as string | null, razorpay_payment_id: null as string | null };
    const trip = { payment_status: "pending", razorpay_payment_id: null as string | null, updates: 0 };
    const runExclusive = createMutex();

    vi.doMock("../../server/db", () => ({
      db: {
        transaction: (cb: (tx: any) => Promise<any>) =>
          runExclusive(() =>
            cb({
              execute: async (query: SqlLike) => {
                const text = sqlText(query);
                const values = sqlValues(query);

                if (text.includes("UPDATE customer_payments") && text.includes("status='pending'")) {
                  if (paymentRow.status !== "pending") return { rows: [] };
                  paymentRow.status = "completed";
                  paymentRow.razorpay_payment_id = String(values[0]);
                  return {
                    rows: [
                      {
                        customer_id: paymentRow.customer_id,
                        amount: paymentRow.amount,
                        trip_id: paymentRow.trip_id,
                        booking_intent_id: paymentRow.booking_intent_id,
                      },
                    ],
                  };
                }

                if (text.includes("SELECT customer_id, trip_id, booking_intent_id") && text.includes("status='completed'")) {
                  return paymentRow.status === "completed"
                    ? {
                        rows: [
                          {
                            customer_id: paymentRow.customer_id,
                            trip_id: paymentRow.trip_id,
                            booking_intent_id: paymentRow.booking_intent_id,
                          },
                        ],
                      }
                    : { rows: [] };
                }

                if (text.includes("UPDATE booking_intents")) {
                  bookingIntent.status = "payment_verified";
                  bookingIntent.razorpay_order_id = String(values[0]);
                  bookingIntent.razorpay_payment_id = String(values[1]);
                  return { rows: [] };
                }

                if (text.includes("UPDATE trip_requests") && text.includes("SET payment_status='paid_online'")) {
                  trip.payment_status = "paid_online";
                  trip.razorpay_payment_id = String(values[0]);
                  trip.updates += 1;
                  return { rows: [] };
                }

                throw new Error(`Unhandled SQL in replay simulation: ${text}`);
              },
            }),
          ),
      },
    }));

    const { settleCustomerRidePaymentByOrder } = await import("../../server/payment-settlement");

    const results = await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        settleCustomerRidePaymentByOrder({
          orderId: "order-replay-1",
          paymentId: `payment-replay-${index}`,
          source: index % 2 === 0 ? "app_verify" : "webhook",
          customerId: "cust-1",
        }),
      ),
    );

    expect(results.filter((result) => result.status === "settled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "already_processed")).toHaveLength(999);
    expect(paymentRow.status).toBe("completed");
    expect(bookingIntent.status).toBe("payment_verified");
    expect(trip.payment_status).toBe("paid_online");
    expect(trip.updates).toBe(1);
  });

  it("1000-user concurrency simulation settles 1000 unique ride payments without cross-talk", async () => {
    const rows = new Map(
      Array.from({ length: 1000 }, (_, index) => [
        `order-${index}`,
        {
          customer_id: `cust-${index}`,
          amount: 100 + index,
          trip_id: `trip-${index}`,
          booking_intent_id: `intent-${index}`,
          status: "pending",
          tripUpdates: 0,
        },
      ]),
    );

    vi.doMock("../../server/db", () => ({
      db: {
        transaction: async (cb: (tx: any) => Promise<any>) =>
          cb({
            execute: async (query: SqlLike) => {
              const text = sqlText(query);
              const values = sqlValues(query);

              if (text.includes("UPDATE customer_payments") && text.includes("status='pending'")) {
                const orderId = String(values[1]);
                const row = rows.get(orderId);
                if (!row || row.status !== "pending") return { rows: [] };
                row.status = "completed";
                return {
                  rows: [
                    {
                      customer_id: row.customer_id,
                      amount: row.amount,
                      trip_id: row.trip_id,
                      booking_intent_id: row.booking_intent_id,
                    },
                  ],
                };
              }

              if (text.includes("SELECT customer_id, trip_id, booking_intent_id") && text.includes("status='completed'")) {
                const orderId = String(values[0]);
                const row = rows.get(orderId);
                return row && row.status === "completed"
                  ? {
                      rows: [
                        {
                          customer_id: row.customer_id,
                          trip_id: row.trip_id,
                          booking_intent_id: row.booking_intent_id,
                        },
                      ],
                    }
                  : { rows: [] };
              }

              if (text.includes("UPDATE booking_intents")) {
                return { rows: [] };
              }

              if (text.includes("UPDATE trip_requests") && text.includes("SET payment_status='paid_online'")) {
                const tripId = String(values[1]);
                const row = Array.from(rows.values()).find((entry) => entry.trip_id === tripId);
                if (row) row.tripUpdates += 1;
                return { rows: [] };
              }

              throw new Error(`Unhandled SQL in 1000-user simulation: ${text}`);
            },
          }),
      },
    }));

    const { settleCustomerRidePaymentByOrder } = await import("../../server/payment-settlement");

    const results = await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        settleCustomerRidePaymentByOrder({
          orderId: `order-${index}`,
          paymentId: `payment-${index}`,
          source: "app_verify",
          customerId: `cust-${index}`,
        }),
      ),
    );

    expect(results.every((result) => result.status === "settled")).toBe(true);
    expect(Array.from(rows.values()).every((row) => row.status === "completed")).toBe(true);
    expect(Array.from(rows.values()).every((row) => row.tripUpdates === 1)).toBe(true);
  });

  it("withdrawal approval and rejection race resolves with one terminal winner and at most one refund", async () => {
    const state = {
      driverPaymentStatus: "pending",
      withdrawStatus: "pending",
      walletBalance: 500,
      walletEvents: 0,
      refundTransactions: 0,
    };
    const runExclusive = createMutex();

    vi.doMock("../../server/db", () => ({
      db: {
        transaction: (cb: (tx: any) => Promise<any>) =>
          runExclusive(() =>
            cb({
              execute: async (query: SqlLike) => {
                const text = sqlText(query);

                if (text.includes("UPDATE driver_payments") && text.includes("status='completed'")) {
                  if (state.driverPaymentStatus !== "pending") return { rows: [] };
                  state.driverPaymentStatus = "completed";
                  return { rows: [{ id: "pay-1" }] };
                }

                if (text.includes("UPDATE withdraw_requests") && text.includes("status='approved'")) {
                  if (state.withdrawStatus === "pending") state.withdrawStatus = "approved";
                  return { rows: [] };
                }

                if (text.includes("UPDATE driver_payments") && text.includes("status='rejected'")) {
                  if (state.driverPaymentStatus !== "pending") return { rows: [] };
                  state.driverPaymentStatus = "rejected";
                  return { rows: [{ driver_id: "driver-1", amount: 125 }] };
                }

                if (text.includes("SELECT wallet_balance") && text.includes("FOR UPDATE")) {
                  return { rows: [{ wallet_balance: state.walletBalance }] };
                }

                if (text.includes("UPDATE users") && text.includes("wallet_balance = wallet_balance +")) {
                  state.walletBalance += 125;
                  return { rows: [{ wallet_balance: state.walletBalance }] };
                }

                if (text.includes("INSERT INTO wallet_events")) {
                  state.walletEvents += 1;
                  return { rows: [] };
                }

                if (text.includes("INSERT INTO transactions") && text.includes("withdrawal_refund")) {
                  state.refundTransactions += 1;
                  return { rows: [] };
                }

                if (text.includes("UPDATE withdraw_requests") && text.includes("status='rejected'")) {
                  if (state.withdrawStatus === "pending") state.withdrawStatus = "rejected";
                  return { rows: [] };
                }

                throw new Error(`Unhandled SQL in withdrawal simulation: ${text}`);
              },
            }),
          ),
      },
      pool: {
        query: async () => ({ rowCount: 1, rows: [{ tablename: "wallet_events" }] }),
      },
    }));

    const { approveWithdrawal, rejectWithdrawal } = await import("../../server/revenue-engine");

    await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        index % 2 === 0 ? approveWithdrawal("pay-1") : rejectWithdrawal("pay-1"),
      ),
    );

    expect(["completed", "rejected"]).toContain(state.driverPaymentStatus);
    expect(["approved", "rejected"]).toContain(state.withdrawStatus);
    expect(state.walletEvents).toBeLessThanOrEqual(1);
    expect(state.refundTransactions).toBeLessThanOrEqual(1);

    if (state.driverPaymentStatus === "completed") {
      expect(state.withdrawStatus).toBe("approved");
      expect(state.walletEvents).toBe(0);
      expect(state.refundTransactions).toBe(0);
    } else {
      expect(state.withdrawStatus).toBe("rejected");
      expect(state.walletEvents).toBe(1);
      expect(state.refundTransactions).toBe(1);
      expect(state.walletBalance).toBe(625);
    }
  });
});
