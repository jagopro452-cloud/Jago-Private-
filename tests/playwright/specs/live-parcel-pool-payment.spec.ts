import { expect, test } from "@playwright/test";
import { LiveClient } from "../support/live-client";
import { createManagedRideBooking, getManagedCustomers } from "../support/live-booking-manager";
import { createQaTag, runtime } from "../support/runtime";
import { qaAddress, qaNote } from "../support/live-utils";
import { markLiveBookingReleased, recordLiveArtifact, requireLiveSuiteState } from "../support/live-suite-state";

test.describe("Live Parcel, Pool, and Payment", () => {
  test.describe.configure({ mode: "serial" });

  test("@live validates safe real parcel lifecycle, outstation pool lifecycle, and non-chargeable Razorpay flows", async () => {
    const client = await LiveClient.create();

    try {
      const sharedState = await requireLiveSuiteState();
      const bootstrap = await client.seedTestAccounts();
      const admin = sharedState.admin.session;
      const managedCustomers = await getManagedCustomers(client);
      const customer = managedCustomers[1]?.session || managedCustomers[0].session;
      const outstationDriver = bootstrap.sessions?.drivers?.find((entry) => entry.phone === "9100000009")?.session;
      expect(outstationDriver, "Seeded outstation driver session is required").toBeTruthy();

      await cleanupActiveParcelOrder(client, customer);

      const parcelQuote = await client.quoteParcel(customer, {
        vehicleCategory: "bike_parcel",
        pickupLat: runtime.ridePickupLat,
        pickupLng: runtime.ridePickupLng,
        totalDistanceKm: 4.8,
        weightKg: 1.2,
      });
      expect(parcelQuote?.vehicleName || parcelQuote?.vehicleCategory).toBeTruthy();

      const parcelBooking = await client.bookParcel(customer, {
        vehicleCategory: "bike_parcel",
        pickupAddress: qaAddress("parcel pickup"),
        pickupLat: runtime.ridePickupLat,
        pickupLng: runtime.ridePickupLng,
        pickupContactName: qaNote("parcel sender"),
        pickupContactPhone: "9000000666",
        dropLocations: [
          {
            address: qaAddress("parcel drop"),
            lat: runtime.rideDestinationLat,
            lng: runtime.rideDestinationLng,
            contactName: qaNote("parcel receiver"),
            contactPhone: "9000000777",
          },
        ],
        totalDistanceKm: 4.8,
        weightKg: 1.2,
        paymentMethod: "cash",
        notes: qaNote("parcel lifecycle note"),
        parcelDescription: qaNote("parcel lifecycle contents"),
      });
      const parcelOrderId = parcelBooking?.orderId || parcelBooking?.order?.id || parcelBooking?.id || parcelBooking?.data?.id;
      expect(parcelOrderId).toBeTruthy();
      await recordLiveArtifact("parcelOrderIds", String(parcelOrderId));
      const parcelCancel = await client.cancelParcel(customer, String(parcelOrderId), qaNote("parcel cleanup cancel"));
      expect(parcelCancel?.success).toBeTruthy();

      const today = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const outstation = await client.createOutstationRide(outstationDriver!, {
        fromCity: createQaTag("Hyderabad"),
        toCity: createQaTag("Bengaluru"),
        routeKm: 570,
        departureDate: today,
        departureTime: "09:30",
        totalSeats: 3,
        vehicleNumber: "TS09QA9001",
        vehicleModel: "QA Pool Sedan",
        farePerSeat: 1,
        note: qaNote("outstation pool lifecycle"),
      });
      const outstationRideId = outstation?.ride?.id;
      expect(outstationRideId).toBeTruthy();
      await recordLiveArtifact("outstationRideIds", String(outstationRideId));

      const search = await client.searchOutstationRides(customer, createQaTag("Hyderabad"), createQaTag("Bengaluru"), today);
      const liveRide = (search?.data || []).find((item: any) => item.id === outstationRideId);
      expect(liveRide).toBeTruthy();

      const booking = await client.bookOutstationRide(customer, {
        rideId: outstationRideId,
        seatsBooked: 1,
        pickupAddress: qaAddress("outstation pickup"),
        dropoffAddress: qaAddress("outstation drop"),
        paymentMethod: "cash",
      });
      expect(booking?.success).toBeTruthy();

      const adminOutstation = await client.getAdminOutstationRides(admin.token);
      const adminRide = (adminOutstation?.data || []).find((item: any) => item.id === outstationRideId);
      expect(adminRide).toBeTruthy();

      await client.deactivateOutstationRide(outstationDriver!, String(outstationRideId), qaNote("outstation cleanup inactive"));

      const diag = await client.getRazorpayDiag(admin.token);
      expect(diag?.status).toBe("ok");

      const walletOrder = await client.createWalletOrder(customer, 10);
      expect(walletOrder?.order?.id).toBeTruthy();

      const bikeCategory = sharedState.categories.bike;
      const managedRide = await createManagedRideBooking(client, "payment-diagnostic", () => ({
        pickupAddress: qaAddress("payment ride pickup"),
        pickupLat: 17.1555,
        pickupLng: 78.1555,
        destinationAddress: qaAddress("payment ride destination"),
        destinationLat: 17.1666,
        destinationLng: 78.1666,
        vehicleCategoryId: bikeCategory.id,
        vehicleType: bikeCategory.vehicleType || bikeCategory.serviceType || bikeCategory.name.toLowerCase(),
        estimatedFare: 129,
        estimatedDistance: 4.2,
        paymentMethod: "online",
      }));
      const paymentCustomer = managedRide.customer;
      const tempTripId = managedRide.tripId || managedRide.booking?.tripId || managedRide.booking?.trip?.id || (await client.getCustomerActiveTrip(paymentCustomer))?.trip?.id;
      expect(tempTripId).toBeTruthy();
      await recordLiveArtifact("tripIds", String(tempTripId));

      const rideOrder = await client.createRidePaymentOrder(paymentCustomer, 129, String(tempTripId));
      expect(rideOrder?.order?.id).toBeTruthy();
      const invalidVerify = await client.verifyRidePaymentInvalid(paymentCustomer, String(rideOrder.order.id));
      expect(String(invalidVerify?.message || "")).toMatch(/invalid payment signature/i);

      await client.cancelCustomerTrip(paymentCustomer, String(tempTripId), qaNote("payment test cleanup cancel"));
      await markLiveBookingReleased(String(tempTripId));
    } finally {
      await client.dispose();
    }
  });
});

