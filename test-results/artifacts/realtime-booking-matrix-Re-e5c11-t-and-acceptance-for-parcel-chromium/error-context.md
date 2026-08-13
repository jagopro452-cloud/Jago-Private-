# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: realtime-booking-matrix.spec.ts >> Realtime Booking Matrix >> streams snapshot and acceptance for parcel
- Location: tests\playwright\specs\realtime-booking-matrix.spec.ts:10:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 0
+ Received  + 1

  Array [
    "snapshot",
    "accepted",
+   "accepted",
  ]

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { io as socketClient } from "socket.io-client";
  3  | import { JagoApiClient } from "../support/api-client";
  4  | import { runtime } from "../support/runtime";
  5  | 
  6  | const realtimeBookingTypes = ["cab", "parcel", "local_pool", "outstation_pool"] as const;
  7  | 
  8  | test.describe("Realtime Booking Matrix", () => {
  9  |   for (const serviceType of realtimeBookingTypes) {
  10 |     test(`streams snapshot and acceptance for ${serviceType}`, async () => {
  11 |       const api = await JagoApiClient.create();
  12 |       const booking = await api.createBooking(serviceType);
  13 |       const events: Array<{ event: string; payload: any }> = [];
  14 | 
  15 |       const socket = socketClient(runtime.apiBaseURL, {
  16 |         transports: ["websocket"],
  17 |         query: {
  18 |           userId: runtime.customerId,
  19 |           bookingId: booking.id,
  20 |         },
  21 |       });
  22 | 
  23 |       await new Promise<void>((resolve, reject) => {
  24 |         const timer = setTimeout(() => reject(new Error("socket connect timeout")), 10_000);
  25 |         socket.on("connect", () => {
  26 |           clearTimeout(timer);
  27 |           resolve();
  28 |         });
  29 |       });
  30 | 
  31 |       socket.on("booking:snapshot", (payload) => events.push({ event: "snapshot", payload }));
  32 |       socket.on("trip:accepted", (payload) => events.push({ event: "accepted", payload }));
  33 | 
  34 |       await api.acceptBooking(booking.id);
  35 | 
  36 |       await expect
  37 |         .poll(() => events.map((item) => item.event))
> 38 |         .toEqual(["snapshot", "accepted"]);
     |          ^ Error: expect(received).toEqual(expected) // deep equality
  39 |       expect(events[1]?.payload?.serviceType).toBe(serviceType);
  40 |       expect(events[1]?.payload?.status).toBe("accepted");
  41 | 
  42 |       socket.close();
  43 |       await api.dispose();
  44 |     });
  45 |   }
  46 | });
  47 | 
```