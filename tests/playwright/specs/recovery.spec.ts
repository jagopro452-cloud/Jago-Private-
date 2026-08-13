import { expect, test } from "@playwright/test";
import { JagoApiClient } from "../support/api-client";

test.describe("Reconnect Reload Recovery", () => {
  test("recovery endpoint returns latest accepted booking state", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("bike");
    await api.acceptBooking(booking.id);
    const snapshot = await api.recoverBooking(booking.id);
    expect(snapshot.status).toBe("accepted");
    await api.dispose();
  });

  test("recovery endpoint preserves paid state after reload", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("outstation_pool");
    const order = await api.createPaymentOrder(booking.id);
    await api.verifyPayment(booking.id, order.orderId);
    const snapshot = await api.recoverBooking(booking.id);
    expect(snapshot.paymentStatus).toBe("paid");
    await api.dispose();
  });
});
