import { expect, test } from "@playwright/test";
import type { Socket } from "socket.io-client";
import { LiveClient, type MobileSession } from "../support/live-client";
import { getManagedCustomers } from "../support/live-booking-manager";
import { createQaTag, runtime } from "../support/runtime";
import {
  connectLiveSocket,
  expectSocketNoEvent,
  extractActiveTrip,
  extractTripId,
  qaAddress,
  qaNote,
  waitForConnect,
  waitForSocketEventAny,
  waitForSocketEvent,
} from "../support/live-utils";
import { markLiveBookingReleased, recordLiveArtifact, recordLiveBookingEvent } from "../support/live-suite-state";

test.describe("Live Ride Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("@live validates real auth, sockets, GPS, chat, reconnect recovery, SOS, calling, and cash-trip consistency", async () => {
    const client = await LiveClient.create();
    let customerSocket: Socket | null = null;
    let driverSocket: Socket | null = null;
    const customerEvents: Array<{ event: string; payload: any }> = [];
    const driverEvents: Array<{ event: string; payload: any }> = [];

    try {
      const sharedState = await client.initializeSharedState();
      const managedCustomers = await getManagedCustomers(client);
      const seededCustomers = await client.getSeededCustomerSessions();
      const lifecycleCustomers = dedupeSessionsByPhone([
        ...managedCustomers.map((item) => item.session),
        ...seededCustomers,
      ]);
      const bikeDrivers = [
        sharedState.actors.driverBikePrimary.session,
        sharedState.actors.driverBikeSecondary.session,
        sharedState.actors.driverBikeTertiary.session,
        sharedState.actors.driverBikeQuaternary.session,
      ];

      for (const lifecycleCustomer of lifecycleCustomers) {
        await bestEffortReleaseLifecycleTrip(client, lifecycleCustomer, bikeDrivers);
        await client.bestEffortCancelActiveTrip(lifecycleCustomer, createQaTag("ride lifecycle pre-cleanup"));
      }
      const driver = await pickAvailableDriver(client, [
        ...bikeDrivers,
      ]);
      for (const bikeDriver of bikeDrivers) {
        await client.setDriverOnlineStatus(bikeDriver, { isOnline: false, lat: runtime.ridePickupLat, lng: runtime.ridePickupLng });
      }

      const walletSnapshots = new Map<string, any>();
      for (const managedCustomer of lifecycleCustomers) {
        walletSnapshots.set(
          managedCustomer.user.phone,
          await client.getCustomerWallet(managedCustomer),
        );
      }

      driverSocket = await connectAuthenticatedSocket(client, driver, "driver");

      driverSocket.emit("driver:online", {
        isOnline: true,
        lat: runtime.ridePickupLat,
        lng: runtime.ridePickupLng,
      });
      await waitForSocketEvent(driverSocket, "driver:online_ack");

      const bikeCategory = sharedState.categories.bike;
      const nearby = await client.getNearbyDrivers(bikeCategory.id);
      const nearbyIds = (nearby?.drivers || []).map((item: any) => item.id);
      expect(nearbyIds).toContain(driver.user.id);

      const bookingCustomer = await pickOrProvisionLifecycleCustomer(
        client,
        lifecycleCustomers,
      );
      const bookingPayload = {
        pickupAddress: qaAddress("ride lifecycle pickup"),
        pickupLat: runtime.ridePickupLat,
        pickupLng: runtime.ridePickupLng,
        pickupShortName: qaNote("pickup short"),
        destinationAddress: qaAddress("ride lifecycle destination"),
        destinationLat: runtime.rideDestinationLat,
        destinationLng: runtime.rideDestinationLng,
        destinationShortName: qaNote("destination short"),
        vehicleCategoryId: bikeCategory.id,
        vehicleType: bikeCategory.vehicleType || bikeCategory.serviceType || bikeCategory.name.toLowerCase(),
        estimatedFare: 199,
        estimatedDistance: 8.5,
        paymentMethod: "cash",
        tripType: "normal",
        isForSomeoneElse: true,
        passengerName: qaNote("ride passenger"),
        passengerPhone: "9000000998",
      };
      const booking = await client.bookRide(bookingCustomer, bookingPayload);
      const customer = bookingCustomer;
      const customerWalletBefore = walletSnapshots.get(customer.user.phone) || await client.getCustomerWallet(customer);
      const estimatedFareForCap = resolveEstimatedFare(booking, bookingPayload.estimatedFare);

      customerSocket = await connectAuthenticatedSocket(client, customer, "customer");
      const stopCustomerEventCapture = attachEventCapture(customerSocket, customerEvents);
      const stopDriverEventCapture = attachEventCapture(driverSocket, driverEvents);

      const tripId = extractTripId(booking) || extractTripId(await client.getCustomerActiveTrip(customer));
      expect(tripId).toBeTruthy();
      await recordLiveBookingEvent({
        id: String(tripId),
        customerPhone: customer.user.phone,
        kind: "ride-lifecycle",
      });
      await recordLiveArtifact("tripIds", String(tripId));
      customerSocket.emit("customer:track_trip", { tripId });

      await waitForIncomingTripAssignment(client, [driver], String(tripId));
      const assignEventPromise = waitForSocketEventAny<any>(customerSocket, ["trip:driver_assigned", "trip:accepted"]);
      await client.acceptTrip(driver, String(tripId));
      const assignEvent = await assignEventPromise;
      expect(assignEvent.payload?.tripId).toBe(String(tripId));
      driverSocket.emit("driver:rejoin_trip", { tripId });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const activeTrip = extractActiveTrip(await client.getCustomerActiveTrip(customer));
      const pickupOtp = String(activeTrip?.pickupOtp || activeTrip?.pickup_otp || assignEvent.payload?.pickupOtp || "");
      expect(pickupOtp).toHaveLength(4);

      const callIncoming = waitForSocketEvent<any>(driverSocket, "call:incoming", 20_000);
      customerSocket.emit("call:initiate", {
        targetUserId: driver.user.id,
        tripId,
        callerName: customer.user.fullName,
      });
      const incomingCall = await callIncoming;
      expect(incomingCall?.tripId).toBe(String(tripId));

      await client.markArrived(driver, String(tripId));
      const arrivedTrip = await waitForTripStatusViaApi(client, customer, String(tripId), "arrived");
      expect(String(arrivedTrip?.currentStatus || arrivedTrip?.status || "")).toBe("arrived");

      await client.startTrip(driver, String(tripId), pickupOtp);

      driverSocket.emit("driver:location", {
        lat: runtime.ridePickupLat + 0.001,
        lng: runtime.ridePickupLng + 0.001,
        heading: 96,
        speed: 18,
        etaSeconds: 240,
        remainingDistanceMeters: 4200,
      });
      const firstLocation = await waitForSocketEvent<any>(customerSocket, "driver:location_update");
      expect(firstLocation?.tripId).toBe(String(tripId));

      const chatEventPromise = waitForSocketEvent<any>(driverSocket, "trip:new_message");
      customerSocket.emit("trip:send_message", {
        tripId,
        message: qaNote("socket chat message"),
        senderName: customer.user.fullName,
        senderType: "customer",
      });
      const chatEvent = await chatEventPromise;
      expect(chatEvent?.message).toContain(runtime.qaRunId);

      const aiSosEvent = waitForSocketEvent<any>(driverSocket, "safety:sos", 20_000);
      await client.triggerAiSos(customer, {
        tripId,
        lat: runtime.ridePickupLat + 0.0012,
        lng: runtime.ridePickupLng + 0.0012,
        message: qaNote("AI SOS validation"),
      });
      const sos = await aiSosEvent;
      expect(sos?.tripId).toBe(String(tripId));

      await client.triggerSos(customer, {
        tripId,
        lat: runtime.ridePickupLat + 0.0013,
        lng: runtime.ridePickupLng + 0.0013,
        message: qaNote("Standard SOS validation"),
      });

      customerSocket.close();
      customerSocket = await connectAuthenticatedSocket(client, customer, "customer");
      customerSocket.emit("customer:track_trip", { tripId });
      await expectSocketNoEvent(customerSocket, "auth:error", 2_000);

      driverSocket.emit("driver:location", {
        lat: runtime.ridePickupLat + 0.002,
        lng: runtime.ridePickupLng + 0.002,
        heading: 110,
        speed: 24,
        etaSeconds: 120,
        remainingDistanceMeters: 1200,
      });
      const reconnectLocation = await waitForSocketEvent<any>(customerSocket, "driver:location_update");
      expect(reconnectLocation?.tripId).toBe(String(tripId));

      await client.completeTrip(driver, String(tripId), 199);
      await markLiveBookingReleased(String(tripId));
      const customerReceipt = await client.getCustomerTripReceipt(customer, String(tripId));
      const driverReceipt = await client.getDriverTripReceipt(driver, String(tripId));
      expect(customerReceipt?.receipt?.tripId || customerReceipt?.receipt?.orderId || customerReceipt?.tripId).toBeTruthy();
      expect(driverReceipt?.receipt?.tripId || driverReceipt?.receipt?.orderId || driverReceipt?.tripId).toBeTruthy();

      const customerWalletAfter = await client.getCustomerWallet(customer);
      const expectedFareCapRefund = calculateFareCapRefund(estimatedFareForCap, 199);
      expect(Number(customerWalletAfter?.balance || 0)).toBe(
        Number((Number(customerWalletBefore?.balance || 0) + expectedFareCapRefund).toFixed(2)),
      );

      const supportSend = await client.sendCustomerSupportChat(customer, qaNote("support chat validation"));
      expect(supportSend?.success).toBeTruthy();
      const supportHistory = await client.getCustomerSupportChat(customer);
      const messages = supportHistory?.messages || [];
      expect(messages.some((item: any) => String(item.message || "").includes(runtime.qaRunId))).toBeTruthy();

      console.log("[LIFECYCLE_EVENTS][CUSTOMER]", JSON.stringify(customerEvents));
      console.log("[LIFECYCLE_EVENTS][DRIVER]", JSON.stringify(driverEvents));
      stopCustomerEventCapture();
      stopDriverEventCapture();
    } finally {
      try {
        driverSocket?.emit("driver:online", { isOnline: false });
      } catch {
        // Best effort.
      }
      customerSocket?.close();
      driverSocket?.close();
      await client.dispose();
    }
  });
});

