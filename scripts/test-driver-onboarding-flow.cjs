// Live HTTP test of the driver_details onboarding fix. Talks to a RUNNING
// server over HTTP only — no direct DB access — using real registration +
// admin-approval calls. Creates real test driver accounts (phone numbers
// prefixed 9999) against whatever DATABASE_URL that server is using, so
// point BASE_URL at a staging/dev server, not production, unless you
// specifically intend to create these test drivers in prod.
//
// Usage:
//   BASE_URL=http://localhost:5000 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//     node scripts/test-driver-onboarding-flow.cjs
//
// Covers: bike/auto/sedan/suv registration, invalid vehicle type, admin
// approval blocked when driver_details is missing, admin approval allowed
// when the profile is complete.
"use strict";

const BASE_URL = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`\n${pass ? "PASS" : "FAIL"} — ${name}`);
  console.log(JSON.stringify(detail, null, 2));
}

let phoneCounter = 0;
function freshPhone() {
  phoneCounter += 1;
  // 9999 + 6-digit counter padded, always a fresh 10-digit number per run
  return `9999${String(Date.now()).slice(-4)}${String(phoneCounter).padStart(2, "0")}`;
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON response */ }
  return { status: res.status, body: json };
}

async function registerDriver(name) {
  const phone = freshPhone();
  const reg = await api("POST", "/api/app/register", {
    phone,
    password: "TestPass123",
    fullName: name,
    userType: "driver",
  });
  if (reg.status !== 200 || !reg.body?.token) {
    throw new Error(`registration failed for ${name}: ${JSON.stringify(reg)}`);
  }
  return { phone, userId: reg.body.user.id, token: reg.body.token };
}

async function run() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD env vars are required to test the approval endpoint.");
    process.exitCode = 1;
    return;
  }

  console.log(`Testing against ${BASE_URL}\n`);

  // -- Admin login (needed for approval scenarios) ---------------------------
  const adminLogin = await api("POST", "/api/admin/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (adminLogin.status !== 200 || !adminLogin.body?.token) {
    console.error("Admin login failed — cannot run approval scenarios.", adminLogin);
    process.exitCode = 1;
    return;
  }
  const adminToken = adminLogin.body.token;

  // -- Scenarios 1-4: Bike / Auto / Sedan / SUV registration ------------------
  const vehicleTypes = [
    { label: "Bike", value: "bike", expectCategory: "bike" },
    { label: "Auto", value: "auto", expectCategory: "auto" },
    { label: "Sedan/Cab", value: "sedan", expectCategory: "sedan" },
    { label: "SUV", value: "suv", expectCategory: "suv" },
  ];
  const registeredDrivers = {};

  for (const vt of vehicleTypes) {
    const driver = await registerDriver(`Test ${vt.label} Driver`);
    const update = await api("PATCH", "/api/app/driver/update-registration", {
      name: `Test ${vt.label} Driver`,
      city: "Vijayawada",
      vehicleBrand: "TestBrand",
      vehicleModel: "TestModel",
      vehicleColor: "White",
      vehicleYear: 2023,
      licenseNumber: `TESTLIC${driver.phone}`,
      vehicleNumber: `TEST${driver.phone}`,
      vehicleType: vt.value,
    }, driver.token);

    const profile = await api("GET", "/api/app/driver/profile", null, driver.token);
    const gotCategory = profile.body?.vehicleCategoryType || profile.body?.user?.vehicleCategoryType;
    const gotCategoryId = profile.body?.vehicleCategoryId || profile.body?.user?.vehicleCategoryId;

    record(`Register ${vt.label} driver`, update.status === 200 && !!gotCategoryId, {
      phone: driver.phone,
      userId: driver.userId,
      updateRegistrationResponse: { status: update.status, body: update.body },
      resultingProfile: {
        vehicleCategoryId: gotCategoryId,
        vehicleCategory: profile.body?.vehicleCategory || profile.body?.user?.vehicleCategory,
        vehicleCategoryType: gotCategory,
      },
    });

    registeredDrivers[vt.value] = driver;
  }

  // -- Scenario 5: invalid vehicle type ---------------------------------------
  {
    const driver = await registerDriver("Test Invalid Vehicle Driver");
    const update = await api("PATCH", "/api/app/driver/update-registration", {
      vehicleType: "spaceship",
    }, driver.token);
    record("Invalid vehicle type is rejected (expect 400 INVALID_VEHICLE_TYPE)",
      update.status === 400 && update.body?.code === "INVALID_VEHICLE_TYPE",
      { phone: driver.phone, response: update });
  }

  // -- Scenario 6: driver with NO driver_details (never called update-registration) --
  const incompleteDriver = await registerDriver("Test Incomplete Driver");

  // -- Scenario 7: approval blocked when driver_details is missing ------------
  {
    const approve = await api("PATCH", `/api/drivers/${incompleteDriver.userId}/verify`, { status: "approved" }, adminToken);
    record("Approval blocked for driver with no driver_details (expect 409 DRIVER_PROFILE_INCOMPLETE)",
      approve.status === 409 && approve.body?.code === "DRIVER_PROFILE_INCOMPLETE",
      { userId: incompleteDriver.userId, response: approve });
  }

  // -- Scenario 8: approval allowed for a fully-configured driver -------------
  {
    const bikeDriver = registeredDrivers.bike;
    const approve = await api("PATCH", `/api/drivers/${bikeDriver.userId}/verify`, { status: "approved" }, adminToken);
    record("Approval succeeds for driver with complete driver_details (expect 200)",
      approve.status === 200 && approve.body?.success === true,
      { userId: bikeDriver.userId, response: approve });
  }

  // -- Summary ------------------------------------------------------------
  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n\n=== SUMMARY: ${passCount}/${results.length} scenarios passed ===`);
  results.forEach((r) => console.log(`  ${r.pass ? "PASS" : "FAIL"} — ${r.name}`));
  console.log(`\nTest driver phone numbers created (all prefixed 9999) — safe to identify/clean up later:`);
  console.log([
    ...Object.values(registeredDrivers).map((d) => d.phone),
    incompleteDriver.phone,
  ].join(", "));

  if (passCount !== results.length) process.exitCode = 1;
}

run().catch((e) => {
  console.error("Test script crashed:", e);
  process.exitCode = 1;
});
