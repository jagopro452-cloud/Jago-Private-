import { expect, test } from "@playwright/test";
import { LiveClient } from "../support/live-client";
import { pickCustomerForRideBooking } from "../support/live-booking-manager";
import { requireLiveSuiteState } from "../support/live-suite-state";
import { createQaTag, runtime } from "../support/runtime";
import { extractActiveTrip, extractTripId, qaAddress, qaNote } from "../support/live-utils";

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function readBody(response: { json: () => Promise<unknown>; text: () => Promise<string> }) {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

test.describe("Live Bug Regressions", () => {
  test.describe.configure({ mode: "serial" });

  test("@live verifies QA bootstrap, db validation, customer vehicle categories, booking race handling, scheduled ride state, and parcel idempotency", async () => {
    const client = await LiveClient.create();

    try {
      const state = await requireLiveSuiteState();
      const opsKey = runtime.opsApiKey || runtime.adminResetKey;
      expect(opsKey).toBeTruthy();

      const seedResponse = await client.get("/api/ops/seed-test-accounts", {
        "x-ops-key": opsKey,
      });
      expect(seedResponse.ok()).toBeTruthy();
      const seedBody: any = await seedResponse.json();
      expect(seedBody?.sessions?.customers?.length || 0).toBeGreaterThan(0);
      expect(seedBody?.sessions?.drivers?.length || 0).toBeGreaterThan(0);

      const dbValidation = await client.get("/api/ops/db-validation", {
        "x-ops-key": opsKey,
      });
      expect(dbValidation.ok()).toBeTruthy();

      const categoryResponse = await client.get("/api/app/vehicle-categories");
      expect(categoryResponse.ok()).toBeTruthy();
      const categoryBody: any = await categoryResponse.json();
      const categories = Array.isArray(categoryBody) ? categoryBody : Array.isArray(categoryBody?.data) ? categoryBody.data : [];
      expect(categories.length).toBeGreaterThan(0);

      const bikeCategory = state.categories.bike;
      const managedCustomer = await pickCustomerForRideBooking(client, "bug-regression-race");
      const customer = managedCustomer.session;

      await client.bestEffortCancelActiveTrip(customer, createQaTag("booking race pre-cleanup"));

      const ridePayload = {
        pickupAddress: qaAddress("race booking pickup"),
        pickupLat: runtime.ridePickupLat,
        pickupLng: runtime.ridePickupLng,
        destinationAddress: qaAddress("race booking destination"),
        destinationLat: runtime.rideDestinationLat,
        destinationLng: runtime.rideDestinationLng,
        vehicleCategoryId: bikeCategory.id,
        vehicleType: bikeCategory.vehicleType || bikeCategory.serviceType || bikeCategory.name.toLowerCase(),
        estimatedFare: 189,
        estimatedDistance: 6.4,
        paymentMethod: "cash",
      };

      const [raceOne, raceTwo] = await Promise.all([
        client.post("/api/app/customer/book-ride", ridePayload, authHeaders(customer.token)),
        client.post("/api/app/customer/book-ride", ridePayload, authHeaders(customer.token)),
      ]);

      const raceBodies = [await readBody(raceOne), await readBody(raceTwo)];
      const raceStatuses = [raceOne.status(), raceTwo.status()].sort((a, b) => a - b);
      expect(raceStatuses).toEqual([200, 409]);
      expect(raceStatuses).not.toContain(500);

      const conflictBody = raceOne.status() === 409 ? raceBodies[0] : raceTwo.status() === 409 ? raceBodies[1] : null;
      expect(String((conflictBody as any)?.code || "")).toMatch(/ACTIVE_TRIP_EXISTS|BOOKING_ALREADY_EXISTS/);

      const successfulRaceBody = raceOne.status() === 200 ? raceBodies[0] : raceBodies[1];
      const raceTripId = extractTripId(successfulRaceBody);
      expect(raceTripId).toBeTruthy();
      await client.cancelCustomerTrip(customer, String(raceTripId), qaNote("booking race cleanup"));

      await client.bestEffortCancelActiveTrip(customer, createQaTag("scheduled ride pre-cleanup"));

      const scheduledAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      const scheduledResponse = await client.post("/api/app/customer/book-ride", {
        ...ridePayload,
        tripType: "scheduled",
        isScheduled: false,
        scheduledAt,
      }, authHeaders(customer.token));

      expect(scheduledResponse.ok()).toBeTruthy();
      const scheduledBody = await readBody(scheduledResponse);
      const scheduledTrip = extractActiveTrip(scheduledBody);
      expect(scheduledTrip?.isScheduled).toBe(true);
      expect(scheduledTrip?.currentStatus || scheduledTrip?.status).toBe("scheduled");
      expect(String(scheduledTrip?.tripType || "")).not.toBe("scheduled");

      const scheduledTripId = extractTripId(scheduledBody);
      expect(scheduledTripId).toBeTruthy();
      await client.cancelCustomerTrip(customer, String(scheduledTripId), qaNote("scheduled ride cleanup"));

      const parcelCustomer = state.actors.customerSecondary?.session || state.actors.customerPrimary.session;
      const parcelPayload = {
        vehicleCategory: "bike_parcel",
        pickupAddress: qaAddress("parcel idempotency pickup"),
        pickupLat: runtime.ridePickupLat,
        pickupLng: runtime.ridePickupLng,
        pickupContactName: qaNote("parcel sender"),
        pickupContactPhone: "9000000666",
        dropLocations: [
          {
            address: qaAddress("parcel idempotency drop"),
            lat: runtime.rideDestinationLat,
            lng: runtime.rideDestinationLng,
            contactName: qaNote("parcel receiver"),
            contactPhone: "9000000777",
          },
        ],
        totalDistanceKm: 4.2,
        weightKg: 1.1,
        paymentMethod: "cash",
        notes: qaNote("parcel idempotency note"),
        parcelDescription: qaNote("parcel idempotency contents"),
      };

      const firstParcel = await client.bookParcel(parcelCustomer, parcelPayload);
      const firstParcelOrderId = firstParcel?.orderId || firstParcel?.order?.id || firstParcel?.id || firstParcel?.data?.id;
      expect(firstParcelOrderId).toBeTruthy();

      const secondParcelResponse = await client.post("/api/app/parcel/book", parcelPayload, authHeaders(parcelCustomer.token));
      expect(secondParcelResponse.ok()).toBeTruthy();
      const secondParcelBody: any = await readBody(secondParcelResponse);
      expect(secondParcelBody?.idempotent).toBe(true);
      expect(secondParcelBody?.orderId).toBe(String(firstParcelOrderId));
      expect(String(secondParcelBody?.code || "")).toBe("PARCEL_ACTIVE_ORDER_EXISTS");

      const cancelOne = await client.post(`/api/app/parcel/${firstParcelOrderId}/cancel`, {
        reason: qaNote("parcel cancel 1"),
      }, authHeaders(parcelCustomer.token));
      const cancelTwo = await client.post(`/api/app/parcel/${firstParcelOrderId}/cancel`, {
        reason: qaNote("parcel cancel 2"),
      }, authHeaders(parcelCustomer.token));

      expect(cancelOne.ok()).toBeTruthy();
      expect(cancelTwo.ok()).toBeTruthy();
      const cancelBodies = [await readBody(cancelOne), await readBody(cancelTwo)] as any[];
      expect(cancelBodies.some((body) => body?.alreadyCancelled === true)).toBe(true);
    } finally {
      await client.dispose();
    }
  });
});
