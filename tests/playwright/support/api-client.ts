import crypto from "node:crypto";
import { expect, request, type APIRequestContext } from "@playwright/test";
import { runtime } from "./runtime";

export class JagoApiClient {
  constructor(private readonly api: APIRequestContext) {}

  static async create() {
    const api = await request.newContext({
      baseURL: runtime.apiBaseURL,
      extraHTTPHeaders: {
        "content-type": "application/json",
      },
    });
    return new JagoApiClient(api);
  }

  async dispose() {
    await this.api.dispose();
  }

  async sendOtp(phone = runtime.testPhone, userType = "customer") {
    const response = await this.api.post("/auth/otp/send", {
      data: { phone, userType, deviceId: `${userType}-device-1` },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async verifyOtp(phone: string, otp: string, userType = "customer", deviceId = `${userType}-device-1`) {
    const response = await this.api.post("/auth/otp/verify", {
      data: { phone, otp, userType, deviceId },
    });
    return response;
  }

  async createBooking(serviceType: string) {
    const response = await this.api.post("/bookings", {
      data: {
        serviceType,
        customerId: runtime.customerId,
        pickup: "Hitech City",
        destination: "Airport",
        amount: 275,
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async acceptBooking(bookingId: string, driverId = runtime.driverId) {
    const response = await this.api.post(`/bookings/${bookingId}/driver/accept`, {
      data: { driverId },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async rejectBooking(bookingId: string, driverId = runtime.driverId) {
    const response = await this.api.post(`/bookings/${bookingId}/driver/reject`, {
      data: { driverId, reason: "Driver unavailable" },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getBooking(bookingId: string) {
    const response = await this.api.get(`/bookings/${bookingId}`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async createPaymentOrder(bookingId: string, amount = 275) {
    const response = await this.api.post(`/bookings/${bookingId}/payment/create-order`, {
      data: { amount },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async verifyPayment(bookingId: string, orderId: string, paymentId = `pay_${Date.now()}`, valid = true) {
    const signaturePayload = `${orderId}|${paymentId}`;
    const signature = valid
      ? crypto.createHmac("sha256", runtime.razorpaySecret).update(signaturePayload).digest("hex")
      : "invalid_signature";

    return this.api.post(`/bookings/${bookingId}/payment/verify`, {
      data: { orderId, paymentId, signature },
    });
  }

  async expireOtp(phone = runtime.testPhone) {
    const response = await this.api.post("/auth/otp/expire", { data: { phone } });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async recoverBooking(bookingId: string) {
    const response = await this.api.get(`/bookings/${bookingId}/recovery`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
}