async function cleanupActiveParcelOrder(client: LiveClient, customer: any) {
  try {
    const parcel = await client.bookParcel(customer, {
      vehicleCategory: "bike_parcel",
      pickupAddress: qaAddress("parcel preflight pickup"),
      pickupLat: runtime.ridePickupLat,
      pickupLng: runtime.ridePickupLng,
      pickupContactName: qaNote("parcel preflight sender"),
      pickupContactPhone: "9000000666",
      dropLocations: [
        {
          address: qaAddress("parcel preflight drop"),
          lat: runtime.rideDestinationLat,
          lng: runtime.rideDestinationLng,
          contactName: qaNote("parcel preflight receiver"),
          contactPhone: "9000000777",
        },
      ],
      totalDistanceKm: 1.1,
      weightKg: 0.5,
      paymentMethod: "cash",
      notes: qaNote("parcel preflight"),
      parcelDescription: qaNote("parcel preflight"),
    });
    const orderId = parcel?.orderId || parcel?.order?.id || parcel?.id || parcel?.data?.id;
    if (orderId) {
      await client.cancelParcel(customer, String(orderId), qaNote("parcel preflight cleanup"));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isActiveParcelConflict = /active parcel delivery in progress/i.test(message);
    const orderId = /"orderId":"([^"]+)"/i.exec(message)?.[1];
    if (!isActiveParcelConflict || !orderId) {
      return;
    }
    await client.cancelParcel(customer, orderId, qaNote("parcel stale cleanup"));
  }
}
