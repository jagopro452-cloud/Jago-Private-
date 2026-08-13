import { expect, test } from "@playwright/test";
import { JagoApiClient } from "../support/api-client";
import { bookingTypes } from "../support/runtime";

test.describe("Booking Recovery Matrix", () => {
  for (const bookingType of bookingTypes) {
    test(`preserves accepted recovery state for ${bookingType.label}`, async () => {
      const api = await JagoApiClient.create();
      const booking = await api.createBooking(bookingType.key);
      await api.acceptBooking(booking.id);

      const recovery = await api.recoverBooking(booking.id);
      expect(recovery.bookingId).toBe(booking.id);
      expect(recovery.status).toBe("accepted");
      expect(Array.isArray(recovery.history)).toBeTruthy();
      expect(recovery.history.at(-1)?.status).toBe("accepted");

      await api.dispose();
    });
  }

  test("preserves paid recovery state after payment verification", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("cab");
    const order = await api.createPaymentOrder(booking.id);
    const verifyResponse = await api.verifyPayment(booking.id, order.orderId);
    expect(verifyResponse.ok()).toBeTruthy();

    const recovery = await api.recoverBooking(booking.id);
    expect(recovery.status).toBe("paid");
    expect(recovery.paymentStatus).toBe("paid");
    expect(recovery.history.at(-1)?.status).toBe("paid");

    await api.dispose();
  });
});
