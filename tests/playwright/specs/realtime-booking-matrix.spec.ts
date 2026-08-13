import { expect, test } from "@playwright/test";
import { io as socketClient } from "socket.io-client";
import { JagoApiClient } from "../support/api-client";
import { runtime } from "../support/runtime";

const realtimeBookingTypes = ["cab", "parcel", "local_pool", "outstation_pool"] as const;

test.describe("Realtime Booking Matrix", () => {
  for (const serviceType of realtimeBookingTypes) {
    test(`streams snapshot and acceptance for ${serviceType}`, async () => {
      const api = await JagoApiClient.create();
      const booking = await api.createBooking(serviceType);
      const events: Array<{ event: string; payload: any }> = [];

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

      socket.on("booking:snapshot", (payload) => events.push({ event: "snapshot", payload }));
      socket.on("trip:accepted", (payload) => events.push({ event: "accepted", payload }));

      await api.acceptBooking(booking.id);

      await expect
        .poll(() => events.map((item) => item.event))
        .toEqual(["snapshot", "accepted"]);
      expect(events[1]?.payload?.serviceType).toBe(serviceType);
      expect(events[1]?.payload?.status).toBe("accepted");

      socket.close();
      await api.dispose();
    });
  }
});