async function pickAvailableDriver(client: LiveClient, sessions: MobileSession[]) {
  for (const session of sessions) {
    const active = await client.getDriverActiveTrip(session);
    const activeTrip = active?.trip || active?.activeTrip || active?.data || null;
    if (!activeTrip?.id) {
      return session;
    }
  }
  throw new Error("No available QA driver found for live ride lifecycle.");
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

async function pickOrProvisionLifecycleCustomer(client: LiveClient, sessions: MobileSession[]) {
  const candidateStates: Array<{ session: MobileSession; tripId: string | null; status: string | null }> = [];

  for (const session of sessions) {
    try {
      const body = await client.getCustomerActiveTrip(session);
      const activeTrip = extractActiveTrip(body);
      const tripId = String(activeTrip?.id || body?.tripId || "").trim() || null;
      const status = String(activeTrip?.currentStatus || activeTrip?.status || body?.status || "").trim().toLowerCase() || null;
      candidateStates.push({ session, tripId, status });
      if (!tripId || !status || ["completed", "cancelled"].includes(status)) {
        return session;
      }
    } catch {
      candidateStates.push({ session, tripId: null, status: null });
      return session;
    }
  }

  const summary = candidateStates
    .map((item) => `${item.session.user.phone}:${item.status || "none"}:${item.tripId || "none"}`)
    .join(", ");
  const provisioned = await provisionTemporaryLifecycleCustomer(client);
  console.log(`[LIFECYCLE_CUSTOMER_FALLBACK] managed customers unavailable, provisioned ${provisioned.user.phone}. states=${summary}`);
  return provisioned;
}

async function bestEffortReleaseLifecycleTrip(
  client: LiveClient,
  customer: MobileSession,
  driverSessions: MobileSession[],
) {
  try {
    const body = await client.getCustomerActiveTrip(customer);
    const activeTrip = extractActiveTrip(body);
    const tripId = String(activeTrip?.id || body?.tripId || "").trim();
    const status = String(activeTrip?.currentStatus || activeTrip?.status || body?.status || "").trim().toLowerCase();
    if (!tripId || !status || ["completed", "cancelled", "payment_pending"].includes(status)) {
      return;
    }
    if (["searching", "pending", "driver_assigned", "accepted"].includes(status)) {
      await client.cancelCustomerTrip(customer, tripId, createQaTag("ride lifecycle forced cleanup"));
      return;
    }
    if (["on_the_way", "started", "in_progress", "ongoing", "arrived"].includes(status)) {
      for (const driverSession of driverSessions) {
        try {
          const driverActive = await client.getDriverActiveTrip(driverSession);
          const driverTrip = extractActiveTrip(driverActive);
          const driverTripId = String(driverTrip?.id || driverActive?.tripId || "").trim();
          if (driverTripId !== tripId) continue;
          await client.completeTrip(driverSession, tripId, 199);
          return;
        } catch {
          // Try the next driver session.
        }
      }
    }
  } catch {
    // Best effort cleanup only.
  }
}

function dedupeSessionsByPhone(sessions: MobileSession[]) {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    const phone = String(session.user?.phone || "").trim();
    if (!phone || seen.has(phone)) {
      return false;
    }
    seen.add(phone);
    return true;
  });
}

