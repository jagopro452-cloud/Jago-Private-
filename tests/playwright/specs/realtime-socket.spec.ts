import { expect, test } from "@playwright/test";
import { io as socketClient } from "socket.io-client";
import { JagoApiClient } from "../support/api-client";
import { runtime } from "../support/runtime";

test.describe("Realtime Socket Validation", () => {
  test("customer receives acceptance and payment events", async () => {
    const api = await JagoApiClient.create();
    const booking = await api.createBooking("cab");

    const events: string[] = [];
    const socket = socketClient(runtime.apiBaseURL, {
      transports: ["websocket"],
      query: {
        userId: runtime.customerId,
        bookingId: booking.id,
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket connect timeout")), 10_000);
      socket.on("connect", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    socket.on("trip:accepted", () => events.push("accepted"));
    socket.on("payment:verified", () => events.push("payment"));

    await api.acceptBooking(booking.id);
    const order = await api.createPaymentOrder(booking.id);
    await api.verifyPayment(booking.id, order.orderId);

    await expect.poll(() => events).toEqual(["accepted", "payment"]);

    socket.close();
    await api.dispose();
  });
});
