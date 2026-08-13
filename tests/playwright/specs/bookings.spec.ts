import { expect, test } from "@playwright/test";
import { JagoApiClient } from "../support/api-client";
import { bookingTypes } from "../support/runtime";

test.describe("Bookings", () => {
  for (const bookingType of bookingTypes) {
    test(`creates a ${bookingType.label} booking`, async () => {
      const api = await JagoApiClient.create();
      const booking = await api.createBooking(bookingType.key);
      expect(booking.serviceType).toBe(bookingType.key);
      expect(booking.status).toBe("pending");
      expect(booking.pickupOtp).toBeTruthy();
      await api.dispose();
    });
  }
});
