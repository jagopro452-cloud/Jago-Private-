#!/usr/bin/env node
const BASE_URL = (process.env.LIVE_AUDIT_BASE_URL || "https://jagopro.org").replace(/\/$/, "");

function makePhone(prefix) {
  const seed = Date.now().toString().slice(-6);
  return `${prefix}${seed}`.slice(0, 10);
}

async function request(method, path, body, token) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function assert(condition, message, extra) {
  if (!condition) {
    const err = new Error(message);
    err.extra = extra;
    throw err;
  }
}

async function main() {
  const customerPhone = makePhone("8111");
  const driverPhone = makePhone("8222");
  const password = "Audit@123";
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=";

  const result = {
    baseUrl: BASE_URL,
    customer: {},
    driver: {},
    forgotPassword: null,
  };

  const customerReg = await request("POST", "/api/app/register", {
    phone: customerPhone,
    password,
    fullName: "Prod Audit Customer",
    userType: "customer",
  });
  assert(customerReg.ok && customerReg.body?.success, "Customer registration failed", customerReg);
  const customerToken = customerReg.body.token;
  result.customer.register = {
    status: customerReg.status,
    userId: customerReg.body?.user?.id || null,
    phone: customerReg.body?.user?.phone || null,
    userType: customerReg.body?.user?.userType || null,
  };

  const customerProfile = await request("GET", "/api/app/customer/profile", null, customerToken);
  assert(customerProfile.ok, "Customer profile fetch failed", customerProfile);
  result.customer.profile = {
    status: customerProfile.status,
    fullName: customerProfile.body?.user?.fullName || customerProfile.body?.fullName || null,
    phone: customerProfile.body?.user?.phone || customerProfile.body?.phone || null,
  };

  const customerLogout = await request("POST", "/api/app/logout", {}, customerToken);
  assert(customerLogout.ok, "Customer logout failed", customerLogout);
  result.customer.logout = { status: customerLogout.status, success: !!customerLogout.body?.success };

  const customerLogin = await request("POST", "/api/app/login-password", {
    phone: customerPhone,
    password,
    userType: "customer",
  });
  assert(customerLogin.ok && customerLogin.body?.success, "Customer login failed after logout", customerLogin);
  result.customer.login = {
    status: customerLogin.status,
    userId: customerLogin.body?.user?.id || null,
    phone: customerLogin.body?.user?.phone || null,
  };

  const forgotPassword = await request("POST", "/api/app/forgot-password", {
    phone: customerPhone,
    userType: "customer",
  });
  result.forgotPassword = {
    status: forgotPassword.status,
    provider: forgotPassword.body?.provider || null,
    success: !!forgotPassword.body?.success,
  };

  const driverReg = await request("POST", "/api/app/register", {
    phone: driverPhone,
    password,
    fullName: "Prod Audit Driver",
    userType: "driver",
  });
  assert(driverReg.ok && driverReg.body?.success, "Driver registration failed", driverReg);
  const driverToken = driverReg.body.token;
  result.driver.register = {
    status: driverReg.status,
    userId: driverReg.body?.user?.id || null,
    phone: driverReg.body?.user?.phone || null,
    userType: driverReg.body?.user?.userType || null,
  };

  const driverUpdate = await request("PATCH", "/api/app/driver/update-registration", {
    name: "Prod Audit Driver",
    city: "Hyderabad",
    dob: "1995-05-16",
    vehicleBrand: "Audit",
    vehicleModel: "Verifier",
    vehicleColor: "White",
    vehicleYear: 2024,
    vehicleNumber: `TS${Date.now().toString().slice(-8)}`,
    vehicleType: "bike",
    licenseNumber: `DL${Date.now().toString().slice(-8)}`,
    licenseExpiry: "2030-12-31",
    selfieImage: tinyPng,
  }, driverToken);
  assert(driverUpdate.ok && driverUpdate.body?.success, "Driver update-registration failed", driverUpdate);
  result.driver.updateRegistration = {
    status: driverUpdate.status,
    success: !!driverUpdate.body?.success,
  };

  const driverDoc = await request("POST", "/api/app/driver/upload-document-base64", {
    docType: "selfie",
    imageData: tinyPng,
  }, driverToken);
  assert(driverDoc.ok && driverDoc.body?.success, "Driver document upload failed", driverDoc);
  result.driver.documentUpload = {
    status: driverDoc.status,
    docType: driverDoc.body?.docType || null,
    success: !!driverDoc.body?.success,
  };

  const driverStatus = await request("GET", "/api/app/driver/verification-status", null, driverToken);
  assert(driverStatus.ok && driverStatus.body?.success, "Driver verification-status failed", driverStatus);
  result.driver.verificationStatus = {
    status: driverStatus.status,
    verificationStatus: driverStatus.body?.verificationStatus || null,
    city: driverStatus.body?.city || null,
    vehicleModel: driverStatus.body?.vehicleModel || null,
    documents: Array.isArray(driverStatus.body?.documents) ? driverStatus.body.documents.length : 0,
  };

  const driverProfile = await request("GET", "/api/app/driver/profile", null, driverToken);
  assert(driverProfile.ok, "Driver profile fetch failed", driverProfile);
  result.driver.profile = {
    status: driverProfile.status,
    fullName: driverProfile.body?.fullName || driverProfile.body?.user?.fullName || null,
    vehicleNumber: driverProfile.body?.vehicleNumber || driverProfile.body?.user?.vehicleNumber || null,
  };

  const driverLogout = await request("POST", "/api/app/logout", {}, driverToken);
  assert(driverLogout.ok, "Driver logout failed", driverLogout);
  result.driver.logout = { status: driverLogout.status, success: !!driverLogout.body?.success };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const payload = {
    error: error.message || String(error),
    extra: error.extra || null,
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
