import { expect, test } from "@playwright/test";
import { JagoApiClient } from "../support/api-client";

test.describe("Auth Guardrails", () => {
  test("rejects OTP verification from a different device id", async () => {
    const api = await JagoApiClient.create();
    const phone = "8777777777";
    const otpSent = await api.sendOtp(phone, "customer");
    const verifyResponse = await api.verifyOtp(phone, otpSent.otp, "customer", "customer-device-2");
    expect(verifyResponse.status()).toBe(409);
    await api.dispose();
  });

  test("issues tokens for both customer and driver OTP verification", async () => {
    const api = await JagoApiClient.create();
    const customerOtp = await api.sendOtp("8666666666", "customer");
    const driverOtp = await api.sendOtp("8555555555", "driver");

    const customerVerify = await api.verifyOtp("8666666666", customerOtp.otp, "customer");
    const driverVerify = await api.verifyOtp("8555555555", driverOtp.otp, "driver");

    expect(customerVerify.ok()).toBeTruthy();
    expect(driverVerify.ok()).toBeTruthy();

    const customerPayload = await customerVerify.json();
    const driverPayload = await driverVerify.json();
    expect(customerPayload.user.userType).toBe("customer");
    expect(driverPayload.user.userType).toBe("driver");

    await api.dispose();
  });
});
