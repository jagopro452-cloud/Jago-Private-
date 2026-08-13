import { expect, test } from "@playwright/test";
import type { Socket } from "socket.io-client";
import { LiveClient, type MobileSession } from "../support/live-client";
import { createManagedRideBooking } from "../support/live-booking-manager";
import { createQaTag, runtime } from "../support/runtime";
import {
  connectLiveSocket,
  extractTripId,
  waitForConnect,
  waitForSocketEventAny,
  waitForSocketEvent,
} from "../support/live-utils";
import { markLiveBookingReleased, recordLiveArtifact, recordLiveNote } from "../support/live-suite-state";

test.describe("Live Race And Recovery", () => {
  test.describe.configure({ mode: "serial" });

  test("@live validates driver accept race handling and prevents duplicate production claims", async () => {
    const client = await LiveClient.create();
    let customerSocket: Socket | null = null;
    let driverOneSocket: Socket | null = null;
    let driverTwoSocket: Socket | null = null;

    try {
      const bootstrap = await client.seedTestAccounts();
      const customer = bootstrap.sessions?.customers?.find((entry) => entry.phone === runtime.liveCustomerPhone)?.session;
      const driverOne = bootstrap.sessions?.drivers?.find((entry) => entry.phone === "9100000002")?.session;
      const driverTwo = bootstrap.sessions?.drivers?.find((entry) => entry.phone === "9100000003")?.session;
      if (!customer || !driverOne || !driverTwo) {
        throw new Error("Seed bootstrap did not return reusable customer/driver sessions.");
      }

      await client.bestEffortCancelActiveTrip(customer, createQaTag("race pre-cleanup"));
      const bikePhones = ["9100000001", "9100000002", "9100000003", "9100000004"];
      for (const phone of bikePhones) {
        const bikeDriver = bootstrap.sessions?.drivers?.find((entry) => entry.phone === phone)?.session;
        if (!bikeDriver) {
          throw new Error(`Missing seeded driver session for ${phone}`);
        }
        await client.setDriverOnlineStatus(bikeDriver, { isOnline: false, lat: runtime.ridePickupLat, lng: runtime.ridePickupLng });
      }
      driverOneSocket = await connectAuthenticatedSocket(client, driverOne, "driver");
      driverTwoSocket = await connectAuthenticatedSocket(client, driverTwo, "driver");

      for (const socket of [driverOneSocket, driverTwoSocket]) {
        socket.emit("driver:online", {
          isOnline: true,
          lat: runtime.ridePickupLat,
          lng: runtime.ridePickupLng,
        });
        await waitForSocketEvent(socket, "driver:online_ack");
      }

      const bikeCategory = await client.getCategoryByLabel("bike");
      const managed = await createManagedRideBooking(client, "race-recovery", () => ({
        pickupAddress: createQaTag("Hyderabad QA race pickup"),
        pickupLat: runtime.ridePickupLat,
        pickupLng: runtime.ridePickupLng,
        destinationAddress: createQaTag("Hyderabad QA race destination"),
        destinationLat: runtime.rideDestinationLat,
        destinationLng: runtime.rideDestinationLng,
        vehicleCategoryId: bikeCategory.id,
        vehicleType: bikeCategory.vehicleType || bikeCategory.serviceType || bikeCategory.name.toLowerCase(),
        estimatedFare: 179,
        estimatedDistance: 6.9,
        paymentMethod: "cash",
      }));
      const rideCustomer = managed.customer;
      customerSocket = await connectAuthenticatedSocket(client, rideCustomer, "customer");
      const tripId = managed.tripId || extractTripId(managed.booking) || extractTripId(await client.getCustomerActiveTrip(rideCustomer));
      expect(tripId).toBeTruthy();
      await recordLiveArtifact("tripIds", String(tripId));
      customerSocket.emit("customer:track_trip", { tripId });

      await waitForIncomingTripAssignment(client, [driverOne, driverTwo], String(tripId));

      const rejectedBy: string[] = [];
      driverOneSocket.once("driver:accept_trip_error", () => rejectedBy.push(driverOne.user.id));
      driverTwoSocket.once("driver:accept_trip_error", () => rejectedBy.push(driverTwo.user.id));

      // Arm the customer listener before emitting accepts so we do not miss a fast
      // trip:driver_assigned/trip:accepted event under low-latency local runs.
      const assignmentPromise = waitForSocketEventAny<any>(customerSocket, ["trip:driver_assigned", "trip:accepted"], 25_000);

      driverOneSocket.emit("driver:accept_trip", { tripId });
      driverTwoSocket.emit("driver:accept_trip", { tripId });

      const assignment = await assignmentPromise;
      const claimedDriverId = assignment.payload?.driver?.id || assignment.payload?.driverId || null;
      expect(claimedDriverId).toBeTruthy();

      if (rejectedBy.length === 0) {
        await recordLiveNote(`Race validation saw backend single-claim resolution without socket error ack for trip ${tripId}.`);
      }

      const activeTrip = await client.getCustomerActiveTrip(rideCustomer);
      const claimedTrip = activeTrip?.trip || activeTrip?.activeTrip || activeTrip?.data || {};
      expect([driverOne.user.id, driverTwo.user.id]).toContain(claimedTrip?.driverId);
      expect(claimedTrip?.driverId).toBe(claimedDriverId);
      const cancel = await client.cancelCustomerTrip(rideCustomer, String(tripId), createQaTag("race cleanup cancel"));
      expect(cancel?.success).toBeTruthy();
      await markLiveBookingReleased(String(tripId));
    } finally {
      customerSocket?.close();
      driverOneSocket?.close();
      driverTwoSocket?.close();
      await client.dispose();
    }
  });
});

async function pickAvailableDrivers(client: LiveClient, sessions: Array<any>) {
  const available: Array<any> = [];
  for (const session of sessions) {
    const active = await client.getDriverActiveTrip(session);
    const trip = active?.trip || active?.activeTrip || active?.data || null;
    if (!trip?.id) {
      available.push(session);
    }
    if (available.length === 2) {
      return available as [any, any];
    }
  }
  throw new Error("Could not find two available QA drivers for race validation.");
}

async function connectAuthenticatedSocket(
  client: LiveClient,
  session: MobileSession,
  userType: "customer" | "driver",
) {
  let socket = connectLiveSocket(session.token, session.user.id, userType);
  try {
    await waitForConnect(socket, 10_000);
    return socket;
  } catch {
    socket.close();
    await client.refreshMobileSession(session);
    socket = connectLiveSocket(session.token, session.user.id, userType);
    await waitForConnect(socket, 20_000);
    return socket;
  }
}

async function waitForIncomingTripAssignment(
  client: LiveClient,
  sessions: MobileSession[],
  tripId: string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const session of sessions) {
      const incoming = await client.getDriverIncomingTrip(session);
      const incomingTripId = incoming?.trip?.tripId || incoming?.trip?.id || null;
      if (incomingTripId === tripId) {
        return incoming;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for incoming trip assignment for ${tripId}`);
}
