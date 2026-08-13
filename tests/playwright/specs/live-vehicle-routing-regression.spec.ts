import { expect, test } from "@playwright/test";
import { LiveClient } from "../support/live-client";
import { createQaTag } from "../support/runtime";
import { qaNote } from "../support/live-utils";

test.describe("Live Vehicle Routing Regression", () => {
  test.describe.configure({ mode: "serial" });

  test("@live keeps bike/auto/cab service eligibility isolated and blocks non-cab outstation pool creation", async () => {
    const client = await LiveClient.create();

    try {
      const sharedState = await client.initializeSharedState();
      const bikeDriver = sharedState.actors.driverBikePrimary.session;
      const autoDriver = sharedState.actors.driverAutoPrimary?.session;
      const cabDriver = sharedState.actors.driverCabPrimary.session;

      expect(autoDriver, "Auto driver seed session is required for category regression coverage").toBeTruthy();

      const [bikeEligible, autoEligible, cabEligible] = await Promise.all([
        client.getDriverEligibleServices(bikeDriver),
        client.getDriverEligibleServices(autoDriver!),
        client.getDriverEligibleServices(cabDriver),
      ]);

      const bikeServiceKeys = new Set((bikeEligible.services || []).map((item) => item.key));
      const autoServiceKeys = new Set((autoEligible.services || []).map((item) => item.key));
      const cabServiceKeys = new Set((cabEligible.services || []).map((item) => item.key));

      expect(bikeServiceKeys.has("bike_ride")).toBeTruthy();
      expect(bikeServiceKeys.has("auto_ride")).toBeFalsy();
      expect(bikeServiceKeys.has("mini_car") || bikeServiceKeys.has("sedan") || bikeServiceKeys.has("suv")).toBeFalsy();

      expect(autoServiceKeys.has("auto_ride")).toBeTruthy();
      expect(autoServiceKeys.has("bike_ride")).toBeFalsy();
      expect(autoServiceKeys.has("city_pool")).toBeFalsy();
      expect(autoServiceKeys.has("outstation_pool")).toBeFalsy();

      expect(cabServiceKeys.has("mini_car") || cabServiceKeys.has("sedan") || cabServiceKeys.has("suv")).toBeTruthy();
      expect(cabServiceKeys.has("city_pool")).toBeFalsy();
      expect(cabServiceKeys.has("outstation_pool")).toBeFalsy();
      expect(cabServiceKeys.has("parcel_delivery")).toBeFalsy();

      const bikeParcelKeys = new Set((bikeEligible.parcelVehicles || []).map((item) => item.key));
      const autoParcelKeys = new Set((autoEligible.parcelVehicles || []).map((item) => item.key));
      expect(bikeParcelKeys.has("bike_parcel")).toBeFalsy();
      expect(autoParcelKeys.has("auto_parcel")).toBeFalsy();
      expect(autoParcelKeys.has("bike_parcel")).toBeFalsy();

      const autoOutstationModule = (autoEligible.modules || []).find((item) => item.key === "outstation_pool");
      const cabOutstationModule = (cabEligible.modules || []).find((item) => item.key === "outstation_pool");
      expect(autoOutstationModule?.availableByCategory || autoOutstationModule?.enabled).toBeFalsy();
      expect(cabOutstationModule?.enabled).toBeFalsy();
      expect(JSON.stringify(cabOutstationModule?.blockedReasons || [])).toMatch(/documents_missing|seat_capacity_low|admin_or_vehicle_not_enabled/i);

      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const basePayload = {
        fromCity: createQaTag("Hyderabad"),
        toCity: createQaTag("Bengaluru"),
        routeKm: 570,
        departureDate: tomorrow,
        departureTime: "10:30",
        totalSeats: 3,
        vehicleNumber: "TS09QA9100",
        vehicleModel: "QA Route Guard",
        farePerSeat: 1,
        note: qaNote("vehicle routing regression"),
      };

      const blocked = await client.createOutstationRideExpectFailure(autoDriver!, basePayload);
      expect(blocked.status).toBe(403);
      expect(JSON.stringify(blocked.body || "")).toMatch(/outstation|seat|eligible|enabled/i);

      const cabBlocked = await client.createOutstationRideExpectFailure(cabDriver, {
        ...basePayload,
        vehicleNumber: "TS09QA9101",
      });
      expect(cabBlocked.status).toBe(403);
      expect(JSON.stringify(cabBlocked.body || "")).toMatch(/document|outstation|seat|eligible|enabled/i);
    } finally {
      await client.dispose();
    }
  });
});