function resolveEstimatedFare(booking: any, fallback: number) {
  const value = booking?.trip?.estimatedFare
    || booking?.trip?.estimated_fare
    || booking?.booking?.estimatedFare
    || booking?.booking?.estimated_fare
    || booking?.estimatedFare
    || booking?.estimated_fare
    || fallback;
  return Number(value || fallback);
}

function calculateFareCapRefund(estimatedFare: number, actualFare: number) {
  const maxFareMultiplier = 1.5;
  const hardCap = 10_000;
  const cappedFare = Math.min(actualFare, estimatedFare * maxFareMultiplier, hardCap);
  return actualFare > cappedFare ? Number((actualFare - cappedFare).toFixed(2)) : 0;
}

async function provisionTemporaryLifecycleCustomer(client: LiveClient) {
  const seed = `${Date.now()}`.slice(-8);
  const phone = `98${seed}`;
  return client.registerMobile({
    phone,
    password: runtime.liveMobilePassword,
    fullName: qaNote("Lifecycle Temp Customer"),
    userType: "customer",
    email: `qa+lifecycle-${seed}@jago.test`,
  });
}

function attachEventCapture(socket: Socket, bucket: Array<{ event: string; payload: any }>) {
  const interesting = new Set([
    "trip:new_message",
    "trip:status_update",
    "trip:update",
    "trip:completed",
    "trip:driver_assigned",
    "trip:accepted",
    "driver:location_update",
    "notification",
    "notification:new",
    "safety:sos",
    "call:incoming",
  ]);
  const handler = (event: string, payload: any) => {
    if (!interesting.has(event)) return;
    bucket.push({ event, payload });
  };
  socket.onAny(handler);
  return () => socket.offAny(handler);
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

async function waitForTripStatus(socket: Socket, expectedStatus: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await waitForSocketEvent<any>(socket, "trip:status_update", Math.max(1_000, deadline - Date.now()));
    if (String(payload?.status || "").toLowerCase() === expectedStatus.toLowerCase()) {
      return payload;
    }
  }
  throw new Error(`Timed out waiting for trip status ${expectedStatus}`);
}

async function waitForTripStatusViaApi(
  client: LiveClient,
  session: MobileSession,
  tripId: string,
  expectedStatus: string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activeTripBody = await client.getCustomerActiveTrip(session);
    const activeTrip = extractActiveTrip(activeTripBody);
    const activeTripId = String(activeTrip?.id || activeTripBody?.tripId || "");
    const status = String(activeTrip?.currentStatus || activeTrip?.status || "").toLowerCase();
    if (activeTripId === tripId && status === expectedStatus.toLowerCase()) {
      return activeTrip;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for API trip status ${expectedStatus}`);
}
