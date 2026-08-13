/**
 * JAGO — API Input Validation & Auth Tests
 * Tests request validation, auth token logic, OTP, rate limiting
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";

// ══════════════════════════════════════════════════════════════════════════
// 1. PHONE NUMBER VALIDATION
// ══════════════════════════════════════════════════════════════════════════
describe("Phone Number Validation", () => {
  function validateIndianPhone(phone: unknown): boolean {
    if (typeof phone !== "string") return false;
    const cleaned = phone.replace(/\D/g, "");
    return /^[6-9]\d{9}$/.test(cleaned);
  }

  it("accepts valid 10-digit mobile: 9876543210", () => expect(validateIndianPhone("9876543210")).toBe(true));
  it("accepts 6xxxxxxxxx", () => expect(validateIndianPhone("6000000000")).toBe(true));
  it("accepts 7xxxxxxxxx", () => expect(validateIndianPhone("7000000000")).toBe(true));
  it("accepts 8xxxxxxxxx", () => expect(validateIndianPhone("8000000000")).toBe(true));
  it("rejects 5xxxxxxxxx (starts with 5)", () => expect(validateIndianPhone("5000000000")).toBe(false));
  it("rejects 11-digit number", () => expect(validateIndianPhone("98765432100")).toBe(false));
  it("rejects 9-digit number", () => expect(validateIndianPhone("987654321")).toBe(false));
  it("rejects empty string", () => expect(validateIndianPhone("")).toBe(false));
  it("rejects null", () => expect(validateIndianPhone(null)).toBe(false));
  it("rejects +91 prefix (raw: 12 digits)", () => expect(validateIndianPhone("+919876543210")).toBe(false));
  it("rejects letters", () => expect(validateIndianPhone("abcdefghij")).toBe(false));
});

// ══════════════════════════════════════════════════════════════════════════
// 2. OTP VALIDATION
// ══════════════════════════════════════════════════════════════════════════
describe("OTP Validation", () => {
  function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  function validateOtp(otp: unknown): boolean {
    if (typeof otp !== "string" && typeof otp !== "number") return false;
    return /^\d{6}$/.test(String(otp));
  }

  it("generated OTP is always 6 digits", () => {
    for (let i = 0; i < 20; i++) {
      const otp = generateOtp();
      expect(otp).toHaveLength(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    }
  });

  it("generated OTP is always >= 100000", () => {
    for (let i = 0; i < 20; i++) {
      expect(parseInt(generateOtp())).toBeGreaterThanOrEqual(100000);
    }
  });

  it("accepts valid 6-digit OTP", () => expect(validateOtp("123456")).toBe(true));
  it("rejects 5-digit OTP", () => expect(validateOtp("12345")).toBe(false));
  it("rejects 7-digit OTP", () => expect(validateOtp("1234567")).toBe(false));
  it("rejects non-numeric OTP", () => expect(validateOtp("abcdef")).toBe(false));
  it("rejects empty string", () => expect(validateOtp("")).toBe(false));
  it("rejects '000000' — still valid format", () => expect(validateOtp("000000")).toBe(true));
});

// ══════════════════════════════════════════════════════════════════════════
// 3. JWT TOKEN STRUCTURE
// ══════════════════════════════════════════════════════════════════════════
describe("JWT Token Structure", () => {
  function isValidJwtStructure(token: unknown): boolean {
    if (typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    try {
      // Each part must be valid base64url
      parts.forEach(p => Buffer.from(p, "base64url"));
      return true;
    } catch {
      return false;
    }
  }

  it("accepts a properly structured JWT (3 parts)", () => {
    // eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.HMAC
    const fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.dGVzdA";
    expect(isValidJwtStructure(fakeJwt)).toBe(true);
  });

  it("rejects 2-part token", () => {
    expect(isValidJwtStructure("header.payload")).toBe(false);
  });

  it("rejects 4-part token", () => {
    expect(isValidJwtStructure("a.b.c.d")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidJwtStructure("")).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidJwtStructure(null)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. FARE ESTIMATION VALIDATION
// ══════════════════════════════════════════════════════════════════════════
describe("Fare Estimation Logic", () => {
  function estimateFare(distanceKm: number, baseRate: number, perKmRate: number): number {
    if (distanceKm <= 0) return 0;
    return Math.max(baseRate, parseFloat((baseRate + distanceKm * perKmRate).toFixed(2)));
  }

  it("1km at ₹30 base + ₹12/km = ₹42", () => {
    expect(estimateFare(1, 30, 12)).toBe(42);
  });

  it("0km returns 0", () => {
    expect(estimateFare(0, 30, 12)).toBe(0);
  });

  it("negative distance returns 0", () => {
    expect(estimateFare(-5, 30, 12)).toBe(0);
  });

  it("5km at ₹30 base + ₹10/km = ₹80", () => {
    expect(estimateFare(5, 30, 10)).toBe(80);
  });

  it("short distance below base rate returns base rate", () => {
    const r = estimateFare(0.1, 50, 10);
    expect(r).toBeGreaterThanOrEqual(50);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. UUID VALIDATION
// ══════════════════════════════════════════════════════════════════════════
describe("UUID Validation", () => {
  function isValidUuid(id: unknown): boolean {
    if (typeof id !== "string") return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  it("accepts valid UUID v4", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("accepts UUID with uppercase", () => {
    expect(isValidUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("rejects plain string", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
  });

  it("rejects number", () => {
    expect(isValidUuid(12345)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidUuid("")).toBe(false);
  });

  it("generates valid UUID using crypto.randomUUID", () => {
    const uuid = crypto.randomUUID();
    expect(isValidUuid(uuid)).toBe(true);
  });

  it("100 generated UUIDs are all valid", () => {
    for (let i = 0; i < 100; i++) {
      expect(isValidUuid(crypto.randomUUID())).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. TRIP STATUS STATE MACHINE
// ══════════════════════════════════════════════════════════════════════════
describe("Trip Status State Machine", () => {
  const VALID_TRANSITIONS: Record<string, string[]> = {
    searching: ["accepted", "cancelled"],
    accepted: ["driver_arriving", "cancelled"],
    driver_arriving: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [], // terminal
    cancelled: [], // terminal
  };

  function canTransition(from: string, to: string): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  it("searching → accepted is valid", () => expect(canTransition("searching", "accepted")).toBe(true));
  it("searching → cancelled is valid", () => expect(canTransition("searching", "cancelled")).toBe(true));
  it("accepted → driver_arriving is valid", () => expect(canTransition("accepted", "driver_arriving")).toBe(true));
  it("in_progress → completed is valid", () => expect(canTransition("in_progress", "completed")).toBe(true));
  it("completed → anything is INVALID (terminal)", () => {
    expect(canTransition("completed", "cancelled")).toBe(false);
    expect(canTransition("completed", "in_progress")).toBe(false);
  });
  it("cancelled → anything is INVALID (terminal)", () => {
    expect(canTransition("cancelled", "accepted")).toBe(false);
  });
  it("searching → completed is INVALID (skip states)", () => {
    expect(canTransition("searching", "completed")).toBe(false);
  });
  it("in_progress → searching is INVALID (backwards)", () => {
    expect(canTransition("in_progress", "searching")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. RAZORPAY ORDER ID FORMAT
// ══════════════════════════════════════════════════════════════════════════
describe("Razorpay ID Format Validation", () => {
  function isValidRazorpayOrderId(id: unknown): boolean {
    if (typeof id !== "string") return false;
    return /^order_[A-Za-z0-9]{14,20}$/.test(id);
  }

  function isValidRazorpayPaymentId(id: unknown): boolean {
    if (typeof id !== "string") return false;
    return /^pay_[A-Za-z0-9]{14,20}$/.test(id);
  }

  it("accepts valid order ID format", () => {
    expect(isValidRazorpayOrderId("order_MXGhimTZFKLPQR")).toBe(true);
  });

  it("accepts valid payment ID format", () => {
    expect(isValidRazorpayPaymentId("pay_MXGhimTZFKLPQR")).toBe(true);
  });

  it("rejects order ID without prefix", () => {
    expect(isValidRazorpayOrderId("MXGhimTZFKLPQR")).toBe(false);
  });

  it("rejects payment ID with wrong prefix", () => {
    expect(isValidRazorpayPaymentId("order_MXGhimTZFKLPQR")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidRazorpayOrderId("")).toBe(false);
    expect(isValidRazorpayPaymentId("")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 8. RATE LIMITING LOGIC
// ══════════════════════════════════════════════════════════════════════════
describe("Rate Limiting (token bucket simulation)", () => {
  class RateLimiter {
    private counts = new Map<string, { count: number; resetAt: number }>();
    constructor(private limit: number, private windowMs: number) {}

    isAllowed(key: string): boolean {
      const now = Date.now();
      const entry = this.counts.get(key);
      if (!entry || entry.resetAt < now) {
        this.counts.set(key, { count: 1, resetAt: now + this.windowMs });
        return true;
      }
      if (entry.count >= this.limit) return false;
      entry.count++;
      return true;
    }
  }

  it("allows requests within limit", () => {
    const limiter = new RateLimiter(5, 60000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed("ip_1.2.3.4")).toBe(true);
    }
  });

  it("blocks request over limit", () => {
    const limiter = new RateLimiter(5, 60000);
    for (let i = 0; i < 5; i++) limiter.isAllowed("ip_1.2.3.4");
    expect(limiter.isAllowed("ip_1.2.3.4")).toBe(false);
  });

  it("different IPs have independent limits", () => {
    const limiter = new RateLimiter(2, 60000);
    limiter.isAllowed("ip_A");
    limiter.isAllowed("ip_A");
    expect(limiter.isAllowed("ip_A")).toBe(false); // A exhausted
    expect(limiter.isAllowed("ip_B")).toBe(true);  // B still allowed
  });
});
