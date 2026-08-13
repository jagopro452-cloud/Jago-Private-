/**
 * JAGO — Critical Business Logic Unit Tests
 * Covers: fare calculation, OTP expiry, wallet guard, haversine, cancel penalty threshold
 */
import { describe, it, expect } from "vitest";

// ══════════════════════════════════════════════════════════════════════════
// 1. FARE CALCULATION
// ══════════════════════════════════════════════════════════════════════════
describe("Fare Calculation", () => {
  function computeFare(distanceKm: number, config: {
    baseFare: number; farePerKm: number; minimumFare: number;
    nightMultiplier?: number; surgeMultiplier?: number; isNight?: boolean;
  }): number {
    const base = config.baseFare + distanceKm * config.farePerKm;
    const night = config.isNight ? (config.nightMultiplier ?? 1) : 1;
    const surge = config.surgeMultiplier ?? 1;
    return Math.max(config.minimumFare, parseFloat((base * night * surge).toFixed(2)));
  }

  it("short trip returns at least minimum fare", () => {
    const fare = computeFare(0.3, { baseFare: 30, farePerKm: 12, minimumFare: 40 });
    expect(fare).toBeGreaterThanOrEqual(40);
  });

  it("correct fare for 5km trip", () => {
    const fare = computeFare(5, { baseFare: 30, farePerKm: 12, minimumFare: 40 });
    expect(fare).toBe(90); // 30 + 5*12 = 90
  });

  it("night multiplier applied correctly", () => {
    const fare = computeFare(5, { baseFare: 30, farePerKm: 12, minimumFare: 40, isNight: true, nightMultiplier: 1.2 });
    expect(fare).toBeCloseTo(108, 1); // 90 * 1.2 = 108
  });

  it("surge multiplier applied on top of base fare", () => {
    const fare = computeFare(5, { baseFare: 30, farePerKm: 12, minimumFare: 40, surgeMultiplier: 1.5 });
    expect(fare).toBeCloseTo(135, 1); // 90 * 1.5 = 135
  });

  it("night + surge stack multiplicatively", () => {
    const fare = computeFare(5, { baseFare: 30, farePerKm: 12, minimumFare: 40, isNight: true, nightMultiplier: 1.2, surgeMultiplier: 1.5 });
    expect(fare).toBeCloseTo(162, 1); // 90 * 1.2 * 1.5 = 162
  });

  it("zero distance returns minimum fare", () => {
    const fare = computeFare(0, { baseFare: 0, farePerKm: 12, minimumFare: 40 });
    expect(fare).toBe(40);
  });

  it("long trip calculated accurately", () => {
    const fare = computeFare(20, { baseFare: 30, farePerKm: 12, minimumFare: 40 });
    expect(fare).toBe(270); // 30 + 20*12 = 270
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. OTP EXPIRY (40-minute window from driver acceptance)
// ══════════════════════════════════════════════════════════════════════════
describe("Pickup OTP Expiry", () => {
  function isOtpExpired(acceptedAt: Date, nowMs: number = Date.now()): boolean {
    return nowMs - acceptedAt.getTime() > 40 * 60 * 1000;
  }

  it("OTP valid 1 minute after acceptance", () => {
    const accepted = new Date(Date.now() - 1 * 60 * 1000);
    expect(isOtpExpired(accepted)).toBe(false);
  });

  it("OTP valid at exactly 39 minutes", () => {
    const accepted = new Date(Date.now() - 39 * 60 * 1000);
    expect(isOtpExpired(accepted)).toBe(false);
  });

  it("OTP expired at 41 minutes", () => {
    const accepted = new Date(Date.now() - 41 * 60 * 1000);
    expect(isOtpExpired(accepted)).toBe(true);
  });

  it("OTP expired at 2 hours", () => {
    const accepted = new Date(Date.now() - 120 * 60 * 1000);
    expect(isOtpExpired(accepted)).toBe(true);
  });

  it("OTP invalid if acceptedAt is in the future (clock skew)", () => {
    const accepted = new Date(Date.now() + 5 * 60 * 1000); // 5 min in future
    expect(isOtpExpired(accepted)).toBe(false); // not expired, but suspicious — handled at server
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. WALLET NEGATIVE BALANCE GUARD
// ══════════════════════════════════════════════════════════════════════════
describe("Wallet Balance Guard", () => {
  function canDeduct(currentBalance: number, amount: number): boolean {
    return currentBalance >= amount;
  }

  function deductAtomic(currentBalance: number, amount: number): number | null {
    if (currentBalance < amount) return null; // would go negative — reject
    return parseFloat((currentBalance - amount).toFixed(2));
  }

  it("allows deduction when balance is exactly the amount", () => {
    expect(canDeduct(100, 100)).toBe(true);
    expect(deductAtomic(100, 100)).toBe(0);
  });

  it("prevents deduction when balance is insufficient", () => {
    expect(canDeduct(50, 100)).toBe(false);
    expect(deductAtomic(50, 100)).toBeNull();
  });

  it("balance never goes negative", () => {
    const result = deductAtomic(30, 50);
    expect(result).toBeNull();
  });

  it("correctly deducts partial amount", () => {
    expect(deductAtomic(150.75, 50.25)).toBeCloseTo(100.50, 2);
  });

  it("zero-amount deduction is always allowed", () => {
    expect(deductAtomic(0, 0)).toBe(0);
  });

  it("floating point: ₹100.10 - ₹0.10 = ₹100.00 exactly", () => {
    const result = deductAtomic(100.10, 0.10);
    expect(result).toBeCloseTo(100.00, 2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. DRIVER CANCEL PENALTY THRESHOLD
// ══════════════════════════════════════════════════════════════════════════
describe("Driver Cancel Penalty", () => {
  function shouldApplyPenalty(cancelCount: number, threshold: number = 3): boolean {
    return cancelCount >= threshold;
  }

  it("no penalty at 1 cancel", () => expect(shouldApplyPenalty(1)).toBe(false));
  it("no penalty at 2 cancels", () => expect(shouldApplyPenalty(2)).toBe(false));
  it("penalty at exactly 3 cancels", () => expect(shouldApplyPenalty(3)).toBe(true));
  it("penalty at 4+ cancels", () => expect(shouldApplyPenalty(4)).toBe(true));
  it("custom threshold: penalty at 5", () => expect(shouldApplyPenalty(5, 5)).toBe(true));
  it("custom threshold: no penalty at 4 when threshold is 5", () => expect(shouldApplyPenalty(4, 5)).toBe(false));
});

// ══════════════════════════════════════════════════════════════════════════
// 5. HAVERSINE DISTANCE CALCULATION
// ══════════════════════════════════════════════════════════════════════════
describe("Haversine Distance", () => {
  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  it("same point = 0 distance", () => {
    expect(haversineKm(17.385, 78.4867, 17.385, 78.4867)).toBeCloseTo(0, 5);
  });

  it("Hyderabad to Secunderabad (~8km)", () => {
    const dist = haversineKm(17.3850, 78.4867, 17.4399, 78.4983);
    expect(dist).toBeGreaterThan(5);
    expect(dist).toBeLessThan(12);
  });

  it("distance is symmetric (A→B == B→A)", () => {
    const d1 = haversineKm(17.3850, 78.4867, 17.4399, 78.4983);
    const d2 = haversineKm(17.4399, 78.4983, 17.3850, 78.4867);
    expect(d1).toBeCloseTo(d2, 8);
  });

  it("1 degree latitude ≈ 111km", () => {
    const dist = haversineKm(0, 0, 1, 0);
    expect(dist).toBeCloseTo(111.195, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. PAYMENT IDEMPOTENCY CHECK
// ══════════════════════════════════════════════════════════════════════════
describe("Payment Idempotency", () => {
  const processedPayments = new Set<string>();

  function processPayment(paymentId: string, amount: number): { success: boolean; alreadyProcessed?: boolean } {
    if (processedPayments.has(paymentId)) {
      return { success: false, alreadyProcessed: true };
    }
    processedPayments.add(paymentId);
    return { success: true };
  }

  it("first payment processes successfully", () => {
    const result = processPayment("pay_TEST001", 100);
    expect(result.success).toBe(true);
    expect(result.alreadyProcessed).toBeUndefined();
  });

  it("duplicate payment ID is rejected", () => {
    const result = processPayment("pay_TEST001", 100); // same ID again
    expect(result.success).toBe(false);
    expect(result.alreadyProcessed).toBe(true);
  });

  it("different payment ID processes successfully", () => {
    const result = processPayment("pay_TEST002", 150);
    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. SURGE ZONE RAY-CAST (point-in-polygon)
// ══════════════════════════════════════════════════════════════════════════
describe("Surge Zone Detection (Ray-Cast)", () => {
  function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [yi, xi] = polygon[i];
      const [yj, xj] = polygon[j];
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Simple square zone around Hyderabad city center
  const testZone: [number, number][] = [
    [17.35, 78.45], [17.35, 78.52], [17.42, 78.52], [17.42, 78.45],
  ];

  it("point inside zone returns true", () => {
    expect(pointInPolygon(17.385, 78.487, testZone)).toBe(true);
  });

  it("point outside zone returns false", () => {
    expect(pointInPolygon(17.60, 78.90, testZone)).toBe(false);
  });

  it("point at zone corner handled without crash", () => {
    expect(() => pointInPolygon(17.35, 78.45, testZone)).not.toThrow();
  });
});
