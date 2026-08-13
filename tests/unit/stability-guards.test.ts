import { describe, expect, it } from "vitest";

import {
  canWalletCoverCharge,
  clampSeatRequest,
  shouldApplyCustomerLateCancelFee,
} from "../../server/utils/stability-guards";

describe("stability guards", () => {
  describe("canWalletCoverCharge", () => {
    it("allows exact wallet deductions", () => {
      expect(canWalletCoverCharge(20, 20)).toBe(true);
    });

    it("rejects insufficient balance", () => {
      expect(canWalletCoverCharge(19.99, 20)).toBe(false);
    });

    it("rejects invalid inputs", () => {
      expect(canWalletCoverCharge(Number.NaN, 10)).toBe(false);
      expect(canWalletCoverCharge(10, Number.NaN)).toBe(false);
      expect(canWalletCoverCharge(10, -1)).toBe(false);
    });
  });

  describe("shouldApplyCustomerLateCancelFee", () => {
    it("applies when a driver was already assigned", () => {
      expect(shouldApplyCustomerLateCancelFee("driver_assigned", "drv_1")).toBe(true);
      expect(shouldApplyCustomerLateCancelFee("accepted", "drv_1")).toBe(true);
      expect(shouldApplyCustomerLateCancelFee("arrived", "drv_1")).toBe(true);
    });

    it("does not apply when no driver was assigned", () => {
      expect(shouldApplyCustomerLateCancelFee("driver_assigned", null)).toBe(false);
    });

    it("does not apply for early or unrelated states", () => {
      expect(shouldApplyCustomerLateCancelFee("searching", "drv_1")).toBe(false);
      expect(shouldApplyCustomerLateCancelFee("completed", "drv_1")).toBe(false);
    });
  });

  describe("clampSeatRequest", () => {
    it("keeps valid requests", () => {
      expect(clampSeatRequest(3)).toBe(3);
    });

    it("clamps low and high seat counts", () => {
      expect(clampSeatRequest(0)).toBe(1);
      expect(clampSeatRequest(9)).toBe(6);
    });

    it("falls back safely for invalid values", () => {
      expect(clampSeatRequest("abc")).toBe(1);
      expect(clampSeatRequest(undefined)).toBe(1);
    });
  });
});
