import { expect, test } from "@playwright/test";
import { JagoApiClient } from "../support/api-client";

test.describe("Driver Accept Reject", () => {
  test("driver accept returns active trip state and otps", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("auto");
    const accepted = await api.acceptBooking(booking.id);
    expect(accepted.status).toBe("accepted");
    expect(accepted.pickupOtp).toBeTruthy();
    expect(accepted.deliveryOtp).toBeTruthy();
    await api.dispose();
  });

  test("driver reject records the rejected state", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("parcel");
    const rejected = await api.rejectBooking(booking.id);
    expect(rejected.status).toBe("rejected");
    await api.dispose();
  });
});
