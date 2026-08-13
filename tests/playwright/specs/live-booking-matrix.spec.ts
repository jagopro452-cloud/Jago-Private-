import { expect, test } from "@playwright/test";
import { LiveClient } from "../support/live-client";
import { createManagedRideBooking, getManagedCustomers } from "../support/live-booking-manager";
import { createQaTag } from "../support/runtime";
import { extractTripId, qaAddress } from "../support/live-utils";
import { markLiveBookingReleased, recordLiveArtifact, requireLiveSuiteState } from "../support/live-suite-state";

test.describe("Live Booking Matrix", () => {
  test.describe.configure({ mode: "serial" });

  test("@live creates and safely cancels real production bookings for bike, auto, cab, and local pool", async () => {
    const client = await LiveClient.create();

    try {
      const sharedState = await requireLiveSuiteState();
      const customers = await getManagedCustomers(client);
      for (const customer of customers) {
        await client.bestEffortCancelActiveTrip(customer.session, createQaTag("pre-test cleanup"));
      }

      for (const variant of [
        { label: "bike", tripType: "normal" },
        { label: "auto", tripType: "normal" },
        { label: "cab", tripType: "normal" },
        { label: "pool", tripType: "pool" },
      ] as const) {
        const category = variant.label === "bike"
          ? sharedState.categories.bike
          : variant.label === "auto"
            ? sharedState.categories.auto
            : variant.label === "cab"
              ? sharedState.categories.cab
              : (sharedState.categories.pool || await client.getCategoryByLabel("pool"));
        const managed = await createManagedRideBooking(client, `booking-matrix:${variant.label}`, () => ({
          pickupAddress: qaAddress(`${variant.label} pickup`),
          pickupLat: 17.385,
          pickupLng: 78.4867,
          pickupShortName: createQaTag(`${variant.label} pickup short`),
          destinationAddress: qaAddress(`${variant.label} destination`),
          destinationLat: 17.4474,
          destinationLng: 78.3762,
          destinationShortName: createQaTag(`${variant.label} destination short`),
          vehicleCategoryId: category.id,
          vehicleType: category.vehicleType || category.serviceType || category.name.toLowerCase(),
          estimatedFare: variant.label === "pool" ? 89 : 149,
          estimatedDistance: 6.2,
          paymentMethod: "cash",
          tripType: variant.tripType,
          isForSomeoneElse: true,
          passengerName: createQaTag(`${variant.label} passenger`),
          passengerPhone: "9000000999",
        }));

        const tripId = managed.tripId || extractTripId(managed.booking) || extractTripId(await client.getCustomerActiveTrip(managed.customer));
        expect(tripId, `Trip ID missing for ${variant.label}`).toBeTruthy();
        await recordLiveArtifact("tripIds", String(tripId));

        const cancel = await client.cancelCustomerTrip(managed.customer, String(tripId), createQaTag(`${variant.label} live cleanup cancel`));
        expect(cancel?.success).toBeTruthy();
        await markLiveBookingReleased(String(tripId));
      }
    } finally {
      await client.dispose();
    }
  });
});
