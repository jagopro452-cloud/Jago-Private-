import { expect, test } from "@playwright/test";
import { JagoApiClient } from "../support/api-client";

test.describe("Payment Flow", () => {
  test("creates and verifies a payment successfully", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("cab");
    const order = await api.createPaymentOrder(booking.id);
    const verifyResponse = await api.verifyPayment(booking.id, order.orderId);
    expect(verifyResponse.ok()).toBeTruthy();
    const saved = await api.getBooking(booking.id);
    expect(saved.paymentStatus).toBe("paid");
    await api.dispose();
  });

  test("rejects an invalid payment signature", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("bike");
    const order = await api.createPaymentOrder(booking.id);
    const verifyResponse = await api.verifyPayment(booking.id, order.orderId, "pay_invalid", false);
    expect(verifyResponse.status()).toBe(400);
    await api.dispose();
  });
});
