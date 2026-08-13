import { expect, test } from "@playwright/test";
import { JagoApiClient } from "../support/api-client";
import { runtime } from "../support/runtime";

test.describe("OTP Lifecycle", () => {
  test("sends and verifies otp for login", async () => {
    const api = await JagoApiClient.create();
    const otpSent = await api.sendOtp(runtime.testPhone, "customer");
    const verified = await api.verifyOtp(runtime.testPhone, otpSent.otp, "customer");
    expect(verified.ok()).toBeTruthy();
    await api.dispose();
  });

  test("rejects expired otp", async () => {
    const api = await JagoApiClient.create();
    const otpSent = await api.sendOtp(runtime.testPhone, "driver");
    await api.expireOtp(runtime.testPhone);
    const verified = await api.verifyOtp(runtime.testPhone, otpSent.otp, "driver");
    expect(verified.status()).toBe(410);
    await api.dispose();
  });

  test("blocks repeated invalid attempts", async () => {
    const api = await JagoApiClient.create();
    await api.sendOtp("8888888888", "customer");
    const first = await api.verifyOtp("8888888888", "000000", "customer");
    const second = await api.verifyOtp("8888888888", "000000", "customer");
    const third = await api.verifyOtp("8888888888", "000000", "customer");
    expect(first.status()).toBe(400);
    expect(second.status()).toBe(400);
    expect(third.status()).toBe(429);
    await api.dispose();
  });
});
